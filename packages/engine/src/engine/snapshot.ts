// A snapshot is an ir/1 document from the portal frontend: the resources one read of a target captured, and an
// observation block saying which target, when, and how completely. The engine turns an observation into that document
// and back; the command owns the file.
import { createHash } from 'node:crypto'
import { bin } from '../brand.js'
import { isAddress, parseAddress } from '../ir/address.js'
import { stableStringify } from '../ir/serialize.js'
import type { Coverage, IR, IRObservation, IRResource, Issue, ObjectCoverage } from '../ir/types.js'
import { validateIR } from '../ir/validate.js'
import { type ExitCode, exitCodes, KalupError } from '../lib/errors.js'
import { sanitize } from '../lib/sanitize.js'
import { byCodeUnit } from '../loader/load.js'
import type { Observation } from './observe.js'

export type Snapshot = IR & { observation: IRObservation }

export interface SnapshotMeta {
  /** The CLI that read the portal. The snapshot keeps its name and version, with frontend 'portal'. */
  generator: { name: string; version: string }
  /** When the read finished, as Date.prototype.toISOString writes it: the one timestamp a snapshot carries. */
  observedAt: string
  project: string
}

const FIX = 'pass a file the snapshot command wrote, or config for the config files'

/**
 * The document for a read of a target. Unsupported properties stay in coverage, since no resource can carry them. It
 * conforms to ir/1 before it is returned, so a snapshot that could not be read back is never written: one that does
 * not is a bug and throws.
 */
export function toSnapshot(observation: Observation, meta: SnapshotMeta): Snapshot {
  const { side, coverage, resources } = observation
  if (side.kind === 'config' || coverage === undefined) {
    throw new Error('only a read of a target becomes a snapshot')
  }
  const snapshot: Snapshot = {
    irVersion: 1,
    project: meta.project,
    generator: { name: meta.generator.name, version: meta.generator.version, frontend: 'portal' },
    resources: sorted(resources),
    targets: {},
    tombstones: {},
    observation: { target: { name: side.name, portalId: side.portalId }, observedAt: meta.observedAt, coverage },
  }
  const issues = validateIR(snapshot)
  if (issues.length > 0) {
    const found = issues.map((issue) => [issue.configPath, issue.message].filter(Boolean).join(': '))
    throw new Error(`the snapshot does not conform to ir/1: ${found.join('; ')}`)
  }
  return snapshot
}

/** The file's text: keys sorted at every level, unsafe characters escaped, one trailing newline. */
export function snapshotText(snapshot: Snapshot): string {
  return `${stableStringify(snapshot)}\n`
}

/**
 * The checked snapshot document in `text`. E_SNAPSHOT when it is not JSON (exit 1), another IR version or not a
 * snapshot (exit 3); the E_IR_SCHEMA issues, each naming `file`, when it breaks the ir/1 schema (exit 3). A resource whose type is not the
 * type of its address is no read of a portal: E_SNAPSHOT, exit 3, one issue per address in code-unit order. So is a
 * coverage object key, or an unsupported or unaddressable property name, that forms no address, which a comparison
 * could not name.
 */
export function parseSnapshot(text: string, file: string): Snapshot {
  const document = parseJson(text)
  if (document === notJson) {
    throw snapshotError(`${sanitize(file)} is not JSON`, file, exitCodes.error)
  }
  // Another IR version is another version's snapshot, whatever else it holds: never read as ir/1.
  const irVersion = (document as { irVersion?: unknown } | null)?.irVersion
  if (typeof irVersion === 'number' && irVersion !== 1) {
    throw new KalupError(
      {
        code: 'E_SNAPSHOT',
        message: `${sanitize(file)} is an ir/${irVersion} document, and this version of ${bin} reads ir/1 snapshots`,
        file,
        fix: `take the snapshot again with this version (${bin} snapshot --target <name>), or read it with the version of ${bin} that wrote it`,
      },
      exitCodes.invalid,
    )
  }
  if (!isSnapshot(document)) {
    throw snapshotError(
      `${sanitize(file)} is not a snapshot: it is not an ir/1 document from a portal read with an observation block`,
      file,
      exitCodes.invalid,
    )
  }
  const issues = validateIR(document)
  if (issues.length > 0) {
    // A field name in a message comes from the file.
    throw new KalupError(
      issues.map((issue) => ({ ...issue, message: sanitize(issue.message, 300), file })),
      exitCodes.invalid,
    )
  }
  const { resources } = document as Snapshot
  const mistyped = Object.keys(resources)
    .filter((address) => resources[address]?.type !== parseAddress(address).type)
    .sort(byCodeUnit)
  if (mistyped.length > 0) {
    throw new KalupError(
      mistyped.map((address) => ({
        code: 'E_SNAPSHOT',
        message: `${sanitize(file)} is not a snapshot: ${sanitize(address)} holds a resource of type ${sanitize(String(resources[address]?.type))}`,
        file,
        fix: FIX,
      })),
      exitCodes.invalid,
    )
  }
  const unaddressable = Object.entries((document as Snapshot).observation.coverage.objects)
    .flatMap(([key, o]) => [
      `object:${key}`,
      ...(o.unsupported ?? []).map((u) => `property:${key}/${u.name}`),
      ...(o.unaddressable ?? []).map((name) => `property:${key}/${name}`),
    ])
    .filter((address) => !isAddress(address))
    .sort(byCodeUnit)
  if (unaddressable.length > 0) {
    throw new KalupError(
      unaddressable.map((address) => ({
        code: 'E_SNAPSHOT',
        message: `${sanitize(file)} is not a snapshot: ${sanitize(address)} is not an address`,
        file,
        fix: FIX,
      })),
      exitCodes.invalid,
    )
  }
  return document as Snapshot
}

/** The observation a snapshot file records, with the errors of parseSnapshot. */
export function fromSnapshot(text: string, file: string): Observation {
  const { resources, observation } = parseSnapshot(text, file)
  const { target, observedAt, coverage } = observation
  return {
    side: { kind: 'snapshot', file, name: target.name, portalId: target.portalId, observedAt },
    resources: sorted(resources),
    coverage,
  }
}

const PLAIN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/
const UNSAFE = /[^a-z0-9_-]/gu
const EDGES = /^[_-]+|[_-]+$/g
const STAMP = /[-:.]/g

/**
 * Where a snapshot goes unless --out says otherwise, relative to the project root. A target name that is not a safe
 * directory name on every supported system becomes a slug plus the start of the SHA-256 of the exact name, so names
 * that differ only in case or in unsafe characters get directories of their own.
 */
export function snapshotPath(targetName: string, observedAt: string): string {
  return `.kalup/snapshots/${targetDir(targetName)}/${observedAt.replace(STAMP, '')}.json`
}

/** Where `plan --out` with no file writes a plan, relative to the project root, the target named as for a snapshot. */
export function planPath(targetName: string, planId: string): string {
  return `.kalup/plans/${targetDir(targetName)}-${planId}.json`
}

/**
 * W_INCOMPLETE for a read that left objects unread, or config properties uncaptured because their portal group's name
 * no address can hold, or that is not trusted yet on what settles after an apply or on a pair whose labels hold a type
 * HubSpot does not name yet, since what they hold is unknown. None for a complete read.
 */
export function incompleteIssues(coverage: Coverage, target: string): Issue[] {
  if (coverage.complete) {
    return []
  }
  const objects = Object.entries(coverage.objects).sort(([a], [b]) => byCodeUnit(a, b))
  const unread = objects.filter(([, o]) => o.status === 'unreadable')
  const names = unread.map(([key]) => sanitize(key))
  const properties = objects.flatMap(([key, o]) =>
    [...(o.unaddressable ?? [])].sort(byCodeUnit).map((name) => sanitize(`property:${key}/${name}`)),
  )
  const scopes = [...new Set(unread.flatMap(([, o]) => (o.missingScope === undefined ? [] : [o.missingScope])))]
    .sort(byCodeUnit)
    .map((scope) => sanitize(scope))
  // A pipelines or labels list that answered 403 has no name in the message, only the scopes fix.
  const lists = objects.some(
    ([, o]) =>
      o.pipelines?.status === 'unreadable' ||
      Object.values(o.associations?.with ?? {}).some((p) => p.status === 'unreadable'),
  )
  const waiting = waitOf(coverage, objects)
  const parts = [
    ...(names.length > 0 ? [`${listed(names)} ${names.length === 1 ? 'was' : 'were'} not read`] : []),
    ...(properties.length > 0
      ? [
          `${listed(properties)} ${properties.length === 1 ? 'is' : 'are'} in a portal group whose name no address can hold`,
        ]
      : []),
    ...waiting.parts,
  ]
  const one = names.length + properties.length + waiting.count === 1
  const which =
    parts.length > 0 ? `: ${parts.join(', and ')}, so what ${one ? 'it holds' : 'they hold'} is unknown` : ''
  const noun = scopes.length === 1 ? 'the scope' : 'the scopes'
  const fixes: string[] = []
  if (scopes.length > 0) {
    fixes.push(`add ${noun} ${listed(scopes)} to the read key of target ${sanitize(target)}`)
  } else if (names.length > 0 || lists || parts.length === 0) {
    fixes.push(`add the missing read scopes to the read key of target ${sanitize(target)}`)
  }
  if (properties.length > 0) {
    const many = properties.length > 1
    fixes.push(
      `rename the group${many ? 's' : ''} of ${listed(properties)} in HubSpot to ${many ? 'names' : 'a name'} without spaces`,
    )
  }
  return [
    {
      code: 'W_INCOMPLETE',
      message: `the snapshot of target ${sanitize(target)} is incomplete${which}`,
      fix:
        fixes.length > 0
          ? `${fixes.join(' and ')}, then take a new snapshot${waiting.later}`
          : `take a new snapshot${waiting.later}`,
    },
  ]
}

// What a read is not trusted on only until HubSpot settles, as parts of the message: what settles after an apply, and
// the pairs whose labels hold a type HubSpot does not name yet. `later` says when the next snapshot can hold them, and
// `count` is how many things the parts name, counting a pair as two.
function waitOf(
  coverage: Coverage,
  objects: [string, ObjectCoverage][],
): { count: number; later: string; parts: string[] } {
  const settling = Object.keys(coverage.settling ?? {})
    .sort(byCodeUnit)
    .map((address) => sanitize(address))
  const until = Object.values(coverage.settling ?? {})
    .map((s) => s.until)
    .sort(byCodeUnit)
    .at(-1)
  const pairs = [
    ...new Set(
      objects.flatMap(([key, o]) =>
        Object.entries(o.associations?.with ?? {}).flatMap(([other, p]) =>
          p.unnamed ? [[key, other].sort(byCodeUnit).join(' and ')] : [],
        ),
      ),
    ),
  ]
    .sort(byCodeUnit)
    .map((pair) => sanitize(pair))
  const parts: string[] = []
  if (settling.length > 0) {
    parts.push(`${listed(settling)} ${settling.length === 1 ? 'is' : 'are'} settling after an apply until ${until}`)
  }
  if (pairs.length > 0) {
    parts.push(`the associations between ${listed(pairs)} hold a type HubSpot's schema read does not name yet`)
  }
  let later = ''
  if (until !== undefined) {
    later = ` after ${until}`
  } else if (pairs.length > 0) {
    later = ' in a few minutes, once HubSpot names the new association'
  }
  return { count: settling.length + 2 * pairs.length, later, parts }
}

function targetDir(name: string): string {
  if (PLAIN.test(name) && !DEVICE.test(name)) {
    return name
  }
  const slug = name.toLowerCase().replace(UNSAFE, '_').replace(EDGES, '').slice(0, 40).replace(EDGES, '')
  return `${slug || 'target'}-${createHash('sha256').update(name).digest('hex').slice(0, 8)}`
}

export const notJson = Symbol('not JSON')

/** A document, or notJson. The SyntaxError is not kept: its message quotes the file's text. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return notJson
  }
}

function isSnapshot(document: unknown): boolean {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return false
  }
  const { generator } = document as { generator?: { frontend?: unknown } | null }
  return generator?.frontend === 'portal' && Object.hasOwn(document, 'observation')
}

function snapshotError(message: string, file: string, exitCode: ExitCode): KalupError {
  return new KalupError({ code: 'E_SNAPSHOT', message, file, fix: FIX }, exitCode)
}

function sorted(resources: Record<string, IRResource>): Record<string, IRResource> {
  return Object.fromEntries(Object.entries(resources).sort(([a], [b]) => byCodeUnit(a, b)))
}

function listed(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join('')
}
