// compare: what would change in b to match a. a is desired, b observed, each config, a target read now or a snapshot.
// Pure. Unknown stays unknown: a side that could not read an address never proves it equal or absent, so such a
// comparison is incomplete and never a clean result.
import type { ObjectScope } from '@kalup/core'
import { parseAddress } from '../ir/address.js'
import type {
  Address,
  IROption,
  IRResource,
  Issue,
  Lifecycle,
  ObjectCoverage,
  UnsupportedProperty,
} from '../ir/types.js'
import { type ExitCode, exitCodes } from '../lib/errors.js'
import { plural } from '../lib/plural.js'
import { sanitize } from '../lib/sanitize.js'
import { byCodeUnit } from '../loader/load.js'
import { classify, type Spec, type UnitClass, type UnitResult } from '../plan/classify.js'
import { type Observation, type Side, type Status, statusOf } from './observe.js'
import {
  CAPTURED,
  capturedSpec,
  DISPOSITION,
  intoScope,
  keptNote,
  nameOf,
  objectOf,
  observedSpec,
  outOfScopeNote,
  outsidePull,
  ownedFields,
  pullCommand,
  shadowedNote,
  shadows,
  specOf,
} from './units.js'

export type DifferenceStatus = 'differs' | 'only-a' | 'only-b' | 'unmanaged' | 'unknown' | 'excluded'

export interface Comparison {
  a: Side
  b: Side
  /** No address unknown, and every object key either side names was read on both. */
  complete: boolean
  counts: {
    differs: number
    equal: number
    excluded: number
    onlyA: number
    onlyB: number
    unknown: number
    unmanaged: number
  }
  /** Every address that is not equal, sorted. */
  differences: Difference[]
}

export interface Difference {
  address: Address
  /** before is b's value, after a's, as in a plan. */
  changes?: { after: unknown; before: unknown; class: UnitClass; op: 'add' | 'remove'; unit: string }[]
  held?: { a: unknown; b: unknown; class: UnitClass; unit: string }[]
  notes?: { b: unknown; note: string; unit: string }[]
  /** unknown and excluded: why, naming the side. Human text, sanitized. */
  reason?: string
  status: DifferenceStatus
}

export interface CompareOptions {
  /**
   * The project's pull scope, `objects` in kalup.config.ts, when there is a project. A kept option on a property outside
   * it gets the note to add the name to `include`, since pull keeps such a property as written. Absent: every property
   * counts as in scope.
   */
  objects?: Record<string, ObjectScope>
  /** Per side, the addresses a lookup override covers there, which compare cannot apply: they are unknown. */
  overridden?: { a?: readonly Address[]; b?: readonly Address[] }
}

const COUNT = {
  differs: 'differs',
  'only-a': 'onlyA',
  'only-b': 'onlyB',
  unmanaged: 'unmanaged',
  unknown: 'unknown',
  excluded: 'excluded',
} as const

const LINE_MAX = 200

// One side's view of an address: whether it is managed, and the fields and options it owns. A config reference owns
// nothing, so only its presence compares.
interface View {
  lifecycle?: Lifecycle
  managed: boolean
  spec?: Spec
}

/** Every address present, unsupported or unaddressable on either side, classified. */
export function compare(a: Observation, b: Observation, options: CompareOptions = {}): Comparison {
  const counts = { equal: 0, differs: 0, onlyA: 0, onlyB: 0, unmanaged: 0, unknown: 0, excluded: 0 }
  const differences: Difference[] = []
  for (const address of comparedSet(a, b)) {
    const difference = compareAddress(address, a, b, options)
    if (difference) {
      counts[COUNT[difference.status]] += 1
      differences.push(difference)
    } else {
      counts.equal += 1
    }
  }
  return { a: a.side, b: b.side, complete: counts.unknown === 0 && unread(a, b).length === 0, counts, differences }
}

/**
 * The exit: incomplete is 1 with E_INCOMPLETE naming what was not compared, whatever else differs. Otherwise 2 when
 * `exitCode` asks and anything differs or is on one side only, else 0. Unmanaged and excluded never count.
 */
export function compareOutcome(
  comparison: Comparison,
  a: Observation,
  b: Observation,
  exitCode: boolean,
): { exitCode: ExitCode; issues: Issue[] } {
  if (!comparison.complete) {
    return { exitCode: exitCodes.error, issues: [incomplete(comparison, a, b)] }
  }
  const { differs, onlyA, onlyB } = comparison.counts
  const different = exitCode && differs + onlyA + onlyB > 0
  return { exitCode: different ? exitCodes.differences : exitCodes.done, issues: [] }
}

/** The comparison as lines a person reads. Every line is sanitized: portal strings reach it. */
export function compareText(comparison: Comparison): string {
  const { a, b, counts, differences } = comparison
  const lines = [
    `a: ${describe(a)}`,
    `b: ${describe(b)}`,
    `${counts.equal} equal, ${plural(counts.differs, 'differs', 'differ')}, ${counts.onlyA} only in a, ${counts.onlyB} only in b, ${counts.unmanaged} unmanaged, ${counts.unknown} unknown, ${counts.excluded} skipped`,
  ]
  for (const d of differences) {
    lines.push(`${STATUS_TEXT[d.status]}: ${d.address}${d.reason === undefined ? '' : ` (${d.reason})`}`)
    for (const c of d.changes ?? []) {
      lines.push(`  ${c.op} ${c.unit}: ${show(c.before)} -> ${show(c.after)}`)
    }
    for (const h of d.held ?? []) {
      lines.push(`  ${h.unit} differs: a ${show(h.a)}, b ${show(h.b)}`)
    }
    for (const n of d.notes ?? []) {
      lines.push(`  kept ${n.unit}: ${show(n.b)}`)
    }
  }
  return `${lines.map((line) => sanitize(line, LINE_MAX)).join('\n')}\n`
}

/** What a compare argument names: config, a target declared in the config, or else a snapshot file. */
export function resolveSide(arg: string, declaredTargets: readonly string[]): Side['kind'] {
  if (arg === 'config') {
    return 'config'
  }
  return declaredTargets.includes(arg) ? 'target' : 'snapshot'
}

const STATUS_TEXT: Record<DifferenceStatus, string> = {
  differs: 'differs',
  'only-a': 'only in a',
  'only-b': 'only in b',
  unmanaged: 'unmanaged',
  unknown: 'unknown',
  excluded: 'excluded',
}

function comparedSet(a: Observation, b: Observation): Address[] {
  const set = new Set<Address>()
  for (const side of [a, b]) {
    for (const address of Object.keys(side.resources)) {
      set.add(address)
    }
    for (const [key, object] of Object.entries(side.coverage?.objects ?? {})) {
      for (const name of [...(object.unsupported ?? []).map((u) => u.name), ...(object.unaddressable ?? [])]) {
        set.add(`property:${key}/${name}`)
      }
      if (object.unsupportedSchema) {
        set.add(`object:${key}`)
      }
    }
  }
  return [...set].sort(byCodeUnit)
}

// undefined when the address is equal on both sides.
function compareAddress(
  address: Address,
  a: Observation,
  b: Observation,
  options: CompareOptions,
): Difference | undefined {
  const statusA = statusOf(a, address)
  const statusB = statusOf(b, address)
  const unknown = [
    unknownReason(a, address, statusA, options.overridden?.a),
    unknownReason(b, address, statusB, options.overridden?.b),
  ].filter((r) => r !== undefined)
  if (unknown.length > 0) {
    return { address, status: 'unknown', reason: unknown.map((r) => sanitize(r)).join('; ') }
  }
  const excluded = [excludedReason(a, address, statusA), excludedReason(b, address, statusB)].filter(
    (r) => r !== undefined,
  )
  if (excluded.length > 0) {
    return { address, status: 'excluded', reason: excluded.map((r) => sanitize(r)).join('; ') }
  }
  const inA = statusA === 'present' || statusA === 'unsupported'
  const inB = statusB === 'present' || statusB === 'unsupported'
  // What only an observation holds, against config, is unmanaged: listed, never a difference.
  if (!inB) {
    return { address, status: b.coverage ? 'only-a' : 'unmanaged' }
  }
  if (!inA) {
    return { address, status: a.coverage ? 'only-b' : 'unmanaged' }
  }
  return classifyAddress(address, view(a, address, statusA), view(b, address, statusB), b, options.objects)
}

// Both sides hold the address. Only converged units, or a config reference, make it equal.
function classifyAddress(
  address: Address,
  a: View,
  b: View,
  observed: Observation,
  objects: CompareOptions['objects'],
): Difference | undefined {
  if (!(a.spec && b.spec)) {
    return undefined
  }
  if (a.managed !== b.managed) {
    return { address, status: 'differs', held: [{ unit: 'managed', class: 'diverged', a: a.managed, b: b.managed }] }
  }
  const configB = observed.side.kind === 'config'
  const desired = configB && b.spec.options ? statedDescriptions(a.spec, b.spec.options) : a.spec
  const units = classify(undefined, desired, b.spec, {
    options: a.lifecycle?.options ?? 'additive',
    removedOptions: a.lifecycle?.removedOptions,
  })
  return differenceOf(address, units, note(observed, address, objects))
}

// Unit classes map to the plan's dispositions: a write is a change, a hold is held, a keep is a note.
function differenceOf(address: Address, units: UnitResult[], kept: string): Difference | undefined {
  const difference: Difference = { address, status: 'differs' }
  for (const { unit, class: kind, desired: after, observed: before } of units) {
    const disposition = DISPOSITION[kind]
    if (disposition === 'write') {
      const op = kind === 'remove' ? 'remove' : 'add'
      difference.changes = [
        ...(difference.changes ?? []),
        { unit, class: kind, op, before: before ?? null, after: after ?? null },
      ]
    } else if (disposition === 'hold') {
      difference.held = [...(difference.held ?? []), { unit, class: kind, a: after, b: before }]
    } else if (disposition === 'note') {
      difference.notes = [...(difference.notes ?? []), { unit, b: before, note: kept }]
    }
  }
  return difference.changes || difference.held || difference.notes ? difference : undefined
}

// How to bring a kept option into config, from the side that holds it: a target now, a snapshot as it was. Config
// holds it already. pull never writes a resource that names a shadowed portal name, or a property outside its object's
// pull scope, so for those the note names the override or `include` instead.
function note(observed: Observation, address: Address, objects: CompareOptions['objects']): string {
  const { side } = observed
  if (side.kind === 'config') {
    return 'kept, since options are additive'
  }
  const unpulled = unpulledOf(observed, side.name, address, objects)
  if (side.kind === 'target') {
    return unpulled === undefined ? keptNote(side.name, address) : `kept; ${unpulled}`
  }
  if (unpulled !== undefined) {
    return `kept; the snapshot shows the portal as it was, and ${unpulled}`
  }
  const pull = pullCommand(side.name, address)
  return `kept; the snapshot shows the portal as it was: take a new snapshot, or run ${pull} to add it to config`
}

// Why no pull brings a kept option into config from a portal side, or undefined when the printed pull does. A snapshot
// keeps no meta, so a reference there, HubSpot-defined or calculated, is surely in the pull scope only when include
// names it.
function unpulledOf(
  observed: Observation,
  target: string,
  address: Address,
  objects: CompareOptions['objects'],
): string | undefined {
  const resource = Object.hasOwn(observed.resources, address) ? observed.resources[address] : undefined
  if (resource !== undefined && shadows(resource)) {
    return shadowedNote(target)
  }
  if (objects === undefined) {
    return undefined
  }
  const hubspotDefined = observed.meta?.[address]?.hubspotDefined === true
  if (outsidePull(objects, address, hubspotDefined)) {
    return outOfScopeNote(objects, address, hubspotDefined)
  }
  const unknown = observed.meta === undefined && resource?.managed === false
  return unknown && outsidePull(objects, address, true) ? maybeOutOfScopeNote(objects, address) : undefined
}

// Why a pull may do nothing for a reference a snapshot holds, and the way out that works whether HubSpot defines it.
function maybeOutOfScopeNote(objects: NonNullable<CompareOptions['objects']>, address: Address): string {
  const object = objectOf(address)
  return `it may be outside the pull scope of ${object}, since a snapshot does not record whether HubSpot defines it; ${intoScope(objects, address, true)} in kalup.config.ts to take the portal side with pull`
}

// Config as the observed side owns an option's description only when it states one, so a description the config
// option leaves out is not compared.
function statedDescriptions(desired: Spec, config: IROption[]): Spec {
  const unstated = new Set(config.filter((o) => o.description === undefined).map((o) => o.value))
  const options = (desired.options ?? []).map((o) => {
    if (!unstated.has(o.value)) {
      return o
    }
    const { description: _description, ...rest } = o
    return rest
  })
  return { ...desired, options }
}

function view(side: Observation, address: Address, status: Status): View {
  if (!side.coverage) {
    return configView(side.resources[address] as IRResource)
  }
  if (status !== 'unsupported') {
    const resource = side.resources[address] as IRResource
    return { managed: resource.managed, spec: optionDefaults(capturedSpec(resource)) }
  }
  const object = side.coverage.objects[objectOf(address)] as ObjectCoverage
  if (parseAddress(address).type === 'object') {
    return { managed: true, spec: observedSpec(CAPTURED.object, { ...object.unsupportedSchema }) }
  }
  const u = object.unsupported?.find((p) => p.name === nameOf(address)) as UnsupportedProperty
  const { hubspotDefined, options, ...definition } = u
  return {
    managed: !hubspotDefined,
    spec: optionDefaults(observedSpec(CAPTURED.unsupported, definition, options ?? [])),
  }
}

// Config owns exactly the fields it states, less the ones ignoreChanges hands to the portal once the resource exists.
function configView(resource: IRResource): View {
  if (!resource.managed) {
    return { managed: false }
  }
  return { managed: true, lifecycle: resource.lifecycle, spec: specOf(ownedFields(resource)) }
}

// An observation as the desired side owns each option's description, which classify compares only when the desired
// option states it, so a missing one is filled with its default. hidden too, and on both sides, so an option reads
// the same whichever side holds it.
function optionDefaults(spec: Spec): Spec {
  const { options } = spec
  if (options === undefined) {
    return spec
  }
  return {
    ...spec,
    options: options.map((o) => ({ ...o, hidden: o.hidden ?? false, description: o.description ?? '' })),
  }
}

function unknownReason(
  side: Observation,
  address: Address,
  status: Status,
  overridden: readonly Address[] | undefined,
): string | undefined {
  const name = describeShort(side.side)
  // A skip wins over a lookup override on the same address, as in plan: the address is not read at all.
  if (status !== 'excluded' && overridden?.includes(address)) {
    return `${name} has a lookup override for it; this version manages no lookup resources`
  }
  const key = objectOf(address)
  if (status === 'unreadable') {
    const object = coverageOf(side, key)
    // A read object: the property is one config names that its group's name kept out.
    if (object?.status === 'read') {
      return `${name} could not capture it: its group's name in the portal holds whitespace`
    }
    const scope = object?.missingScope
    return `${name} could not read ${key}${scope === undefined ? '' : `: the key lacks ${scope}`}`
  }
  return status === 'not-observed' ? `${name} did not read ${key}` : undefined
}

function excludedReason(side: Observation, address: Address, status: Status): string | undefined {
  if (status !== 'excluded') {
    return undefined
  }
  const name = describeShort(side.side)
  const key = objectOf(address)
  const object = coverageOf(side, key)
  if (object?.status === 'excluded') {
    return `a skip override on ${name} leaves out object:${key}`
  }
  return object?.excluded?.includes(address)
    ? `a skip override on ${name} leaves it out`
    : `outside the read scope of ${name}`
}

interface Unread {
  object: string
  /** undefined: the side has no entry for the object at all. */
  scope?: string
  side: Observation
  unreadable: boolean
}

// Object keys either side names that a side did not read: unreadable, or missing from its coverage.
function unread(a: Observation, b: Observation): Unread[] {
  const keys = new Set<string>()
  for (const side of [a, b]) {
    const named = side.coverage ? Object.keys(side.coverage.objects) : Object.keys(side.resources).map(objectOf)
    for (const key of named) {
      keys.add(key)
    }
  }
  const out: Unread[] = []
  for (const side of [a, b]) {
    for (const key of [...keys].sort(byCodeUnit)) {
      const object = coverageOf(side, key)
      if (side.coverage && (object === undefined || object.status === 'unreadable')) {
        out.push({ side, object: key, scope: object?.missingScope, unreadable: object !== undefined })
      }
    }
  }
  return out
}

function incomplete(comparison: Comparison, a: Observation, b: Observation): Issue {
  const objects = unread(a, b)
  const keys = new Set(objects.map((o) => o.object))
  const items = [
    ...objects.map(({ side, object, scope, unreadable }) => {
      const name = describeShort(side.side)
      if (!unreadable) {
        return sanitize(`${object}, which ${name} did not read`)
      }
      return sanitize(
        `${object} on ${name}${scope === undefined ? ', which could not be read' : `, whose key lacks ${scope}`}`,
      )
    }),
    // The reason is sanitized already; the address may come from a snapshot file.
    ...comparison.differences
      .filter((d) => d.status === 'unknown' && !keys.has(objectOf(d.address)))
      .map((d) => `${sanitize(d.address)}: ${d.reason}`),
  ]
  const scopes = [...new Set(objects.flatMap((o) => (o.scope === undefined ? [] : [sanitize(o.scope)])))].sort(
    byCodeUnit,
  )
  // A side with no entry for a key never read it. A target reads every key under objects, so the key is not there. A
  // snapshot may be older than the config, or config may not list the key either.
  const missing = (kind: Side['kind']) => [
    ...new Set(objects.filter((o) => !o.unreadable && o.side.side.kind === kind).map((o) => sanitize(o.object))),
  ]
  const unlisted = missing('target')
  const stale = missing('snapshot')
  const regroup = comparison.differences
    .filter((d) => d.status === 'unknown' && (uncaptured(a, d.address) || uncaptured(b, d.address)))
    .map((d) => sanitize(d.address))
  const fixes: string[] = []
  if (scopes.length > 0) {
    fixes.push(
      `add the scope${scopes.length > 1 ? 's' : ''} ${scopes.join(', ')} to the read key, then read the portal again`,
    )
  }
  if (unlisted.length > 0) {
    fixes.push(`add ${unlisted.join(', ')} to objects in kalup.config.ts`)
  }
  if (stale.length > 0) {
    const are = stale.length > 1 ? 'they are' : 'it is'
    fixes.push(`add ${stale.join(', ')} to objects in kalup.config.ts if ${are} not there, then take a new snapshot`)
  }
  if (regroup.length > 0) {
    const many = regroup.length > 1
    fixes.push(
      `rename the group${many ? 's' : ''} of ${regroup.join(', ')} in HubSpot to ${many ? 'names' : 'a name'} without spaces, then read the portal again`,
    )
  }
  const issue: Issue = {
    code: 'E_INCOMPLETE',
    message: `compare is incomplete: ${items.join('; ')}. Nothing there was compared.`,
  }
  if (fixes.length > 0) {
    issue.fix = fixes.join('; ')
  }
  return issue
}

// A property config names that a side read its object for and could not capture: its group's name holds whitespace.
function uncaptured(side: Observation, address: Address): boolean {
  return statusOf(side, address) === 'unreadable' && coverageOf(side, objectOf(address))?.status === 'read'
}

// A side's coverage of one object key, by own key only: a key such as 'constructor' must not find Object.prototype.
function coverageOf(side: Observation, key: string): ObjectCoverage | undefined {
  const objects = side.coverage?.objects
  return objects && Object.hasOwn(objects, key) ? objects[key] : undefined
}

function describe(side: Side): string {
  if (side.kind === 'config') {
    return 'config'
  }
  const target = `target ${side.name}, portal ${side.portalId}`
  return side.kind === 'target' ? target : `snapshot ${side.file} of ${target}, observed ${side.observedAt}`
}

function describeShort(side: Side): string {
  if (side.kind === 'config') {
    return 'config'
  }
  return side.kind === 'target' ? `target ${side.name}` : `snapshot ${side.file}`
}

function show(value: unknown): string {
  return value === undefined ? 'none' : JSON.stringify(value)
}
