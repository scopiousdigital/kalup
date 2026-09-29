// kalup blueprint upgrade <name> <source> [--take remote <address[#unit]>]... [--dry-run]: move a blueprint to another
// version with the three-way merge: the stored original as base, config as local, the new version as
// remote, the lock's prefix applied to both. A change upstream lands where the client left the unit alone; the client's
// change stays; both changed differently is a conflict that keeps config and is held in the lock. Removed upstream
// detaches, never deletes. It changes config files only and never touches a portal: plan and apply do that.
import {
  type Address,
  addressMatcher,
  type Blueprint,
  type BlueprintLock,
  type BlueprintResource,
  bin,
  checkIntegrity,
  compareVersions,
  type ExitCode,
  exitCodes,
  type IRResource,
  integrityError,
  isAddress,
  KalupError,
  LOCK_FILE,
  type Loaded,
  type LockEntry,
  type LockHeld,
  lockOf,
  lockText,
  type Merged,
  mergeResource,
  objectsOf,
  originalPath,
  parseBlueprint,
  place,
  prepare,
  refIssues,
  requiresIssues,
  sanitize,
  shellWord,
  stableStringify,
  toIR,
  unitsOf,
} from '@kalup/engine'
import { gitattributes, readOriginal } from '../lib/blueprint/fragment.js'
import { type Read, readSource, sourceError } from '../lib/blueprint/source.js'
import { readProjectFiles } from '../lib/load.js'
import type { Issue } from '../lib/output.js'
import { pending, writeStaged } from '../lib/staged.js'
import { type BlueprintRecord, heading, planCommand, quoted, show } from './add.js'
import type { Context, Result } from './context.js'
import { usageError } from './context.js'
import { candidateIssues } from './pull.js'
import { check } from './validate.js'

export interface UpgradedResource {
  address: Address
  conflicts?: { local?: unknown; remote?: unknown; take: string; unit: string }[]
  converged?: string[]
  kept?: string[]
  notes?: string[]
  sourceAddress: Address
  /**
   * `updated` from upstream, `kept` the client's value, `conflict`, `added`, `detached` (removed upstream; it stays in
   * config, no longer under the blueprint), `client-removed` (the client took it out of config; it stays out) or
   * `unchanged`.
   */
  status: 'updated' | 'kept' | 'conflict' | 'added' | 'detached' | 'client-removed' | 'unchanged'
  updated?: string[]
}

export interface UpgradeData {
  dryRun: boolean
  /** The files written or removed, or with --dry-run, the files that would be. */
  files: string[]
  from: BlueprintRecord
  /** The conflicts the lock holds after the upgrade. */
  held: number
  /** The object keys added to `objects` in kalup.config.ts. */
  objects: string[]
  /** Of `files`, the ones removed: the stored original of the version the lock held before. */
  removed: string[]
  resources: UpgradedResource[]
  to: BlueprintRecord
}

/** One `--take remote` selector: an address, which may hold `*`, and optionally a unit. */
interface Selector {
  address: string
  unit?: string
}

const TAKE = "--take remote <address[#unit]>, for example --take remote 'property:deals/renewal_date#label'"

export async function blueprintUpgrade(ctx: Context): Promise<Result<UpgradeData>> {
  const [name, given] = ctx.args
  if (name === undefined || given === undefined) {
    throw usageError(`missing argument${name === undefined ? 's NAME, SOURCE' : ' SOURCE'}`)
  }
  const selectors = takeSelectors(ctx.flags.take)
  const { root, loaded, issues, warnings } = check({ ...ctx, flags: { ...ctx.flags, target: undefined } })
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const files = readProjectFiles(root)
  const lock = lockOf(files)
  const entry = entryOf(lock, name)
  const { read, remote } = await readRemote(ctx, given, root, lock, name, entry)
  const same = remote.version === entry.version
  const to: BlueprintRecord = {
    name,
    version: remote.version,
    hash: read.hash,
    source: read.source,
    prefix: entry.prefix,
  }
  const description = ctx.prompt === undefined ? undefined : remote.description
  const command = (address: Address, unit: string) =>
    `${bin} blueprint upgrade ${name} ${shellWord(given)} --take remote ${shellWord(`${address}#${unit}`)}`
  const records = { from: record(name, entry), to, description }
  if (same && selectors.length === 0 && entry.held.length === 0) {
    return alreadyAt(ctx, { held: [], written: [] }, records, command, warnings)
  }
  if (compareVersions(remote.version, entry.version) < 0) {
    warnings.push({
      code: 'W_BLUEPRINT_DOWNGRADE',
      message: `${name} goes from ${entry.version} down to ${remote.version}`,
      fix: 'check that the lower version is the one you meant; the merge treats it like any other version',
    })
  }
  const next = prepare(remote, entry.prefix)
  const objects = objectsOf(next.blueprint)
  const stop = [...requiresIssues(loaded, objects), ...refIssues(loaded, next.blueprint)]
  if (stop.length > 0) {
    throw new KalupError(stop)
  }
  const matched = new Set<number>()
  const merged = mergeAll({
    base: prepare(readOriginal(root, name, entry), entry.prefix),
    next,
    loaded,
    lock,
    name,
    held: entry.held,
    take: (address, unit) => takes(selectors, matched, address, unit),
    command,
  })
  unmatched(selectors, matched, merged.resources, same)
  if (same && selectors.length === 0) {
    // Only the held list can change: a conflict config has settled since is no longer held.
    const settled = { ...lock, blueprints: { ...lock.blueprints, [name]: { ...entry, held: merged.held } } }
    const lockOnly: Record<string, string> =
      stableStringify(merged.held) === stableStringify(entry.held) ? {} : { [LOCK_FILE]: lockText(settled) }
    checkCandidate({ ...files, ...lockOnly })
    const written = ctx.flags.dryRun ? pending(root, lockOnly) : writeStaged(root, lockOnly)
    return alreadyAt(ctx, { held: merged.held, written }, records, command, warnings)
  }
  const nextEntry: LockEntry = {
    version: remote.version,
    source: read.source,
    hash: read.hash,
    prefix: entry.prefix,
    original: originalPath(name, remote.version),
    resources: merged.lockResources,
    held: merged.held,
  }
  const nextLock: BlueprintLock = {
    ...lock,
    blueprints: { ...lock.blueprints, [name]: nextEntry },
    sources: { ...lock.sources, [`${read.source}@${remote.version}`]: read.hash },
  }
  const placed = place(files, loaded, merged.edits, objects)
  const candidate = { ...placed.files, [LOCK_FILE]: lockText(nextLock), [nextEntry.original]: read.text }
  checkCandidate(candidate)
  const writes = { ...writesOf(candidate, files, entry.original, nextEntry.original), ...gitattributes(root) }
  const written = ctx.flags.dryRun ? pending(root, writes) : writeStaged(root, writes)
  const data: UpgradeData = {
    dryRun: ctx.flags.dryRun,
    files: written,
    from: record(name, entry),
    held: merged.held.length,
    objects: placed.objects,
    removed: written.filter((file) => writes[file] === null),
    resources: merged.resources,
    to,
  }
  const versions = same ? entry.version : `${entry.version} -> ${remote.version}`
  const text = summary(data, description, versions, planCommand(loaded))
  return { data, issues: warnings, text, exitCode: exitFor(ctx, merged.held.length) }
}

// The project as the upgrade would leave it, validated: any issue stops it, exit 3, before anything is written.
function checkCandidate(candidate: Record<string, string>): void {
  const invalid = candidateIssues(candidate)
  if (invalid.length > 0) {
    const after = ' (as the upgrade would leave the project; nothing was written)'
    throw new KalupError(
      invalid.map((issue) => quoted({ ...issue, message: `${issue.message}${after}` })),
      exitCodes.invalid,
    )
  }
}

// The lock entry of `name`, or E_BLUEPRINT_UNKNOWN naming the blueprints the lock lists.
function entryOf(lock: BlueprintLock, name: string): LockEntry {
  const entry = Object.hasOwn(lock.blueprints, name) ? lock.blueprints[name] : undefined
  if (entry) {
    return entry
  }
  const added = Object.keys(lock.blueprints)
  const lists = added.length > 0 ? `which lists ${added.join(', ')}` : 'which lists no blueprint'
  throw new KalupError({
    code: 'E_BLUEPRINT_UNKNOWN',
    message: `${sanitize(name)} is not in ${LOCK_FILE}, ${lists}`,
    fix: `add it first with ${bin} add <source>, or name a blueprint the lock lists`,
  })
}

// The new version: read, parsed, of the same name, and true to every hash the lock recorded for it.
async function readRemote(
  ctx: Context,
  given: string,
  root: string,
  lock: BlueprintLock,
  name: string,
  entry: LockEntry,
): Promise<{ read: Read; remote: Blueprint }> {
  const read = await readSource(given, ctx.cwd, root)
  const remote = parseBlueprint(read.text, read.source)
  if (remote.name !== name) {
    throw sourceError(`${sanitize(given)} holds blueprint ${remote.name}, not ${sanitize(name)}. Nothing was written.`)
  }
  checkIntegrity(lock, read.source, remote.version, read.hash)
  if (remote.version === entry.version && read.hash !== entry.hash) {
    throw integrityError(`${name} version ${remote.version}`, entry.hash, read.hash)
  }
  return { read, remote }
}

// The version the lock holds, with nothing to take: the conflicts config still holds against it, and the lock when that
// list changed (a conflict settled by hand).
function alreadyAt(
  ctx: Context,
  state: { held: LockHeld[]; written: string[] },
  records: { from: BlueprintRecord; to: BlueprintRecord; description: string | undefined },
  command: (address: Address, unit: string) => string,
  warnings: Issue[],
): Result<UpgradeData> {
  const { held, written } = state
  const { from, to, description } = records
  const data: UpgradeData = {
    dryRun: ctx.flags.dryRun,
    files: written,
    from,
    held: held.length,
    objects: [],
    removed: [],
    resources: [],
    to,
  }
  const nothing = written.length === 0 || ctx.flags.dryRun ? ' Nothing was written.' : ''
  const lines = [...heading(to, description), `Already at ${to.version}.${nothing}`]
  if (held.length > 0) {
    lines.push(`The lock holds ${held.length} conflict${held.length === 1 ? '' : 's'}, config's value kept:`)
    for (const h of held) {
      const take = sanitize(command(h.address, h.unit), 1000)
      lines.push(`  ${conflictLine(`${h.address}#${sanitize(h.unit)}`, h, take)}`)
    }
  }
  lines.push(...written.map((file) => `${ctx.flags.dryRun ? 'would write' : 'wrote'} ${file}`))
  return { data, issues: warnings, text: `${lines.join('\n')}\n`, exitCode: exitFor(ctx, held.length) }
}

// Each file whose text changes, and the old stored original, removed once the new one is written. The same version
// keeps its original.
function writesOf(
  candidate: Record<string, string>,
  files: Record<string, string>,
  before: string,
  after: string,
): Record<string, string | null> {
  const writes: Record<string, string | null> = Object.fromEntries(
    Object.keys(candidate)
      .filter((file) => candidate[file] !== files[file])
      .map((file) => [file, candidate[file] as string]),
  )
  if (before !== after) {
    writes[before] = null
  }
  return writes
}

function record(name: string, entry: LockEntry): BlueprintRecord {
  return { name, version: entry.version, hash: entry.hash, source: entry.source, prefix: entry.prefix }
}

// Exit 2 with --exit-code while the lock holds conflicts.
function exitFor(ctx: Context, held: number): ExitCode {
  return ctx.flags.exitCode && held > 0 ? exitCodes.differences : exitCodes.done
}

function pick(c: { local?: unknown; remote?: unknown }): Pick<LockHeld, 'local' | 'remote'> {
  return {
    ...(c.local === undefined ? {} : { local: c.local }),
    ...(c.remote === undefined ? {} : { remote: c.remote }),
  }
}

interface Merging {
  base: ReturnType<typeof prepare>
  command: (address: Address, unit: string) => string
  /**
   * The units the lock holds: they stay conflicts until taken, or until config or upstream changes them, at the same
   * version and at any other.
   */
  held: LockHeld[]
  loaded: Loaded
  lock: BlueprintLock
  name: string
  next: ReturnType<typeof prepare>
  take: (address: Address, unit: string) => boolean
}

interface MergedAll {
  /** The resources to write into config, in IR form. */
  edits: [Address, IRResource][]
  /** Each conflict with its values as config and the blueprint hold them, for the lock. */
  held: LockHeld[]
  /** The lock's new resources: every one upstream still has. */
  lockResources: Record<Address, Address>
  resources: UpgradedResource[]
}

// Every resource the stored original or the new version holds, by its local address, in address order.
function mergeAll(m: Merging): MergedAll {
  const out: MergedAll = { edits: [], held: [], lockResources: {}, resources: [] }
  const baseResources = m.base.blueprint.resources
  const nextResources = m.next.blueprint.resources
  const addresses = [...new Set([...Object.keys(baseResources), ...Object.keys(nextResources)])].sort()
  const collisions: Issue[] = []
  for (const address of addresses) {
    const b = Object.hasOwn(baseResources, address) ? baseResources[address] : undefined
    const r = Object.hasOwn(nextResources, address) ? nextResources[address] : undefined
    const local = Object.hasOwn(m.loaded.ir.resources, address) ? m.loaded.ir.resources[address] : undefined
    if (r) {
      const collision = ownedElsewhere(m, address)
      if (collision) {
        collisions.push(collision)
      } else {
        mergeOne(m, out, { address, b, r, local })
      }
    } else {
      // Removed upstream: the lock lets go of it. Config keeps it, or keeps it out when the client removed it.
      const sourceAddress = m.base.sources.get(address) ?? address
      out.resources.push({ address, sourceAddress, status: local ? 'detached' : 'client-removed' })
    }
  }
  if (collisions.length > 0) {
    throw new KalupError(collisions)
  }
  return out
}

// E_BLUEPRINT_COLLISION when another blueprint of the lock provides the address.
function ownedElsewhere(m: Merging, address: Address): Issue | undefined {
  const owner = Object.entries(m.lock.blueprints).find(
    ([other, e]) => other !== m.name && Object.hasOwn(e.resources, address),
  )?.[0]
  if (owner === undefined) {
    return undefined
  }
  return {
    code: 'E_BLUEPRINT_COLLISION',
    message: `${address} is new in ${m.name} and already provided by blueprint ${owner}. Nothing was written.`,
    fix: `leave ${m.name} at its version, or remove ${address} from ${owner} first`,
  }
}

// One resource the new version holds: added, kept out where the client removed it (by hand or with a tombstone), or
// merged unit by unit against config.
function mergeOne(
  m: Merging,
  out: MergedAll,
  sides: { address: Address; b?: BlueprintResource; r: BlueprintResource; local?: IRResource },
): void {
  const { address, b, r, local } = sides
  const sourceAddress = m.next.sources.get(address) ?? address
  out.lockResources[address] = sourceAddress
  const tombstoned = Object.hasOwn(m.loaded.ir.tombstones, address)
  if (b && !local) {
    out.resources.push({ address, sourceAddress, status: 'client-removed' })
    return
  }
  if (!local) {
    out.resources.push({ address, sourceAddress, status: tombstoned ? 'client-removed' : 'added' })
    if (!tombstoned) {
      out.edits.push([address, toIR(r)])
    }
    return
  }
  const held = new Set(m.held.filter((h) => h.address === address).map((h) => h.unit))
  const merged = mergeResource({
    local,
    ...(b ? { base: unitsOf(b) } : {}),
    remote: unitsOf(r),
    held,
    take: (unit) => m.take(address, unit),
  })
  if (merged.updated.length > 0) {
    out.edits.push([address, merged.resource])
  }
  out.held.push(...merged.conflicts.map((c) => ({ address, unit: c.unit, ...pick(c) })))
  out.resources.push(report(address, sourceAddress, merged, m.command))
}

// One merged resource's line: its status and units, each value sanitized, each conflict with its --take command.
function report(
  address: Address,
  sourceAddress: Address,
  merged: Merged,
  command: (address: Address, unit: string) => string,
): UpgradedResource {
  const { updated, kept, converged, notes, conflicts } = merged
  let status: UpgradedResource['status'] = 'unchanged'
  if (conflicts.length > 0) {
    status = 'conflict'
  } else if (updated.length > 0) {
    status = 'updated'
  } else if (kept.length > 0) {
    status = 'kept'
  }
  const clean = (units: string[]) => units.map((u) => sanitize(u))
  return {
    address,
    sourceAddress,
    status,
    ...(updated.length > 0 ? { updated: clean(updated) } : {}),
    ...(kept.length > 0 ? { kept: clean(kept) } : {}),
    ...(converged.length > 0 ? { converged: clean(converged) } : {}),
    ...(conflicts.length > 0
      ? {
          conflicts: conflicts.map((c) => ({
            unit: sanitize(c.unit),
            ...(c.local === undefined ? {} : { local: scrub(c.local) }),
            ...(c.remote === undefined ? {} : { remote: scrub(c.remote) }),
            take: sanitize(command(address, c.unit), 1000),
          })),
        }
      : {}),
    ...(notes.length > 0 ? { notes: notes.map((n) => sanitize(n, 500)) } : {}),
  }
}

// A value from config or a blueprint, every string in it sanitized.
function scrub(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitize(value)
  }
  if (Array.isArray(value)) {
    return value.map(scrub)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [sanitize(k), scrub(v)]))
  }
  return value
}

// The `--take` values: `remote`, then one or more selectors, repeatable. Only upstream's side can be taken; config's
// side is what a conflict keeps.
function takeSelectors(values: string[] | undefined): Selector[] {
  const out: Selector[] = []
  let named: number | undefined
  for (const value of values ?? []) {
    if (value !== 'remote') {
      if (named === undefined) {
        throw usageError(`--take takes the blueprint's side only: ${TAKE}`)
      }
      out.push(selector(value))
      named += 1
    } else if (named === 0) {
      throw usageError(`--take remote names no address: ${TAKE}`)
    } else {
      named = 0
    }
  }
  if (named === 0) {
    throw usageError(`--take remote names no address: ${TAKE}`)
  }
  return out
}

// `<address>` or `<address>#<unit>`.
function selector(value: string): Selector {
  const at = value.indexOf('#')
  const address = at === -1 ? value : value.slice(0, at)
  const unit = at === -1 ? undefined : value.slice(at + 1)
  if (!isAddress(address) || unit === '') {
    throw usageError(`--take remote ${sanitize(value)} is not an address with an optional #unit: ${TAKE}`)
  }
  return unit === undefined ? { address } : { address, unit }
}

// Whether a selector takes the upstream side of this unit, recording each that does. A unit selects itself and the
// units under it: `options` every option unit, `options[low]` that option's fields.
function takes(selectors: Selector[], matched: Set<number>, address: Address, unit: string): boolean {
  let hit = false
  for (const [index, s] of selectors.entries()) {
    const under = s.unit !== undefined && (unit.startsWith(`${s.unit}.`) || unit.startsWith(`${s.unit}[`))
    if (addressMatcher(s.address)(address) && (s.unit === undefined || s.unit === unit || under)) {
      matched.add(index)
      hit = true
    }
  }
  return hit
}

// E_TAKE_UNMATCHED for every selector that took nothing, naming the conflicts there are.
function unmatched(selectors: Selector[], matched: Set<number>, resources: UpgradedResource[], same: boolean): void {
  const conflicts = resources.flatMap((r) => (r.conflicts ?? []).map((c) => `${r.address}#${c.unit}`))
  const there = conflicts.length > 0 ? `conflicts: ${conflicts.join(', ')}` : 'there is no conflict'
  const issues = selectors.flatMap((s, index): Issue[] => {
    if (matched.has(index)) {
      return []
    }
    const given = s.unit === undefined ? s.address : `${s.address}#${s.unit}`
    const what = same ? 'no conflict the lock holds' : 'no conflict of this upgrade'
    return [
      {
        code: 'E_TAKE_UNMATCHED',
        message: sanitize(`--take remote ${given} matches ${what}; ${there}. Nothing was written.`, 500),
        fix: 'take a unit the upgrade lists as a conflict, or leave the selector out',
      },
    ]
  })
  if (issues.length > 0) {
    throw new KalupError(issues)
  }
}

const LABELS: Record<UpgradedResource['status'], string> = {
  updated: 'updated from upstream',
  kept: "kept the client's value",
  conflict: 'conflict, config kept',
  added: 'added',
  detached: 'removed upstream, detached (config keeps it, the blueprint no longer provides it)',
  'client-removed': 'removed by the client, stays removed',
  unchanged: 'unchanged',
}

// One conflict: both values and the command that takes upstream's. `unit` and `take` arrive sanitized.
function conflictLine(unit: string, values: { local?: unknown; remote?: unknown }, take: string): string {
  return `conflict ${unit}: config ${show(values.local)}, upstream ${show(values.remote)}; take upstream: ${take}`
}

function summary(data: UpgradeData, description: string | undefined, versions: string, plan: string): string {
  const lines = heading(data.to, description, versions)
  for (const r of data.resources) {
    lines.push(...resourceLines(r))
  }
  if (data.objects.length > 0) {
    lines.push(`${data.dryRun ? 'Would add' : 'Added'} to objects in kalup.config.ts: ${data.objects.join(', ')}`)
  }
  const [write, remove] = data.dryRun ? ['would write', 'would remove'] : ['wrote', 'removed']
  lines.push(...data.files.map((file) => `${data.removed.includes(file) ? remove : write} ${file}`))
  if (data.files.length === 0) {
    lines.push('Files are up to date.')
  }
  lines.push(
    data.dryRun
      ? `Nothing was written. Run it again without --dry-run, then ${plan} shows what it changes in HubSpot.`
      : `Next: ${plan} shows what this changes in HubSpot.`,
  )
  return `${lines.join('\n')}\n`
}

// A resource's status line, then the units under it that its status does not already name, each conflict and note.
function resourceLines(r: UpgradedResource): string[] {
  const updated = r.updated ?? []
  const kept = r.kept ?? []
  const own: Partial<Record<UpgradedResource['status'], string[]>> = { updated, kept }
  const named = own[r.status] ?? []
  const lines = [`  ${LABELS[r.status]}: ${r.address}${named.length > 0 ? ` (${named.join(', ')})` : ''}`]
  if (r.status !== 'updated' && updated.length > 0) {
    lines.push(`    updated from upstream: ${updated.join(', ')}`)
  }
  if (r.status !== 'kept' && kept.length > 0) {
    lines.push(`    kept the client's value: ${kept.join(', ')}`)
  }
  lines.push(...(r.conflicts ?? []).map((c) => `    ${conflictLine(c.unit, c, c.take)}`))
  lines.push(...(r.notes ?? []).map((note) => `    note: ${note}`))
  return lines
}
