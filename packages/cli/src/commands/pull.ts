// kalup pull: read a target and merge it into the object files. Validate runs first, then the portal guard, then the
// read, all through read-tagged paths, then the merged project is validated before anything is written. Nothing is
// written on an error, and --check and --discover write nothing. Where the verified portal's state holds a base for a
// resource, a unit config changed keeps the file's value. A field the target's definition override states is merged
// into that override in kalup.config.ts, never into an object file. A pull that writes holds the portal lock from
// before the read, and after a complete read records in state the base of every unit the files and the portal now
// agree on: recordPulled, saved with the serial compare-and-swap apply uses.
import { isAbsolute, relative, sep } from 'node:path'
import type { ObjectScope, Override, Target } from '@kalup/core'
import {
  acceptCommand,
  addressMatcher,
  asTarget,
  baseUnits,
  bin,
  type Change,
  type ConfigFile,
  type Counts,
  createHttp,
  definedOn,
  type ExitCode,
  exitCodes,
  exportName,
  fromTarget,
  type Gap,
  guardPortal,
  IssueError,
  inDir,
  inPipelines,
  inScope,
  intoScope,
  isAddress,
  KalupError,
  type Layout,
  type Loaded,
  loadFiles,
  type MergeInput,
  mergeObject,
  mergePipelines,
  type ObjectExport,
  type ObjectFile,
  objectPath,
  observePortal,
  type PipelineFile,
  type Portal,
  pipelineAsTarget,
  pipelineFromTarget,
  pipelinePath,
  plural,
  read,
  readPortal,
  recordPulled,
  STANDARD_OBJECTS,
  sanitize,
  scopeOf,
  stableStringify,
  type TargetState,
  takeoverCandidates,
  takeoverObjects,
  targetFlag,
  targetOnly,
  unknownObjects,
  validate,
  write,
} from '@kalup/engine'
import { resolveReadKey } from '../lib/auth.js'
import { readProjectFiles } from '../lib/load.js'
import { acquirePortalLock } from '../lib/lock.js'
import type { Issue } from '../lib/output.js'
import { writeStaged } from '../lib/staged.js'
import { openStateStore, type StateFileStore, unmovedState } from '../lib/state.js'
import type { Context, Result } from './context.js'
import { usageError } from './context.js'
import { barrel } from './fmt.js'
import { pinnedPortal, resolveTarget, targetLine } from './target.js'
import { check } from './validate.js'

export interface ObjectReport extends Counts {
  changes: Change[]
}

export interface PullData {
  /** The files written, or with --check, the files that would be. */
  files: string[]
  /** Per object in scope, in config order. */
  objects: Record<string, ObjectReport>
  portalId: number
  /**
   * State after the pull: how many resources' bases the pull recorded, the serial, and the file. Absent with --check and
   * after an incomplete read, which record nothing.
   */
  state?: { path: string; recorded: number; serial: number | null }
  target: string
}

export interface DiscoverData {
  /** The portal's custom objects that the config does not name. */
  objects: string[]
  /** Per object in scope whose pipelines are not, the IDs of the portal's pipelines. */
  pipelines: Record<string, string[]>
  portalId: number
  /** Per object in scope, the portal properties the scope leaves out. */
  properties: Record<string, string[]>
  target: string
}

interface Home {
  data: ObjectFile
  file: string
  index: number
}

/** One `--accept` selector: an address, which may hold the `*` of `--only`, and optionally a unit. */
interface Accept {
  address: string
  unit?: string
}

/** The --accept selectors and the ones a unit matched. */
interface Accepting {
  matched: Set<number>
  selectors: Accept[]
}

const ACCEPT = "--accept <address[#unit]>, for example --accept 'property:companies/billing_status#label'"
// The kinds that name a unit pull kept, which --accept can take the portal side of.
const ACCEPTABLE = new Set<Change['kind']>(['kept', 'conflict', 'removed-in-hubspot'])
const CONFIG = 'kalup.config.ts'
/** The cap on an issue about the merged text: above sanitize's 120, so a long portal string leaves the rest room. */
const QUOTED_MAX = 500

export async function pull(ctx: Context): Promise<Result<PullData | DiscoverData>> {
  const accepting: Accepting = { selectors: acceptSelectors(ctx.flags.accept, ctx.flags.discover), matched: new Set() }
  const { root, loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const { name: targetName, via } = await resolveTarget(ctx, loaded.config)
  // validate rejected an unknown target and an invalid portalId above.
  const target = loaded.config.targets[targetName] as Target
  const portalId = pinnedPortal(targetName, target)
  const { key, variable } = resolveReadKey(target, root)
  const http = createHttp({ key, warn: (message) => warnings.push({ code: 'W_RATE_LIMIT', message }) })
  await guardPortal(http, { name: targetName, portalId, variable })
  // A pull that writes records bases, so it holds the portal lock from before its read, as apply does.
  const lock =
    ctx.flags.check || ctx.flags.discover ? undefined : await acquirePortalLock(portalId, { command: 'pull' })
  try {
    return await pullTarget(ctx, { root, loaded, http, target, targetName, via, accepting, warnings })
  } finally {
    lock?.release()
  }
}

/** What pull has once the portal guard passed. */
interface Pulling {
  accepting: Accepting
  http: ReturnType<typeof createHttp>
  loaded: Loaded
  root: string
  target: Target
  targetName: string
  via: Parameters<typeof targetLine>[2]
  warnings: Issue[]
}

// The read, the merge, the staged write of the files and the bases the pull records.
async function pullTarget(ctx: Context, pulling: Pulling): Promise<Result<PullData | DiscoverData>> {
  const { root, loaded, http, target, targetName, via, accepting, warnings } = pulling
  const portalId = target.portalId as number
  const discovering = ctx.flags.discover === true
  const portal = await readPortal(http, loaded, target, warnings, { schemas: discovering, pipelines: discovering })
  if (portal.absent.length > 0) {
    throw unknownObjects(portal.absent, portal.customObjects ?? [], loaded.configLines)
  }
  if (portal.unknownIncludes.length > 0) {
    throw new KalupError(portal.unknownIncludes.map(unknownInclude(loaded.configLines)), exitCodes.invalid)
  }
  const incomplete = incompleteIssue(portal.gaps, targetName)
  if (ctx.flags.discover) {
    const reported = incomplete ? [...warnings, incomplete] : warnings
    const found = discover(targetName, portalId, loaded, portal, reported)
    return { ...found, text: `${targetLine(targetName, portalId, via)}${found.text ?? ''}` }
  }

  const { layout } = loaded
  const files = readProjectFiles(root, layout)
  const store = openStateStore(root)
  const state = store.read(portalId, targetName)
  warnings.push(...unmovedState(root, portalId))
  const only = addressMatcher(ctx.flags.only)
  const merging: Merging = {
    only,
    // The fields this target's definition overrides state go into those overrides, never into the object files.
    overrides: target.overrides,
    // An address in removed.ts left config on purpose: pull never writes it back.
    removed: new Set(Object.keys(loaded.ir.tombstones)),
    resolve: resolver(state, loaded, portal, targetName, accepting),
  }
  const { next, objects, overrides } = mergeFiles(files, portal, loaded, merging, warnings)
  writeOverrides(next, loaded.config, targetName, overrides)
  if (incomplete) {
    warnings.push(incomplete)
  }
  unmatched(accepting, objects, targetName, warnings)
  const invalid = candidateIssues(next, layout, targetName).map(quoted)
  if (invalid.length > 0) {
    const first: Issue = {
      code: 'E_PULL_INVALID',
      message: 'the pulled project would not validate; nothing was written',
      fix: 'the issues that follow point at the files as pull would write them: change the portal or the file so they agree, or leave the resource out with --only',
    }
    throw new KalupError([first, ...invalid, ...warnings], exitCodes.invalid)
  }
  const index = barrel(next, layout)
  if (index !== undefined) {
    next[layout.barrel] = index
  }
  const changed = Object.keys(next)
    .filter((file) => next[file] !== files[file])
    .sort()
  const after = loadFiles(next, { layout })
  const { observation } = observePortal(portal, after, targetName, [])
  const data: PullData = { target: targetName, portalId, objects, files: changed }
  warnings.push(...largeScope(objects, (object) => objectPath(layout, object), files, changed))
  // Whether this pull writes the portal's state file for the first time: its path is then printed, as the place is
  // chosen by config, KALUP_STATE_DIR or a worktree and nobody has seen it yet.
  let created = false
  if (!ctx.flags.check) {
    // kalup.config.ts and the object files change as one: a failed write puts every file back.
    writeStaged(root, Object.fromEntries(changed.map((file) => [file, next[file] ?? ''])))
    // The bases follow the files: a base names what config and the portal agree on, so the files come first. An
    // incomplete read records nothing.
    if (!incomplete) {
      const resources = recordPulled({ loaded: after, observation, state, target: targetName, only })
      data.state = saveBases(store, portalId, state, resources)
      created = state === null && data.state.serial !== null
    }
  }
  const pending = ctx.flags.check && ctx.flags.exitCode && (changed.length > 0 || differs(objects, warnings))
  let exitCode: ExitCode = pending ? exitCodes.differences : exitCodes.done
  if (incomplete) {
    exitCode = exitCodes.error
  }
  const newState = created && data.state !== undefined ? shownPath(ctx.cwd, data.state.path) : undefined
  const text = `${targetLine(targetName, portalId, via)}${summary(data, ctx.flags.check, layout, newState)}${takeoverNote(after, observation, targetName)}`
  return { data, issues: warnings, text, exitCode }
}

// Saves the entries recordPulled leaves, when they change anything, raising the serial; compare-and-swap on the serial
// read under the lock. A portal with no state file gets a new lineage. The caller holds the portal lock.
function saveBases(
  store: StateFileStore,
  portalId: number,
  state: TargetState | null,
  resources: TargetState['resources'],
): NonNullable<PullData['state']> {
  const path = store.path(portalId)
  const recorded = Object.keys(resources).filter(
    (address) => stableStringify(resources[address]) !== stableStringify(state?.resources[address]),
  ).length
  if (recorded === 0 && Object.keys(resources).length === Object.keys(state?.resources ?? {}).length) {
    return { path, recorded: 0, serial: state?.serial ?? null }
  }
  const current = state ?? { format: 'kalup.state/1', lineage: store.newLineage(), serial: 0, portalId, resources: {} }
  const next: TargetState = { ...current, resources, serial: current.serial + 1 }
  store.write(next, state?.serial ?? null)
  return { path, recorded, serial: next.serial }
}

// A path as the text shows it: from the directory the command ran in when it lies below it, else in full.
function shownPath(cwd: string, path: string): string {
  const rel = relative(cwd, path)
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel.split(sep).join('/')
}

/** Above this many properties written into a new object file, pull warns and points at `include`. */
const LARGE_SCOPE = 200

// One W_LARGE_SCOPE per object whose new file got more than 200 properties: the scope init writes, `{}`, takes every
// custom property, which suits few apps on a portal that has many.
function largeScope(
  objects: Record<string, ObjectReport>,
  fileOf: (object: string) => string,
  before: Record<string, string>,
  changed: string[],
): Issue[] {
  const out: Issue[] = []
  for (const [object, report] of Object.entries(objects)) {
    const file = fileOf(object)
    const n = report.changes.filter((c) => c.kind === 'added' && c.address.startsWith('property:')).length
    if (n <= LARGE_SCOPE || before[file] !== undefined || !changed.includes(file)) {
      continue
    }
    out.push({
      code: 'W_LARGE_SCOPE',
      message: `the pull wrote ${n} properties into the new file for ${object}: every custom property is in the pull scope`,
      configPath: `objects.${object}`,
      fix: `set objects.${object}.custom to false, then delete the properties the app does not need from ${file}`,
    })
  }
  return out
}

// Under takeover, what a plan would archive on the target once the files are as pull leaves them: in-scope resources
// pull did not write, such as those --only left out. Nothing when no object's mode on the target is takeover.
function takeoverNote(
  loaded: Loaded,
  observation: ReturnType<typeof observePortal>['observation'],
  target: string,
): string {
  const objects = takeoverObjects(loaded.config, target)
  if (objects.length === 0) {
    return ''
  }
  const { properties, groups } = takeoverCandidates(loaded, observation, target)
  const archived = [...properties, ...groups]
  const what = archived.length > 0 ? `would archive ${archived.join(', ')}` : 'would archive nothing'
  return `${sanitize(`Takeover on ${objects.join(', ')}: a plan for target ${target} ${what}.`, QUOTED_MAX)}\n`
}

// The base's verdict per address, from the verified portal's state: an address with a base is merged unit by unit
// against that base.
function resolver(
  state: TargetState | null,
  loaded: Loaded,
  portal: Portal,
  target: string,
  accepting: Accepting,
): Merging['resolve'] {
  if (!state || Object.keys(state.resources).length === 0) {
    return undefined
  }
  const { observation } = observePortal(portal, loaded, target, [])
  const bases = baseUnits({ loaded, observation, state, target })
  return (address) => {
    const units = bases.get(address)
    return units && { units, accept: (unit) => accepts(accepting, address, unit) }
  }
}

// The `--accept` values as selectors: `<address>` or `<address>#<unit>`, the address as `--only` takes it.
function acceptSelectors(values: string[] | undefined, discovering: boolean): Accept[] {
  if (discovering && values !== undefined) {
    throw usageError('--accept writes the portal side into config, and --discover writes nothing')
  }
  return (values ?? []).map((value) => {
    const at = value.indexOf('#')
    const address = at === -1 ? value : value.slice(0, at)
    const unit = at === -1 ? undefined : value.slice(at + 1)
    if (!isAddress(address) || unit === '') {
      throw usageError(`--accept ${sanitize(value)} is not an address with an optional #unit: ${ACCEPT}`)
    }
    return unit === undefined ? { address } : { address, unit }
  })
}

// Whether a selector takes the portal side of this unit, recording each that does. A unit selects itself and the
// units under it: `options` every option unit, `options[low]` that option's fields.
function accepts(accepting: Accepting, address: string, unit: string): boolean {
  let hit = false
  for (const [index, s] of accepting.selectors.entries()) {
    const under = s.unit !== undefined && (unit.startsWith(`${s.unit}.`) || unit.startsWith(`${s.unit}[`))
    if (addressMatcher(s.address)(address) && (s.unit === undefined || s.unit === unit || under)) {
      accepting.matched.add(index)
      hit = true
    }
  }
  return hit
}

// E_ACCEPT_UNMATCHED for every selector that took the portal side of nothing, naming what pull kept on its address.
// The warnings follow, since an unread list or a codec mismatch may be why nothing matched.
function unmatched(
  accepting: Accepting,
  objects: Record<string, ObjectReport>,
  target: string,
  warnings: Issue[],
): void {
  const issues = accepting.selectors.flatMap((s, index): Issue[] => {
    if (accepting.matched.has(index)) {
      return []
    }
    const matches = addressMatcher(s.address)
    const kept = Object.values(objects)
      .flatMap((report) => report.changes)
      .filter((c) => ACCEPTABLE.has(c.kind) && matches(c.address))
      .map((c) => `${c.address}#${c.field} (${LABELS[c.kind]})`)
    const there = kept.length > 0 ? `pull keeps: ${kept.join(', ')}` : 'pull keeps nothing there'
    const selector = s.unit === undefined ? s.address : `${s.address}#${s.unit}`
    return [
      {
        code: 'E_ACCEPT_UNMATCHED',
        message: sanitize(
          `--accept ${selector} matches no config change, conflict or option removed in HubSpot; ${there}. Nothing was written.`,
          QUOTED_MAX,
        ),
        fix: `accept a unit that ${bin} pull ${targetFlag(target)} --check lists as kept, a conflict or removed in HubSpot, or leave the selector out`,
      },
    ]
  })
  if (issues.length > 0) {
    throw new KalupError([...issues, ...warnings])
  }
}

// An include name the portal does not have, for one object.
function unknownInclude(configLines: Record<string, number>) {
  return ({ object, names }: Portal['unknownIncludes'][number]): Issue => ({
    code: 'E_UNKNOWN_INCLUDE',
    message: `objects.${object}.include names properties the portal does not have: ${names.map((name) => sanitize(name)).join(', ')}`,
    file: 'kalup.config.ts',
    line: configLines[`objects.${object}.include`],
    configPath: `objects.${object}.include`,
    fix: 'remove them, or check the internal names in HubSpot',
  })
}

// Every object read, merged into its file or a new one: the project's files as pull would leave them, and the report.
// A custom object skipped on the target is not read: its file stays as written and its report is the note alone.
/**
 * What mergeFiles merges: the --only filter, the tombstoned addresses, the base's verdict, and the target's overrides,
 * whose definitions take the portal side of the fields they state.
 */
type Merging = Pick<MergeInput, 'only' | 'removed' | 'resolve'> & { overrides: Record<string, Override> | undefined }

function mergeFiles(
  files: Record<string, string>,
  portal: Portal,
  loaded: Loaded,
  merging: Merging,
  warnings: Issue[],
): { next: Record<string, string>; objects: Record<string, ObjectReport>; overrides: Record<string, Override> } {
  const { only, overrides: stated = {}, ...rest } = merging
  const { layout, config } = loaded
  const scopes = config.objects
  const parsed = objectFiles(files, layout)
  const next = { ...files }
  const objects: Record<string, ObjectReport> = {}
  const overrides: Record<string, Override> = {}
  const excluded = new Set(portal.excluded)
  for (const object of Object.keys(scopes)) {
    const live = portal.objects.find((o) => o.object === object)
    const address = `object:${object}`
    if (!live) {
      if (excluded.has(address)) {
        const changes: Change[] = only(address) ? [{ kind: 'excluded', address: sanitize(address) }] : []
        objects[object] = { added: 0, changed: 0, unchanged: 0, missing: 0, changes }
      }
      continue
    }
    const scope = scopes[object] ?? {}
    const home = findHome(parsed, live.object)
    const local = home ? home.data.exports[home.index] : undefined
    const merged = mergeObject({
      ...rest,
      only,
      live,
      scope: scopeOf(scope),
      local: local && asTarget(local, stated),
      fresh: freshExport(live.object, scope),
      excluded,
      targetOnly: local && targetOnly(local, stated),
    })
    warnings.push(...merged.issues)
    objects[live.object] = { ...merged.counts, changes: merged.changes }
    // An object with no file yet and nothing added (--only left it out) gets no empty file.
    if (!home && merged.counts.added === 0) {
      continue
    }
    const split = fromTarget(merged.export, local, stated)
    Object.assign(overrides, split.overrides)
    const [file, data] = place(home, objectPath(layout, live.object), split.export)
    parsed.set(file, data)
    next[file] = write('object', data)
  }
  mergePipelineFiles({ next, objects, overrides, parsed, portal, loaded, merging: { ...rest, only, stated, excluded } })
  return { next, objects, overrides }
}

/** What mergePipelineFiles works on: the files as pull leaves them so far, and the merge's inputs. */
interface PipelineMerging {
  loaded: Loaded
  merging: Pick<MergeInput, 'only' | 'removed' | 'resolve' | 'excluded'> & { stated: Record<string, Override> }
  /** Updated in place: the files, the report per object and the target's changed overrides. */
  next: Record<string, string>
  objects: Record<string, ObjectReport>
  overrides: Record<string, Override>
  /** The object files as parsed, for the export names a new pipeline's name must not take. */
  parsed: Map<string, ObjectFile>
  portal: Portal
}

// Each object whose pipelines the read holds: its pipeline exports merged where the files hold them, as the target sees
// them, and its new pipelines appended to <dir>/pipelines/<object>.ts. The report joins the object's.
function mergePipelineFiles(m: PipelineMerging): void {
  const { next, objects, overrides, parsed, portal, loaded } = m
  const { stated, ...rest } = m.merging
  const files = pipelineFiles(next, loaded.layout)
  const taken = new Set([
    ...[...parsed.values()].flatMap((f) => f.exports.map((e) => e.name)),
    ...[...files.values()].flatMap((f) => f.exports.map((e) => e.name)),
  ])
  for (const live of portal.objects) {
    if (live.pipelines === undefined) {
      continue
    }
    const { object } = live
    const local = [...files.values()].flatMap((f) => f.exports.filter((e) => e.object === object))
    const merged = mergePipelines({
      ...rest,
      all: loaded.config.objects[object]?.pipelines === true,
      object,
      live: live.pipelines,
      local: local.map((e) => pipelineAsTarget(e, stated)),
      taken,
    })
    const report = objects[object] ?? { added: 0, changed: 0, unchanged: 0, missing: 0, changes: [] }
    for (const count of ['added', 'changed', 'unchanged', 'missing'] as const) {
      report[count] += merged.counts[count]
    }
    report.changes.push(...merged.changes)
    objects[object] = report
    for (const [file, data] of files) {
      const exports = data.exports.map((e) => {
        const into = e.object === object ? merged.merged.get(e.name) : undefined
        if (!into) {
          return e
        }
        const split = pipelineFromTarget(into, e, stated)
        Object.assign(overrides, split.overrides)
        return split.export
      })
      files.set(file, { ...data, exports })
    }
    if (merged.fresh.length > 0) {
      const file = pipelinePath(loaded.layout, object)
      const data = files.get(file) ?? { imports: [], exports: [] }
      files.set(file, { ...data, exports: [...data.exports, ...merged.fresh] })
    }
  }
  for (const [file, data] of files) {
    next[file] = write('pipeline', data)
  }
}

// Every pipeline file of the project, parsed. The loader accepted them all, so read() cannot throw here.
function pipelineFiles(files: Record<string, string>, at: Layout): Map<string, PipelineFile> {
  const out = new Map<string, PipelineFile>()
  for (const [file, text] of Object.entries(files)) {
    if (inDir(at, file) && inPipelines(at, file)) {
      const result = read(text, file, 'pipeline')
      if (result.kind === 'pipeline') {
        out.set(file, result.data)
      }
    }
  }
  return out
}

// kalup.config.ts with the target's overrides that pull changed, each in its place, through the canonical writer.
// Unchanged overrides leave the file as it is.
function writeOverrides(
  next: Record<string, string>,
  config: ConfigFile,
  targetName: string,
  changed: Record<string, Override>,
): void {
  if (Object.keys(changed).length === 0) {
    return
  }
  const target = config.targets[targetName] as Target
  const targets = { ...config.targets, [targetName]: { ...target, overrides: { ...target.overrides, ...changed } } }
  next[CONFIG] = write('config', { ...config, targets })
}

/**
 * The issues of a project as a command would leave it: it must load and validate, or nothing is written. The issues
 * point at the candidate text; its warnings do not block.
 */
export function candidateIssues(files: Record<string, string>, layout: Layout, target?: string): Issue[] {
  try {
    return validate(loadFiles(files, { layout }), { target }).issues
  } catch (error) {
    if (error instanceof IssueError) {
      return error.issues
    }
    throw error
  }
}

// An issue about the merged text quotes what the portal sent, so its text is sanitized as a whole.
function quoted(issue: Issue): Issue {
  return {
    ...issue,
    message: sanitize(issue.message, QUOTED_MAX),
    ...(issue.fix === undefined ? {} : { fix: sanitize(issue.fix, QUOTED_MAX) }),
    ...(issue.configPath === undefined ? {} : { configPath: sanitize(issue.configPath, QUOTED_MAX) }),
  }
}

// A semantic difference in scope, whether or not it changes a file: every change but an excluded or removed note, a
// property in a removed group, a kept config change or a field the target alone ignores, including a property the
// portal cannot carry, an option only in config, a conflict, a property HubSpot moved into a removed group or, against
// an override's group, into a group config lacks, and a codec mismatch, which keeps the file as it is.
function differs(objects: Record<string, ObjectReport>, issues: Issue[]): boolean {
  const same = (c: Change) => SAME.has(c.kind) || (c.kind === 'removed-group' && c.field === undefined)
  return (
    Object.values(objects).some((report) => report.changes.some((c) => !same(c))) ||
    issues.some((issue) => issue.code === 'W_CODEC_MISMATCH')
  )
}

// The notes that are no difference between config and the portal for --check --exit-code.
const SAME = new Set<Change['kind']>(['excluded', 'removed', 'kept', 'ignored'])

// One issue for every list the key could not read, with the scopes to add. An incomplete read never passes as clean:
// what it left out was neither compared nor written.
function incompleteIssue(gaps: Gap[], target: string): Issue | undefined {
  if (gaps.length === 0) {
    return undefined
  }
  const unread = gaps.map((g) =>
    g.object === undefined
      ? 'the custom object schemas list, so no custom object'
      : `the ${g.list} list of ${g.object}`,
  )
  const scopes = [...new Set(gaps.map((g) => g.scope))]
  return {
    code: 'E_INCOMPLETE',
    message: `pull did not read everything in scope: ${unread.join(', ')}. Nothing there was compared or written.`,
    fix: `add the scope${scopes.length > 1 ? 's' : ''} ${scopes.join(', ')} to the key, then run npx ${bin} pull ${targetFlag(target)}`,
  }
}

// Every object file of the project, parsed. The loader accepted them all, so read() cannot throw here.
function objectFiles(files: Record<string, string>, at: Layout): Map<string, ObjectFile> {
  const out = new Map<string, ObjectFile>()
  for (const [file, text] of Object.entries(files)) {
    if (!inDir(at, file) || file === at.barrel || inPipelines(at, file)) {
      continue
    }
    const result = read(text, file)
    if (result.kind === 'object') {
      out.set(file, result.data)
    }
  }
  return out
}

// The file and export that hold an object today. The loader rejects duplicates, so there is at most one.
function findHome(parsed: Map<string, ObjectFile>, object: string): Home | undefined {
  for (const [file, data] of parsed) {
    const index = data.exports.findIndex((e) => e.object === object)
    if (index >= 0) {
      return { file, data, index }
    }
  }
  return undefined
}

// The name and builder of the export for an object that has none yet.
function freshExport(object: string, scope: ObjectScope): MergeInput['fresh'] {
  return {
    name: scope.as ?? exportName(object),
    builder: STANDARD_OBJECTS.has(object) ? 'defineObject' : 'defineCustomObject',
  }
}

// The object file with the merged export in its home, or `fresh`, a new file under <dir>/objects, for an object with no
// home.
function place(home: Home | undefined, fresh: string, merged: ObjectExport): [file: string, data: ObjectFile] {
  if (!home) {
    return [fresh, { imports: [], exports: [merged] }]
  }
  return [home.file, { ...home.data, exports: home.data.exports.map((e, i) => (i === home.index ? merged : e)) }]
}

// <removed> stands for the path of removed.ts in the folder of object files.
const LABELS: Record<Change['kind'], string> = {
  added: 'added',
  changed: 'changed',
  missing: 'missing in portal',
  'local-only': 'only in config',
  excluded: 'skipped on this target, kept as written',
  shadowed: 'refers to a shadowed portal name, not written',
  removed: 'in <removed>, not written back',
  'removed-group': 'its group is in <removed>, not written',
  kept: 'config change kept',
  conflict: 'conflict, config kept',
  'removed-in-hubspot': 'removed in HubSpot, kept in config',
  ignored: 'ignored on this target, kept as written',
  'override-group': 'its portal group is not in config, override kept',
}

// The kinds whose line shows the file's value and the portal's.
const SHOWN = new Set<Change['kind']>(['changed', 'removed-group', 'override-group'])

function label(kind: Change['kind'], at: Layout): string {
  return LABELS[kind].replace('<removed>', at.removed)
}

function summary(data: PullData, dryRun: boolean, at: Layout, newState: string | undefined): string {
  const lines: string[] = []
  for (const [object, report] of Object.entries(data.objects)) {
    const { added, changed, unchanged, missing } = report
    lines.push(`${object}: ${added} added, ${changed} changed, ${unchanged} unchanged, ${missing} missing in portal`)
    for (const c of report.changes) {
      const where = c.field === undefined ? c.address : `${c.address}#${c.field}`
      const values = SHOWN.has(c.kind) && c.field !== undefined
      const diff = values ? ` ${show(c.before)} -> ${show(c.after)}` : ''
      lines.push(`  ${label(c.kind, at)}: ${where}${diff}${portalSide(c, data.target)}`)
    }
  }
  const verb = dryRun ? 'would write' : 'wrote'
  lines.push(...(data.files.length > 0 ? data.files.map((file) => `${verb} ${file}`) : ['Files are up to date']))
  const recorded = data.state === undefined ? 0 : data.state.recorded
  if (recorded > 0) {
    lines.push(`Recorded the agreed values of ${plural(recorded, 'resource')} in state`)
  }
  if (newState !== undefined) {
    lines.push(`State for portal ${data.portalId} is new: ${newState}`)
  }
  return `${lines.join('\n')}\n`
}

// A unit pull kept: both values, and the command that takes the portal side.
function portalSide(c: Change, target: string): string {
  if (!(ACCEPTABLE.has(c.kind) && c.field !== undefined)) {
    return ''
  }
  const values = c.kind === 'removed-in-hubspot' ? '' : ` config ${show(c.before)}, portal ${show(c.after)};`
  return `${values} take the portal side: ${acceptCommand(target, c.address, c.field)}`
}

function show(value: unknown): string {
  return value === undefined ? 'none' : JSON.stringify(value)
}

// Per object, the portal's pipelines outside the pull scope, each listed in `lines`. Without pipelines: true, pull
// refreshes only the pipelines the files define.
function outsidePipelines(loaded: Loaded, portal: Portal, lines: string[]): Record<string, string[]> {
  const pipelines: Record<string, string[]> = {}
  for (const live of portal.objects) {
    const defined = (id: string) => Object.hasOwn(loaded.ir.resources, `pipeline:${live.object}/${id}`)
    const all = loaded.config.objects[live.object]?.pipelines === true
    const outside = all ? [] : (live.pipelines ?? []).filter((p) => !defined(p.id))
    if (outside.length === 0) {
      continue
    }
    pipelines[live.object] = outside.map((p) => sanitize(p.id))
    for (const p of outside) {
      lines.push(
        `  pipeline:${live.object}/${sanitize(p.id)}  (${sanitize(`"${p.label}"`, 200)}; set objects.${live.object}.pipelines to true)`,
      )
    }
  }
  return pipelines
}

function discover(
  target: string,
  portalId: number,
  loaded: Loaded,
  portal: Portal,
  warnings: Issue[],
): Result<DiscoverData> {
  const scopes = loaded.config.objects
  const lines: string[] = []
  const objects = portal.otherObjects.map((name) => sanitize(name))
  for (const name of objects) {
    lines.push(`  object:${name}  (custom object; add ${name}: {} under objects)`)
  }
  const properties: Record<string, string[]> = {}
  for (const live of portal.objects) {
    const scope = scopeOf(scopes[live.object], definedOn(loaded.ir, live.object))
    const outside = live.properties.filter((p) => !inScope(scope, p)).sort((a, b) => (a.name < b.name ? -1 : 1))
    if (outside.length === 0) {
      continue
    }
    properties[live.object] = outside.map((p) => sanitize(p.name))
    for (const p of outside) {
      const address = `property:${live.object}/${p.name}`
      // A custom property is outside the scope because custom is off, or because exclude covers it.
      let why = `custom; set objects.${live.object}.custom to true`
      if (p.hubspotDefined) {
        why = `HubSpot-defined; ${intoScope(scopes, address, true)}`
      } else if (scope.exclude(p.name)) {
        why = `custom, excluded by objects.${live.object}.exclude; ${intoScope(scopes, address, false)}`
      }
      lines.push(`  property:${live.object}/${sanitize(p.name)}  (${sanitize(why, 400)})`)
    }
  }
  const pipelines = outsidePipelines(loaded, portal, lines)
  let head = `Everything the portal holds for target ${target} is in the pull scope.`
  if (lines.length > 0) {
    head = `Outside the pull scope of target ${target} (portal ${portalId}):`
  } else if (portal.gaps.length > 0) {
    head = `Nothing outside the pull scope of target ${target} in the lists the key could read.`
  }
  return {
    data: { target, portalId, objects, properties, pipelines },
    issues: warnings,
    text: `${[head, ...lines, 'Nothing written.'].join('\n')}\n`,
    exitCode: portal.gaps.length > 0 ? exitCodes.error : exitCodes.done,
  }
}
