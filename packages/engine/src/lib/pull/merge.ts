// The re-pull merge: the portal wins for what HubSpot owns, the file wins for what HubSpot cannot know. Where state owns
// a resource with a base, the base decides instead for each unit: a config change or a conflict keeps the file's value
// unless --accept takes the portal's. Pure: one object's export in, the merged export and the report out.
import type { Definition } from '@kalup/core'
import type { ObjectExport, Option, Property } from '../../grammar/types.js'
import { DEFAULTS } from '../../ir/defaults.js'
import type { Issue } from '../../ir/types.js'
import { FIELD_TYPES, HUBSPOT_TYPES } from '../../loader/tables.js'
import type { UnitResult } from '../../plan/classify.js'
import { sanitize } from '../sanitize.js'
import { camelCase } from './keys.js'
import { type LiveCustom, type LiveObject, type LiveProperty, SHADOWED, type UnsupportedProperty } from './normalize.js'
import { inScope, type Scope } from './scope.js'

export interface Change {
  address: string
  after?: unknown
  before?: unknown
  /** `label`, `options[value].label`, ... when the change is one field of the resource. */
  field?: string
  /**
   * `local-only`, `excluded` (a skip override on the target), `shadowed` (the portal resource refers to a name a name override shadows), `removed` (the
   * address is in removed.ts), `removed-group` (its group is in removed.ts: a new portal property is not
   * written, and with field `group`, a file property HubSpot moved there keeps the file's group), and against a base
   * `kept` (config changed it; the file's value stays), `conflict` (both sides changed it; the file's value stays) and
   * `removed-in-hubspot` (an option config and the base hold that the portal no longer does; it stays in the file) are
   * notes, and so are two from the target's definition override: `ignored` (a field only the target's lifecycle leaves
   * to its portal; the file keeps its value) and `override-group` (HubSpot moved a property whose group the override
   * states into a group config lacks; the override keeps its group). The other three decide the resource's count.
   * `kept`, `conflict`, `removed-group` and `override-group` carry the file's value in `before` and the portal's in
   * `after`.
   */
  kind:
    | 'added'
    | 'changed'
    | 'missing'
    | 'local-only'
    | 'excluded'
    | 'shadowed'
    | 'removed'
    | 'removed-group'
    | 'kept'
    | 'conflict'
    | 'removed-in-hubspot'
    | 'ignored'
    | 'override-group'
}

/** What the base says about one resource state owns. */
export interface Resolution {
  /**
   * Whether --accept takes the portal side of a unit pull would otherwise keep: a config change, a conflict, an option
   * config added or dropped, or an option HubSpot removed. Called only for those.
   */
  accept: (unit: string) => boolean
  /** Its owned units, classified against the base. */
  units: UnitResult[]
}

export interface Counts {
  added: number
  changed: number
  missing: number
  unchanged: number
}

export interface MergeInput {
  /** The addresses a skip override leaves out on the target: kept as written and noted. */
  excluded: ReadonlySet<string>
  /** The name and builder of the export when there is none yet. */
  fresh: { name: string; builder: ObjectExport['builder'] }
  live: LiveObject
  /** The export that holds this object today, or none on a first pull. */
  local?: ObjectExport
  /** The addresses pull may merge: the --only filter. */
  only: (address: string) => boolean
  /** The addresses in removed.ts: never written back, reported as `removed`. */
  removed?: ReadonlySet<string>
  /** The base's verdict on an address state owns, or undefined to merge it by the rules above. */
  resolve?: (address: string) => Resolution | undefined
  scope: Scope
  /** What the target's definition override keeps out of the shared file on a file property. */
  targetOnly?: (address: string) => TargetOnly | undefined
}

/** A target's own say on one file property, from its definition override. */
export interface TargetOnly {
  /** The override states the group, so a portal group the file lacks is not written for this one target. */
  group: boolean
  /** Fields the target's lifecycle ignores and the shared one does not, which the override does not state. */
  ignored: readonly string[]
}

export interface Merged {
  changes: Change[]
  counts: Counts
  export: ObjectExport
  issues: Issue[]
}

const HUBSPOT_FIELDS = [
  'label',
  'group',
  'fieldType',
  'description',
  'hasUniqueValue',
  'formField',
  'hidden',
  'displayOrder',
  'numberDisplayHint',
  'showCurrencySymbol',
  'currencyPropertyName',
  'textDisplayHint',
  'calculationFormula',
  'dataSensitivity',
] as const
const OPTION_FIELDS = ['label', 'hidden', 'description'] as const
// normalize leaves out an empty option description as it does a false `hidden`, so both are defaults here.
const OPTION_DEFAULTS: Record<string, unknown> = { ...DEFAULTS.option, description: '' }
// Notes: they never make a resource changed.
const NOTES = new Set<Change['kind']>([
  'local-only',
  'kept',
  'conflict',
  'removed-in-hubspot',
  'removed-group',
  'ignored',
  'override-group',
])
// `options[<value>]` and `options[<value>].<field>`. A value may hold `]`, so the field is matched from the end.
const MEMBER = /^options\[(.*)\](?:\.(label|hidden|description))?$/s
const CUSTOM_FIELDS = [
  'labels',
  'primaryDisplayProperty',
  'requiredProperties',
  'searchableProperties',
  'secondaryDisplayProperties',
] as const

export function mergeObject(input: MergeInput): Merged {
  const { live, local, only } = input
  const { object } = live
  const report = createReport()
  const issues: Issue[] = []
  const next: ObjectExport = local
    ? { ...local, groups: [], properties: [] }
    : { name: input.fresh.name, builder: input.fresh.builder, object, comments: [], groups: [], properties: [] }

  const objectAddress = `object:${object}`
  if (live.custom && next.builder === 'defineCustomObject' && only(objectAddress)) {
    if (refersToShadow(live.custom)) {
      report.note({ kind: 'shadowed', address: objectAddress })
    } else if (local) {
      const fields = mergeCustom(next, live.custom, objectAddress)
      const resolution = input.resolve?.(objectAddress)
      if (resolution) {
        resolveUnits(objectAddress, local as unknown as Fields, next as unknown as Fields, fields, resolution)
      }
      report.settle(fields)
    } else {
      mergeCustom(next, live.custom, objectAddress)
      report.added(objectAddress)
    }
  }
  mergeProperties(input, next, report, issues)
  mergeGroups(input, next, report)

  return { export: next, counts: report.counts, changes: report.changes, issues }
}

type Report = ReturnType<typeof createReport>

function createReport() {
  const counts: Counts = { added: 0, changed: 0, unchanged: 0, missing: 0 }
  const changes: Change[] = []
  const note = (change: Change) => {
    changes.push(scrub(change))
  }
  return {
    counts,
    changes,
    note,
    added(address: string) {
      counts.added += 1
      note({ kind: 'added', address })
    },
    missing(address: string) {
      counts.missing += 1
      note({ kind: 'missing', address })
    },
    // A resource with a field change is changed; one with only notes is unchanged.
    settle(fields: Change[]) {
      if (fields.some((c) => !NOTES.has(c.kind))) {
        counts.changed += 1
      } else {
        counts.unchanged += 1
      }
      for (const change of fields) {
        note(change)
      }
    },
  }
}

// A custom object's schema fields come from the portal. Each one that differs from the file is a field change.
function mergeCustom(next: ObjectExport, custom: LiveCustom, address: string): Change[] {
  const fields: Change[] = []
  for (const field of CUSTOM_FIELDS) {
    const before = list(next[field])
    const after = list(custom[field])
    if (!same(before, after)) {
      fields.push({ kind: 'changed', address, field, before, after })
    }
    Object.assign(next, { [field]: after })
  }
  return fields
}

// The file's properties in file order, each in the pull scope because the file defines it, then the portal's new ones
// in scope in name order. A file property whose portal group a name override shadows is kept as written, and a new one
// there is not written: no address in the file names that group. A portal property Kalup does not write is a p.string
// reference.
function mergeProperties(input: MergeInput, next: ObjectExport, report: Report, issues: Issue[]): void {
  const { live, local, only, excluded } = input
  const liveByName = new Map(live.properties.map((p) => [p.name, p]))
  const unsupported = new Map(live.unsupported.map((u) => [u.name, u]))
  const seen = new Set<string>()
  for (const p of local?.properties ?? []) {
    const address = `property:${live.object}/${p.name}`
    seen.add(p.name)
    const l = liveByName.get(p.name)
    const there = l ?? unsupported.get(p.name)
    const readOnly = readOnlyValue(live, p.name)
    if (!only(address)) {
      next.properties.push(p)
    } else if (excluded.has(address)) {
      next.properties.push(p)
      report.note({ kind: 'excluded', address })
    } else if (!there) {
      next.properties.push(p)
      report.missing(address)
    } else if (l && refersToShadow(l)) {
      next.properties.push(p)
      report.note({ kind: 'shadowed', address })
    } else if (l) {
      const fields: Change[] = []
      const target = input.targetOnly?.(address)
      const merged = mergeProperty(p, l, address, fields, issues, input.resolve?.(address), readOnly)
      const kept = keepIgnored(target?.ignored ?? [], p, merged, address, fields)
      next.properties.push(keepGroup(input, target?.group === true, p, kept, address, fields))
      report.settle(fields)
    } else {
      const fields: Change[] = []
      next.properties.push(withReadonly(unsupportedReference(p, address, fields), readOnly, address, fields))
      report.settle(fields)
    }
  }
  addProperties(input, seen, next, report, issues)
}

// Whether HubSpot marks the value of a portal property read-only.
function readOnlyValue(live: LiveObject, name: string): boolean {
  return live.meta.get(name)?.modificationMetadata?.readOnlyValue === true
}

// HubSpot marks the value read-only, so the app cannot write it: pull adds .readonly(), and never takes one away.
function withReadonly(p: Property, readOnly: boolean, address: string, fields: Change[]): Property {
  if (!readOnly || p.chain.readonly) {
    return p
  }
  fields.push({ kind: 'changed', address, field: 'readonly', before: false, after: true })
  return { ...p, chain: { ...p.chain, readonly: true } }
}

// A file property whose portal counterpart Kalup does not write. A reference, or a .managed(false) entry, stays as
// written: its builder is the app's choice. A managed one becomes a p.string reference, since plan cannot manage it.
function unsupportedReference(p: Property, address: string, fields: Change[]): Property {
  const d = p.definition
  if (!(p.chain.managed && d?.label !== undefined && d.group !== undefined && d.fieldType !== undefined)) {
    return p
  }
  fields.push({ kind: 'changed', address, field: 'definition', before: 'managed', after: 'reference' })
  if (p.kind !== 'string') {
    fields.push({ kind: 'changed', address, field: 'builder', before: `p.${p.kind}`, after: 'p.string' })
  }
  const { required, readonly } = p.chain
  return {
    key: p.key,
    kind: 'string',
    name: p.name,
    chain: { required, readonly, managed: true },
    comments: p.comments,
  }
}

// The portal's properties in scope that the file lacks, in name order.
function addProperties(
  input: MergeInput,
  seen: Set<string>,
  next: ObjectExport,
  report: Report,
  issues: Issue[],
): void {
  const { live, scope, only, removed } = input
  const portal: (LiveProperty | UnsupportedProperty)[] = [...live.properties, ...live.unsupported]
  for (const l of portal.sort((a, b) => cmp(a.name, b.name))) {
    const address = `property:${live.object}/${l.name}`
    if (seen.has(l.name) || !inScope(scope, l) || !only(address)) {
      continue
    }
    if (removed?.has(address)) {
      report.note({ kind: 'removed', address })
      continue
    }
    // A property Kalup does not write carries no group, so neither a shadowed nor a removed group keeps it out.
    if (!('kind' in l)) {
      next.properties.push(
        newProperty(unsupportedLive(l), readOnlyValue(live, l.name), next.properties, address, issues),
      )
      report.added(address)
      continue
    }
    if (refersToShadow(l)) {
      report.note({ kind: 'shadowed', address })
      continue
    }
    if (inRemovedGroup(input, l.definition?.group)) {
      report.note({ kind: 'removed-group', address })
      continue
    }
    next.properties.push(newProperty(l, readOnlyValue(live, l.name), next.properties, address, issues))
    report.added(address)
  }
}

// A property Kalup does not write, as the p.string reference pull writes for it.
function unsupportedLive(u: UnsupportedProperty): LiveProperty {
  return {
    name: u.name,
    kind: 'string',
    type: u.type,
    fieldType: u.fieldType,
    hubspotDefined: u.hubspotDefined,
    reference: true,
    calculated: false,
  }
}

// Whether a group name is in removed.ts on this object: pull never writes that group back.
function inRemovedGroup(input: MergeInput, group: string | undefined): boolean {
  return group !== undefined && input.removed?.has(`group:${input.live.object}/${group}`) === true
}

// A file property HubSpot moved into a group pull cannot write keeps its group as written (the override's, where the
// target's override states one), reported and counted as a difference: a group in removed.ts, or, against a
// group override, one the file lacks, which written would be a shared group every other target's plan creates.
function keepGroup(
  input: MergeInput,
  overridden: boolean,
  p: Property,
  merged: Property,
  address: string,
  fields: Change[],
): Property {
  const mine = p.definition?.group
  const theirs = merged.definition?.group
  let kind: Change['kind'] | undefined
  if (inRemovedGroup(input, theirs)) {
    kind = 'removed-group'
  } else if (overridden && theirs !== undefined && !input.local?.groups.some((g) => g.name === theirs)) {
    kind = 'override-group'
  }
  if (theirs === mine || kind === undefined) {
    return merged
  }
  const at = fields.findIndex((c) => c.kind === 'changed' && c.field === 'group')
  if (at >= 0) {
    fields.splice(at, 1)
  }
  fields.push({ kind, address, field: 'group', before: mine, after: theirs })
  return mine === undefined ? p : { ...merged, definition: { ...merged.definition, group: mine } }
}

// A field only the target's lifecycle leaves to its portal is not the shared file's to take: the file keeps its value,
// and its change lines give way to one `ignored` note, no difference. A merge the portal made a reference is left as it
// is, since a reference holds no such field.
function keepIgnored(
  ignored: readonly string[],
  p: Property,
  merged: Property,
  address: string,
  fields: Change[],
): Property {
  const d = merged.definition
  if (ignored.length === 0 || d?.label === undefined || d.group === undefined || d.fieldType === undefined) {
    return merged
  }
  const mine = (p.definition ?? {}) as Record<string, unknown>
  const definition = { ...d } as Record<string, unknown>
  const notes: Change[] = []
  for (const field of ignored) {
    if (!same(mine[field], definition[field])) {
      notes.push({ kind: 'ignored', address, field })
    }
    put(definition, field, mine[field])
  }
  // `options` covers `options[<value>]`, `options[<value>].label` and `options.order`.
  const of = (c: Change) =>
    ignored.some((f) => c.field === f || c.field?.startsWith(`${f}[`) || c.field?.startsWith(`${f}.`))
  fields.splice(0, fields.length, ...fields.filter((c) => !of(c)), ...notes)
  return { ...merged, definition: definition as Definition }
}

// A property in a group, or a schema naming a property, that a name override shadows. The read marks the name
// `shadowed:<name>`, which no file may hold, so pull keeps the file's side and reports it.
function refersToShadow(live: LiveProperty | LiveCustom): boolean {
  const names =
    'labels' in live
      ? [
          live.primaryDisplayProperty,
          ...(live.requiredProperties ?? []),
          ...(live.searchableProperties ?? []),
          ...(live.secondaryDisplayProperties ?? []),
        ]
      : [live.definition?.group]
  return names.some((name) => name?.startsWith(SHADOWED))
}

// Every group a managed property references is written, whatever --only says, so the file stays valid. A portal group
// in removed.ts is reported and never written back; no property pull writes names one.
function mergeGroups(input: MergeInput, next: ObjectExport, report: Report): void {
  const { live, local, only, excluded } = input
  const needed = new Set<string>()
  for (const p of next.properties) {
    if (p.definition?.group !== undefined) {
      needed.add(p.definition.group)
    }
  }
  for (const g of local?.groups ?? []) {
    const address = `group:${live.object}/${g.name}`
    needed.delete(g.name)
    const label = live.groups.get(g.name)
    if (!only(address)) {
      next.groups.push(g)
    } else if (excluded.has(address)) {
      next.groups.push(g)
      report.note({ kind: 'excluded', address })
    } else if (label === undefined) {
      next.groups.push(g)
      report.missing(address)
    } else {
      const merged: Fields = { label }
      const fields: Change[] =
        label === g.label ? [] : [{ kind: 'changed', address, field: 'label', before: g.label, after: label }]
      const resolution = input.resolve?.(address)
      if (resolution) {
        resolveUnits(address, { label: g.label }, merged, fields, resolution)
      }
      next.groups.push({ ...g, label: merged.label as string })
      report.settle(fields)
    }
  }
  for (const name of [...needed].sort(cmp)) {
    next.groups.push({ name, label: live.groups.get(name) ?? name, comments: [] })
    report.added(`group:${live.object}/${name}`)
  }
  noteRemovedGroups(input, report)
}

// Each portal group in removed.ts, reported as removed: pull never writes it back.
function noteRemovedGroups(input: MergeInput, report: Report): void {
  const { live, only, removed } = input
  for (const name of [...live.groups.keys()].sort(cmp)) {
    const address = `group:${live.object}/${name}`
    if (removed?.has(address) && only(address)) {
      report.note({ kind: 'removed', address })
    }
  }
}

// Key, kind, chain, json source and comments come from the file. Everything in the definition that HubSpot owns comes
// from the portal; `as` per option value and lifecycle stay, and a field the file states stays stated. A property
// whose kind conflicts with the portal is left as written, because the portal's fieldType and options would not
// validate against the file's builder.
function mergeProperty(
  p: Property,
  l: LiveProperty,
  address: string,
  fields: Change[],
  issues: Issue[],
  resolution: Resolution | undefined,
  readOnly: boolean,
): Property {
  const mismatch = codecMismatch(p, l, sanitize(address))
  if (mismatch) {
    issues.push(mismatch)
    return p
  }
  return withReadonly(mergeDefinition(p, l, address, fields, resolution), readOnly, address, fields)
}

function mergeDefinition(
  p: Property,
  l: LiveProperty,
  address: string,
  fields: Change[],
  resolution: Resolution | undefined,
): Property {
  const mine = p.definition ?? {}
  const managed = mine.label !== undefined && mine.group !== undefined && mine.fieldType !== undefined
  // Nothing owns a .managed(false) definition, and a reference cannot carry one, so it stays as written.
  if (l.reference && !p.chain.managed) {
    return p
  }
  if (l.reference) {
    if (managed) {
      fields.push({ kind: 'changed', address, field: 'definition', before: 'managed', after: 'reference' })
    }
    const options = mergeOptions(mine.options, referenceOptions(l.definition), address, fields)
    return {
      ...p,
      chain: { ...p.chain, managed: true },
      definition: options
        ? { options: options.map((o) => compact({ value: o.value, label: o.label, as: o.as })) }
        : undefined,
    }
  }
  if (!managed) {
    fields.push({ kind: 'changed', address, field: 'definition', before: 'reference', after: 'managed' })
  }
  const theirs = l.definition ?? {}
  for (const field of HUBSPOT_FIELDS) {
    const before = mine[field]
    const after = written(before, theirs[field], DEFAULTS.definition[field])
    if (before !== after) {
      fields.push({ kind: 'changed', address, field, before, after })
    }
  }
  const definition: Definition = compact({
    ...theirs,
    options: mergeOptions(mine.options, theirs.options, address, fields),
    lifecycle: mine.lifecycle,
  })
  const merged = stated(mine, definition, DEFAULTS.definition)
  if (resolution) {
    resolveUnits(address, mine as Fields, merged as Fields, fields, resolution)
  }
  return { ...p, definition: merged }
}

/** A definition, a group or a custom object's export as resolveUnits reads and changes it. */
type Fields = Record<string, unknown> & { options?: Option[] }

/** One resource resolveUnits works on: the file's side, the merged side and the report, the last two changed. */
interface Resolving {
  address: string
  fields: Change[]
  merged: Fields
  mine: Fields
  r: Resolution
}

// The base decides the units a merge keeps. A config change or a conflict keeps the file's value unless --accept takes
// the portal's. An option config dropped that the base and the portal hold stays dropped. An option config and the base
// hold that the portal no longer does stays in the file, reported, unless --accept drops it; so does one config added.
// Drift and diverged units keep the portal's value, as the merge left them. `merged` and `fields` change in place.
function resolveUnits(address: string, mine: Fields, merged: Fields, fields: Change[], r: Resolution): void {
  const at: Resolving = { address, fields, merged, mine, r }
  for (const u of r.units) {
    const member = MEMBER.exec(u.unit)
    if (u.unit === 'options.order') {
      resolveOrder(at, u)
    } else if (member) {
      resolveMember(at, u, member[1] as string, member[2] as keyof Option | undefined)
    } else if (u.unit !== 'type' && keepsFile(at, u)) {
      // `type` follows the builder, which no merge changes.
      noteUnit(at, u, mine[u.unit], merged[u.unit])
      drop(at, 'changed', u.unit)
      put(merged, u.unit, mine[u.unit])
    }
  }
  // An explicit `options: []` in the file is owned and stays; one the units emptied goes when the file leaves it out.
  if (merged.options?.length === 0 && mine.options === undefined) {
    merged.options = undefined
  }
  compactInPlace(merged)
}

// A unit config changed, alone or against HubSpot, that no --accept takes: the file's value stays.
function keepsFile(at: Resolving, u: UnitResult): boolean {
  return (u.class === 'config-change' || u.class === 'conflict') && !at.r.accept(u.unit)
}

function noteUnit(at: Resolving, u: UnitResult, before: unknown, after: unknown): void {
  at.fields.push({
    kind: u.class === 'conflict' ? 'conflict' : 'kept',
    address: at.address,
    field: u.unit,
    before,
    after,
  })
}

// Takes back the merge's own line about a unit the base decided.
function drop(at: Resolving, kind: Change['kind'], field: string): void {
  const index = at.fields.findIndex((c) => c.kind === kind && c.field === field)
  if (index >= 0) {
    at.fields.splice(index, 1)
  }
}

function resolveOrder(at: Resolving, u: UnitResult): void {
  const { merged, mine } = at
  if (merged.options && keepsFile(at, u)) {
    const ordered = inFileOrder(mine.options, merged.options)
    noteUnit(at, u, commonValues(ordered, mine.options), commonValues(merged.options, mine.options))
    merged.options = ordered
  }
}

// One option unit: a field of a member both hold, or the membership of one only one side holds.
function resolveMember(at: Resolving, u: UnitResult, value: string, field: keyof Option | undefined): void {
  const { merged, mine, r } = at
  const theirs = merged.options?.find((o) => o.value === value)
  const ours = mine.options?.find((o) => o.value === value)
  const without = () => {
    merged.options = merged.options?.filter((o) => o.value !== value)
  }
  if (field !== undefined) {
    if (theirs && ours && keepsFile(at, u)) {
      noteUnit(at, u, ours[field], theirs[field])
      drop(at, 'changed', u.unit)
      put(theirs as unknown as Record<string, unknown>, field, ours[field])
    }
  } else if ((u.class === 'keep' || u.class === 'remove') && Object.hasOwn(u, 'base')) {
    // Config dropped it; the base and the portal hold it.
    if (theirs && !r.accept(u.unit)) {
      at.fields.push({ kind: 'kept', address: at.address, field: u.unit, before: undefined, after: theirs.label })
      drop(at, 'added', u.unit)
      without()
    }
  } else if (u.class === 'drift' && u.observed === undefined) {
    // Config and the base hold it; HubSpot no longer does.
    drop(at, 'local-only', u.unit)
    if (r.accept(u.unit)) {
      at.fields.push({ kind: 'changed', address: at.address, field: u.unit, before: ours?.label, after: undefined })
      without()
    } else {
      at.fields.push({ kind: 'removed-in-hubspot', address: at.address, field: u.unit })
    }
  } else if (u.class === 'add') {
    // Config added it; neither the base nor HubSpot holds it. A config change, as plan writes it, unless --accept
    // takes the portal side and drops it from the file.
    drop(at, 'local-only', u.unit)
    if (r.accept(u.unit)) {
      at.fields.push({ kind: 'changed', address: at.address, field: u.unit, before: ours?.label, after: undefined })
      without()
    } else {
      at.fields.push({ kind: 'kept', address: at.address, field: u.unit, before: ours?.label, after: undefined })
    }
  }
}

// The merged options with the members the file holds in the file's order, each in a slot one of them held, so a
// member only the portal holds keeps its place.
function inFileOrder(mine: Option[] | undefined, merged: Option[]): Option[] {
  const inFile = new Set((mine ?? []).map((o) => o.value))
  const byValue = new Map(merged.filter((o) => inFile.has(o.value)).map((o) => [o.value, o]))
  const queue = (mine ?? []).flatMap((o) => {
    const found = byValue.get(o.value)
    return found ? [found] : []
  })
  return merged.map((o) => (inFile.has(o.value) ? (queue.shift() ?? o) : o))
}

// The values of `options` the file also holds, in the order of `options`.
function commonValues(options: Option[], mine: Option[] | undefined): string[] {
  const inFile = new Set((mine ?? []).map((o) => o.value))
  return options.filter((o) => inFile.has(o.value)).map((o) => o.value)
}

// Sets a field, or removes it when the file leaves it out.
function put(record: Record<string, unknown>, field: string, value: unknown): void {
  if (value === undefined) {
    delete record[field]
  } else {
    record[field] = value
  }
}

function compactInPlace(record: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(record)) {
    if (value === undefined) {
      delete record[field]
    }
  }
}

// The builder must take the portal's type and fieldType. A fieldType that belongs to another builder of the same type
// (checkbox is p.multiEnum's) would not validate with the file's builder, or would decode wrong. One no builder takes
// (a calculated property's calculation_equation) says nothing about the codec.
function codecMismatch(p: Property, l: LiveProperty, address: string): Issue | undefined {
  const keeps = `the file keeps p.${p.kind} and nothing is refreshed`
  // A custom HubSpot user property is managed through p.owner alone: another builder would not take its definition.
  if (l.kind === 'owner' && !l.reference && p.kind !== 'owner') {
    return {
      code: 'W_CODEC_MISMATCH',
      message: `${address} is p.${p.kind} in the file, but the portal holds a HubSpot user property, which p.owner manages; ${keeps}`,
      fix: 'change the builder to p.owner, or keep it if the app relies on it',
    }
  }
  // HubSpot fills an owner or externalOptions property's options: any builder over the stored text is the app's choice.
  // So is p.string over a phone number the file only refers to.
  if (l.external || (l.reference && l.kind === 'phoneNumber' && p.kind === 'string')) {
    return undefined
  }
  if (HUBSPOT_TYPES[p.kind] !== l.type) {
    return {
      code: 'W_CODEC_MISMATCH',
      message: `${address} is p.${p.kind} in the file but type ${sanitize(l.type)} in the portal; ${keeps}`,
      fix: 'change the builder to match the portal type, or keep it if the app relies on it',
    }
  }
  if (FIELD_TYPES[l.kind].includes(l.fieldType) && !FIELD_TYPES[p.kind].includes(l.fieldType)) {
    return {
      code: 'W_CODEC_MISMATCH',
      message: `${address} is p.${p.kind} in the file, but its fieldType in the portal is ${sanitize(l.fieldType)}, which p.${p.kind} does not take (p.${l.kind} does); ${keeps}`,
      fix: `change the builder to p.${l.kind}, or keep it if the app relies on it`,
    }
  }
  return undefined
}

// Options are keyed by value. A member in both takes the portal's label, hidden and description and keeps the local
// `as`; members follow portal order. A portal-only member is added. A local-only member is kept and noted.
function mergeOptions(
  local: Option[] | undefined,
  live: Option[] | undefined,
  address: string,
  fields: Change[],
): Option[] | undefined {
  const mine = new Map((local ?? []).map((o) => [o.value, o]))
  const out: Option[] = []
  for (const o of live ?? []) {
    const m = mine.get(o.value)
    const at = `options[${o.value}]`
    if (m) {
      for (const field of OPTION_FIELDS) {
        const before = m[field]
        const after = written(before, o[field], OPTION_DEFAULTS[field])
        if (before !== after) {
          fields.push({ kind: 'changed', address, field: `${at}.${field}`, before, after })
        }
      }
    } else {
      fields.push({ kind: 'added', address, field: at })
    }
    const merged = compact({ value: o.value, label: o.label, as: m?.as, hidden: o.hidden, description: o.description })
    out.push(m ? stated(m, merged, OPTION_DEFAULTS) : merged)
  }
  for (const m of local ?? []) {
    if (live?.some((o) => o.value === m.value)) {
      continue
    }
    out.push(m)
    fields.push({ kind: 'local-only', address, field: `options[${m.value}]` })
  }
  return out.length ? out : undefined
}

// The default key is camelCase of the internal name. When that key is taken, the internal name is the key. A calculated
// property, or one whose value HubSpot marks read-only, is .readonly().
function newProperty(
  l: LiveProperty,
  readOnly: boolean,
  existing: Property[],
  address: string,
  issues: Issue[],
): Property {
  const wanted = camelCase(l.name)
  const taken = existing.some((p) => p.key === wanted)
  if (taken) {
    issues.push({
      code: 'W_KEY_COLLISION',
      message: `${sanitize(address)}: the key ${sanitize(wanted)} is taken, so its internal name is the key`,
      fix: 'rename one of the two keys',
    })
  }
  const options = l.reference ? referenceOptions(l.definition) : undefined
  return {
    key: taken ? l.name : wanted,
    kind: l.kind,
    name: l.name,
    definition: l.reference ? options && { options } : l.definition,
    chain: { required: false, readonly: l.calculated || readOnly, managed: true },
    comments: [],
  }
}

// A reference's file definition holds each option's value and label alone, whatever the portal adds.
function referenceOptions(definition: Definition | undefined): Option[] | undefined {
  return definition?.options?.map((o) => ({ value: o.value, label: o.label }))
}

// A field the file states stays in the merged value: the portal's value, or the default where the portal leaves the
// field out. So a re-pull keeps the file's ownership and its text; a field the file leaves out stays out.
function stated<T extends object>(mine: T, merged: T, defaults: Record<string, unknown>): T {
  const had = mine as Record<string, unknown>
  const out = { ...merged } as Record<string, unknown>
  for (const [field, value] of Object.entries(defaults)) {
    if (had[field] !== undefined && out[field] === undefined) {
      out[field] = Array.isArray(value) ? [] : value
    }
  }
  return out as T
}

// The value pull writes, and reports, for a field the file has as `mine` and the portal as `live`: the portal's, or
// HubSpot's default when the portal leaves the field out and the file states it, since a stated field stays stated.
function written(mine: unknown, live: unknown, dflt: unknown): unknown {
  return live ?? (mine === undefined ? undefined : dflt)
}

function list<T>(value: T | undefined): T | undefined {
  return Array.isArray(value) && value.length === 0 ? undefined : value
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function cmp(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

// Portal strings are untrusted, so every string in a change line is sanitized before it reaches any output.
function scrub(change: Change): Change {
  return compact({
    ...change,
    address: sanitize(change.address),
    field: change.field === undefined ? undefined : sanitize(change.field),
    before: clean(change.before),
    after: clean(change.after),
  })
}

function clean(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitize(value)
  }
  if (Array.isArray(value)) {
    return value.map(clean)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [sanitize(k), clean(v)]))
  }
  return value
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
