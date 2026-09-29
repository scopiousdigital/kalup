// kalup compare: what would change in b to match a, each side config, a target read now, or a snapshot file. The
// project must be valid only for a config or target side, so two snapshot files compare anywhere. The local checks
// come first (the config, the snapshot files, the keys), then every target's portal guard, then the reads, all
// through read-tagged paths. An incomplete comparison is exit 1, never a clean result.
import type { Address, Issue, Loaded } from '@kalup/core'
import {
  type Comparison,
  compareOutcome,
  compare as compareSides,
  compareText,
  resolveSide,
} from '../engine/compare.js'
import { configObservation, type Observation, observeTarget, type Side } from '../engine/observe.js'
import { fromSnapshot } from '../engine/snapshot.js'
import { guardPortal } from '../lib/guard.js'
import { exitCodes, KalupError } from '../lib/output.js'
import { sanitize } from '../lib/sanitize.js'
import type { Context, Result } from './context.js'
import { readArgFile } from './files.js'
import { type Connection, connect } from './target.js'
import { type Checked, check } from './validate.js'

// A side before any request: config and a snapshot file are observed already, a target has its key and client.
type Opened = { observation: Observation } | (Connection & { name: string })

export async function compare(ctx: Context): Promise<Result<Comparison>> {
  const found = findProject(ctx)
  const project = found instanceof KalupError ? undefined : found
  const declared = project?.loaded ? Object.keys(project.loaded.config.targets) : []
  const sides = ctx.args.map((arg) => ({ arg, kind: resolveSide(arg, declared) }))
  const issues: Issue[] = []
  if (sides.some((side) => side.kind !== 'snapshot')) {
    issues.push(...validate(found))
  }
  // A config side compared with a target is that target's effective config: its definition overrides applied.
  const other = (index: number) => sides[1 - index]
  const opened = sides.map(({ arg, kind }, index) =>
    open(ctx.cwd, arg, kind, project, issues, other(index)?.kind === 'target' ? other(index)?.arg : undefined),
  )
  for (const side of opened) {
    if ('http' in side) {
      // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, every guard before any read
      await guardPortal(side.http, side.guard)
    }
  }
  const observations: Observation[] = []
  for (const side of opened) {
    if ('http' in side) {
      // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one portal at a time
      const read = await observeTarget(side.http, project?.loaded as Loaded, side.name)
      issues.push(...read.issues)
      observations.push(read.observation)
    } else {
      observations.push(side.observation)
    }
  }
  const [a, b] = observations as [Observation, Observation]
  const overridden = { a: lookupOverrides(project?.loaded, a), b: lookupOverrides(project?.loaded, b) }
  // The pull scope decides which pull a kept option's note may print: pull runs against this project's config.
  const comparison = compareSides(a, b, { overridden, objects: project?.loaded?.config.objects })
  const outcome = compareOutcome(comparison, a, b, ctx.flags.exitCode)
  return {
    data: comparison,
    exitCode: outcome.exitCode,
    issues: unique([...issues, ...outcome.issues]),
    text: compareText(comparison),
  }
}

// The project, valid or not, or E_NO_CONFIG when there is none.
function findProject(ctx: Context): Checked | KalupError {
  try {
    return check(ctx)
  } catch (error) {
    if (error instanceof KalupError && error.issues[0]?.code === 'E_NO_CONFIG') {
      return error
    }
    throw error
  }
}

// A config or target side needs a project that loads and validates: exit 3 otherwise. Returns its warnings.
function validate(found: Checked | KalupError): Issue[] {
  if (found instanceof KalupError) {
    throw found
  }
  if (!found.loaded || found.issues.length > 0) {
    throw new KalupError([...found.issues, ...found.warnings], exitCodes.invalid)
  }
  return found.warnings
}

// `target`: for a config side, the target the other side reads.
function open(
  cwd: string,
  arg: string,
  kind: Side['kind'],
  project: Checked | undefined,
  issues: Issue[],
  target: string | undefined,
): Opened {
  if (kind === 'snapshot') {
    return { observation: readSnapshot(cwd, arg, project) }
  }
  // validate passed, so the project loaded.
  const { root, loaded } = project as Checked & { loaded: Loaded }
  if (kind === 'config') {
    return { observation: configObservation(loaded, target) }
  }
  return { ...connect(root, loaded, arg, issues), name: arg }
}

// A side that is neither config nor a declared target names a snapshot file. A config that does not load hides its
// targets, and the argument may be one: its issues come first then.
function readSnapshot(cwd: string, file: string, project: Checked | undefined): Observation {
  const text = readArgFile(cwd, file)
  if (text !== undefined) {
    return fromSnapshot(text, file)
  }
  if (project && !project.loaded) {
    throw new KalupError([...project.issues, ...project.warnings], exitCodes.invalid)
  }
  throw new KalupError({
    code: 'E_SNAPSHOT',
    message: `'${sanitize(file)}' is neither config, a target declared in kalup.config.ts nor a file`,
    file,
    fix: 'pass config, a target declared in kalup.config.ts, or a file the snapshot command wrote',
  })
}

// Two targets can raise the same issue, a property no builder carries in both for one: it is listed once.
function unique(issues: Issue[]): Issue[] {
  return issues.filter(
    (issue, i) => issues.findIndex((o) => o.code === issue.code && o.message === issue.message) === i,
  )
}

// The addresses a target side cannot compare: a lookup override applies to lookup resources, which this version does
// not manage.
function lookupOverrides(loaded: Loaded | undefined, observation: Observation): Address[] {
  const { side } = observation
  if (side.kind !== 'target' || !loaded) {
    return []
  }
  return Object.entries(loaded.ir.targets[side.name]?.overrides ?? {})
    .filter(([, o]) => o.lookup !== undefined)
    .map(([address]) => address)
}
