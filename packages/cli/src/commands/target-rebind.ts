// kalup target rebind <target> --portal <id>: point a target at a recreated test portal or
// sandbox. Only a person at a terminal runs it. The target's write key must belong to the new portal, which must be a
// DEVELOPER_TEST or SANDBOX account and not pinned by another target. Both portal locks are taken in ascending portal ID order; then the
// new portal's state is written as state rebuild --write writes it, kalup.config.ts gets the new pin through a staged
// write, and the old portal's state file is archived. A plan saved for the old portal is then refused by apply.
import { type ConfigFile, read, type Target, write } from '@kalup/core'
import { bin } from '../brand.js'
import { observeTarget } from '../engine/observe.js'
import { type Excluded, type Found, rebuild, type Stale } from '../engine/rebuild.js'
import { shellWord } from '../engine/units.js'
import { resolveWriteKey } from '../lib/auth.js'
import { guardPortal } from '../lib/guard.js'
import { createHttp } from '../lib/http.js'
import { readProjectFiles } from '../lib/load.js'
import { acquirePortalLock, type PortalLock } from '../lib/lock.js'
import { exitCodes, KalupError } from '../lib/output.js'
import { sanitize } from '../lib/sanitize.js'
import { writeStaged } from '../lib/staged.js'
import { FileStateStore, stateDir } from '../lib/state.js'
import type { Context, Result } from './context.js'
import { usageError } from './context.js'
import { candidateIssues } from './pull.js'
import { confirmTarget, managedCount, replaceState, reportLines, requireComplete, terminalRequired } from './state.js'
import { check } from './validate.js'

export interface RebindData {
  accountType: string
  /** The old portal's state file, archived; absent when it had none. */
  archived?: string
  excluded: Excluded[]
  found: Found[]
  /** The pin before. */
  from: number
  lineage: string
  missing: string[]
  /** The new pin. */
  portalId: number
  stale: Stale[]
  statePath: string
  target: string
}

const CONFIG = 'kalup.config.ts'
const HUB_ID = /^[1-9]\d*$/
/** The account types rebind moves a target to: a recreated test portal or sandbox. Any other type is refused. */
const REBINDABLE: ReadonlySet<string> = new Set(['DEVELOPER_TEST', 'SANDBOX'])

export async function targetRebind(ctx: Context): Promise<Result<RebindData>> {
  const [name] = ctx.args
  if (name === undefined) {
    throw usageError('missing argument TARGET')
  }
  const portalId = parsePortal(ctx.flags.portal)
  const command = `${bin} target rebind ${shellWord(name)} --portal ${portalId}`
  if (ctx.prompt === undefined) {
    throw terminalRequired(`target rebind changes the portal target ${sanitize(name)} writes to`, command)
  }
  const { root, loaded, issues, warnings } = check({ ...ctx, flags: { ...ctx.flags, target: name } })
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const target = loaded.config.targets[name] as Target
  const from = target.portalId as number
  if (from === portalId) {
    throw usageError(`target ${sanitize(name)} already pins portal ${portalId}`)
  }
  const other = Object.entries(loaded.config.targets).find(([n, t]) => n !== name && t.portalId === portalId)
  if (other) {
    throw new KalupError(
      {
        code: 'E_DUPLICATE_PORTAL',
        message: `target ${sanitize(other[0])} already pins portal ${portalId}, and two targets may not pin one portal. Nothing was written.`,
        file: CONFIG,
        configPath: `targets.${sanitize(other[0])}.portalId`,
        fix: 'rebind to a portal no other target pins, or remove the other target first',
      },
      exitCodes.invalid,
    )
  }
  const { key, variable } = resolveWriteKey(target, root)
  const http = createHttp({ key, warn: (message) => warnings.push({ code: 'W_RATE_LIMIT', message }) })
  // The new portal comes from --portal and no pin names it yet, so a mismatch is worded as init words it.
  const portal = await guardPortal(http, { portalId, variable })
  if (!REBINDABLE.has(portal.accountType)) {
    throw new KalupError(
      {
        code: 'E_REBIND_STANDARD',
        message: `portal ${portalId} is a ${sanitize(portal.accountType)} account; rebind is only for recreated test portals (DEVELOPER_TEST) and sandboxes (SANDBOX). Nothing was written.`,
        fix: `ask the user to check the portal ID; to move a target to a production portal, change portalId in ${CONFIG} by hand and review the plan`,
        humanRequired: true,
      },
      exitCodes.humanRequired,
    )
  }
  const locks: PortalLock[] = []
  try {
    // The two locks one after the other, in ascending portal order.
    const [low, high] = [from, portalId].sort((a, b) => a - b) as [number, number]
    locks.push(await acquirePortalLock(low, { command: 'target rebind' }))
    locks.push(await acquirePortalLock(high, { command: 'target rebind' }))
    const store = FileStateStore(stateDir(root))
    // Every check comes before the first write: the old portal's file must be readable to be archived last.
    store.read(from, name)
    const current = store.read(portalId, name)
    const { observation, issues: observed } = await observeTarget(http, loaded, name)
    requireComplete(observation, command, [...warnings, ...observed])
    const report = rebuild({ loaded, observation, state: current, target: name })
    const configText = rebound(root, name, portalId)
    ctx.prompt.tell([
      `Rebind target ${sanitize(name)} from portal ${from} to portal ${portalId} (${portal.accountType}).`,
      ...reportLines(report, managedCount(loaded), current, store.path(portalId)),
      `${CONFIG} gets portalId ${portalId}; the state file of portal ${from} is archived; plans saved for portal ${from} no longer apply.`,
    ])
    await confirmTarget(ctx.prompt, name, 'Type the target name to rebind it:')
    const written = replaceState(store, portalId, report.resources, command)
    writeStaged(root, { [CONFIG]: configText })
    const archived = store.archive(from, 'target rebind')
    const data: RebindData = {
      target: name,
      from,
      portalId,
      accountType: portal.accountType,
      statePath: store.path(portalId),
      lineage: written.lineage,
      found: report.found,
      missing: report.missing,
      stale: report.stale,
      excluded: report.excluded,
      ...(archived === null ? {} : { archived }),
    }
    const lines = [
      `Target ${sanitize(name)} now pins portal ${portalId}: ${report.found.length} of ${managedCount(loaded)} managed resources found by name.`,
      `Wrote ${CONFIG} and ${data.statePath} (lineage ${data.lineage}, serial 1).`,
      ...(archived === null ? [] : [`Archived the state file of portal ${from} to ${archived}.`]),
      `Next: ${bin} plan --target ${shellWord(name)}`,
    ]
    return { data, issues: [...warnings, ...observed], text: `${lines.join('\n')}\n` }
  } finally {
    for (const lock of locks.reverse()) {
      lock.release()
    }
  }
}

function parsePortal(value: string | undefined): number {
  if (value === undefined) {
    throw usageError('target rebind needs --portal <id>, the Hub ID of the new portal')
  }
  if (!HUB_ID.test(value)) {
    throw usageError(`--portal needs the Hub ID, a positive integer, not '${sanitize(value)}'`)
  }
  return Number(value)
}

// kalup.config.ts with the new pin, in canonical form, after the project it leaves validates. Exit 3 otherwise.
function rebound(root: string, name: string, portalId: number): string {
  const files = readProjectFiles(root)
  const config = read(files[CONFIG] ?? '', CONFIG, 'config').data as ConfigFile
  const targets = { ...config.targets, [name]: { ...config.targets[name], portalId } }
  const text = write('config', { ...config, targets })
  const invalid = candidateIssues({ ...files, [CONFIG]: text }, name)
  if (invalid.length > 0) {
    throw new KalupError(invalid, exitCodes.invalid)
  }
  return text
}
