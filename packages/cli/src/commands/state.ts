// kalup state rebuild: read-only by default, it reports which config resources the target's
// portal holds and which state entries are stale. With --write, and only for a person at a terminal, it archives the
// current state file, ending its lineage, and writes a new one that adopts every config resource the portal holds.
// It never runs under --yes or --approve, and never writes to the portal.
import type { Target } from '@kalup/core'
import type { Address, Loaded, TargetState } from '@kalup/engine'
import {
  bin,
  createHttp,
  type Excluded,
  exitCodes,
  type Found,
  guardPortal,
  KalupError,
  type Losses,
  type Observation,
  observeTarget,
  plural,
  type Rebuild,
  rebuild,
  rebuiltState,
  type Stale,
  sanitize,
  targetFlag,
} from '@kalup/engine'
import { resolveReadKey, resolveWriteKey } from '../lib/auth.js'
import { acquirePortalLock } from '../lib/lock.js'
import type { Issue } from '../lib/output.js'
import { FileStateStore, type StateFileStore, stateDir } from '../lib/state.js'
import type { Context, Prompter, Result } from './context.js'
import { resolveTarget, targetLine } from './target.js'
import { check } from './validate.js'

export interface RebuildData {
  /** Where the previous state file went, when --write archived one. */
  archived?: string
  excluded: Excluded[]
  found: Found[]
  /** The new lineage, when --write wrote one. */
  lineage?: string
  /** What the current file holds that a rebuild loses; absent when nothing. */
  loses?: Losses
  missing: Address[]
  portalId: number
  stale: Stale[]
  statePath: string
  target: string
  written: boolean
}

export async function stateRebuild(ctx: Context): Promise<Result<RebuildData>> {
  const { root, loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const { name, via } = await resolveTarget(ctx, loaded.config)
  const command = `${bin} state rebuild ${targetFlag(name)} --write`
  if (ctx.flags.write && ctx.prompt === undefined) {
    throw terminalRequired(`state rebuild --write replaces the state file of target ${sanitize(name)}`, command)
  }
  // validate rejected an unknown target and a missing portalId.
  const target = loaded.config.targets[name] as Target
  const portalId = target.portalId as number
  // --write guards with the key apply writes with; the report alone needs the read key.
  const { key, variable } = ctx.flags.write ? resolveWriteKey(target, root) : resolveReadKey(target, root)
  const http = createHttp({ key, warn: (message) => warnings.push({ code: 'W_RATE_LIMIT', message }) })
  await guardPortal(http, { name, portalId, variable })
  const store = FileStateStore(stateDir(root))
  const state = store.read(portalId, name)
  const { observation, issues: read } = await observeTarget(http, loaded, name)
  if (ctx.flags.write) {
    requireComplete(observation, command, [...warnings, ...read])
  }
  const report = rebuild({ loaded, observation, state, target: name })
  const data: RebuildData = {
    target: name,
    portalId,
    statePath: store.path(portalId),
    found: report.found,
    missing: report.missing,
    stale: report.stale,
    excluded: report.excluded,
    ...(report.loses ? { loses: report.loses } : {}),
    written: false,
  }
  const head = targetLine(name, portalId, via)
  const lines = reportLines(report, managedCount(loaded), state, store.path(portalId))
  if (!ctx.flags.write) {
    const next = `Nothing was written. To replace the state file with these adoptions, run ${command} in a terminal.`
    return { data, issues: [...warnings, ...read], text: `${head}${[...lines, next].join('\n')}\n` }
  }
  const prompt = ctx.prompt as Prompter
  prompt.tell([...lines, ...lossLines(report.loses)])
  await confirmTarget(prompt, name, 'Type the target name to replace its state file:')
  const lock = await acquirePortalLock(portalId, { command: 'state rebuild --write' })
  try {
    // The report was built before the lock: a file another writer saved meanwhile was never shown, so refuse it.
    sameState(state, store.read(portalId, name), portalId, command)
    const written = replaceState(store, portalId, report.resources, command)
    Object.assign(data, written, { written: true })
  } finally {
    lock.release()
  }
  const done = `${data.archived ? `Archived the previous state file to ${data.archived}. ` : ''}Wrote ${data.statePath}: lineage ${data.lineage}, serial 1, ${plural(report.found.length, 'adopted entry', 'adopted entries')}. Next: ${bin} plan ${targetFlag(name)}`
  return { data, issues: [...warnings, ...read], text: `${head}${[...lines, done].join('\n')}\n` }
}

/**
 * Archives the portal's state file, when it has one, and writes a new lineage holding `resources`. The caller holds the
 * portal lock and has checked the file is the one it showed. `command` is the one to run again after a failed save.
 */
export function replaceState(
  store: StateFileStore,
  portalId: number,
  resources: Rebuild['resources'],
  command: string,
): { archived?: string; lineage: string } {
  const archived = store.archive(portalId, 'state rebuild')
  const next = rebuiltState(portalId, store.newLineage(), resources)
  try {
    store.write(next, null)
  } catch (error) {
    throw archived === null ? error : unsaved(error, store.path(portalId), archived, command)
  }
  return { ...(archived === null ? {} : { archived }), lineage: next.lineage }
}

// The store's closing sentence on a failed save, true only while the previous file is where it was.
const INTACT = / The previous file is intact\.$/

// The new file failed to save after the archive moved the old one away, so no state file is left, whatever the
// store's message says about the previous file.
function unsaved(error: unknown, file: string, archived: string, command: string): unknown {
  const [issue] = error instanceof KalupError ? error.issues : []
  if (issue?.code !== 'E_STATE_WRITE') {
    return error
  }
  const failed = issue.message.replace(INTACT, '')
  return new KalupError({
    code: 'E_STATE_WRITE',
    message: `${failed} The previous file was already archived to ${archived}, so the portal has no state file now: until one is written, the next plan proposes adopting every config resource the portal holds.`,
    file,
    fix: `check that the state directory is writable and the disk has room, then run ${command} again; or move ${archived} back to ${file} to keep the previous state`,
  })
}

/**
 * E_STATE_CHANGED when the state file under the lock is not the one the report was built on: another command saved,
 * archived or created it in between. Nothing has been written.
 */
export function sameState(shown: TargetState | null, now: TargetState | null, portalId: number, command: string): void {
  const same =
    shown === null ? now === null : now !== null && now.lineage === shown.lineage && now.serial === shown.serial
  if (same) {
    return
  }
  const describe = (s: TargetState | null) => (s === null ? 'no state' : `lineage ${s.lineage}, serial ${s.serial}`)
  throw new KalupError({
    code: 'E_STATE_CHANGED',
    message: `state for portal ${portalId} changed since the report was made (${describe(shown)}; now ${describe(now)}): another command wrote it in between. Nothing was written.`,
    fix: `run ${command} again and review the new report`,
  })
}

/**
 * E_INCOMPLETE when the read left out a list config needs: a rebuild would drop every entry there, created origins and
 * bases included, though it could not check them. Nothing has been written. The report alone still runs.
 */
export function requireComplete(observation: Observation, command: string, issues: Issue[]): void {
  const { coverage } = observation
  if (coverage === undefined || coverage.complete) {
    return
  }
  const unread: string[] = []
  const scopes = new Set<string>()
  for (const [object, c] of Object.entries(coverage.objects)) {
    if (c.status === 'unreadable') {
      unread.push(`the lists of ${object}`)
      if (c.missingScope !== undefined) {
        scopes.add(c.missingScope)
      }
    }
    if (c.unaddressable !== undefined) {
      unread.push(
        `${c.unaddressable.map((n) => `property:${object}/${sanitize(n)}`).join(', ')} (a group name no address can hold)`,
      )
    }
  }
  const add =
    scopes.size > 0
      ? `add the scope${scopes.size > 1 ? 's' : ''} ${[...scopes].join(', ')} to the write key`
      : 'fix what the issues that follow name'
  throw new KalupError([
    {
      code: 'E_INCOMPLETE',
      message: `the read did not cover everything config names: ${unread.join('; ')}. A rebuild would drop what it could not check. Nothing was written.`,
      fix: `${add}, then run ${command} again`,
    },
    ...issues,
  ])
}

/** The report as lines a person reads. Every portal string is sanitized. */
export function reportLines(report: Rebuild, total: number, state: TargetState | null, path: string): string[] {
  const lines = [
    state === null ? `State: ${path}, none` : `State: ${path}, lineage ${state.lineage}, serial ${state.serial}`,
    `${report.found.length} of ${plural(total, 'managed resource')} found by name in the portal`,
  ]
  for (const f of report.found) {
    lines.push(
      `  adopt ${f.address} as ${sanitize(f.id)}: config and the portal agree on ${f.agreed} of ${plural(f.units, 'value')}`,
    )
  }
  for (const address of report.missing) {
    lines.push(`  missing in the portal: ${address}`)
  }
  const why = {
    'not-in-config': 'no longer in config',
    renamed: 'records another portal name',
    absent: 'not in the portal',
  }
  for (const s of report.stale) {
    lines.push(`  stale entry: ${s.address} (${why[s.reason]}${s.id === null ? '' : `, records ${sanitize(s.id)}`})`)
  }
  for (const e of report.excluded) {
    lines.push(`  not adopted: ${e.address} (${e.reason})`)
  }
  return lines
}

/** The config resources a rebuild can adopt. */
export function managedCount(loaded: Pick<Loaded, 'ir'>): number {
  return Object.values(loaded.ir.resources).filter((r) => r.managed).length
}

/** The target name, typed at the terminal; anything else cancels before a write. */
export async function confirmTarget(prompt: Prompter, name: string, question: string): Promise<void> {
  const typed = await prompt.ask(question)
  if (typed?.trim() !== name) {
    throw new KalupError({
      code: 'E_CANCELLED',
      message: 'Not confirmed: the answer was not the target name. Nothing was written.',
    })
  }
}

/** Exit 4: only a person at a terminal may run this. */
export function terminalRequired(what: string, command: string): KalupError {
  const issue: Issue = {
    code: 'E_APPROVAL_REQUIRED',
    message: `${what}, so it needs a person at a terminal. Nothing was written.`,
    fix: `ask the user to run ${command} in a terminal, where they confirm it`,
    humanRequired: true,
  }
  return new KalupError(issue, exitCodes.humanRequired)
}

function lossLines(loses: Losses | undefined): string[] {
  if (loses === undefined) {
    return ['The current state file loses nothing a rebuild can keep.']
  }
  const lines = ['The current state file loses, for good:']
  const list = (label: string, addresses: string[]) => {
    if (addresses.length > 0) {
      lines.push(`  ${label}: ${addresses.join(', ')}`)
    }
  }
  list('created by Kalup, recorded as adopted', loses.created)
  list('agreed values that change or go', loses.bases)
  list('entries not written again', loses.dropped)
  return lines
}
