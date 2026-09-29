// The blueprint upgrade merge, ADR 0011: per resource, the stored original as base, config as local and the new version
// as remote, unit by unit. Units are each definition field, each option's membership and fields, the options order,
// each lifecycle field and each binding field (an alias per option value). Local equal to base takes remote; remote
// equal to base keeps local; both changed alike converge; both changed differently is a conflict that keeps local
// unless --take remote selects it. An option upstream removed stays in config with its alias, noted. Pure.
import {
  type BlueprintResource,
  type BuilderKind,
  HUBSPOT_TYPES,
  type IROption,
  type IRResource,
  type Lifecycle,
  stableStringify,
} from '@kalup/core'

/** One resource as units. */
export interface Units {
  options?: IROption[]
  /** Every unit but the options' own, `label` to `binding.aliases[<value>]`. Absent means the resource has none. */
  scalars: Map<string, unknown>
  type: string
}

/** A unit both sides changed differently. `local` or `remote` is absent when that side has none. */
export interface Conflict {
  local?: unknown
  remote?: unknown
  unit: string
}

export interface Merged {
  conflicts: Conflict[]
  converged: string[]
  /** Units the client changed and upstream did not: config's value stays. */
  kept: string[]
  notes: string[]
  /** The resource as config should hold it: `local` itself when nothing took an upstream value. */
  resource: IRResource
  /** Units that took the upstream value, --take remote included. */
  updated: string[]
}

export interface MergeInput {
  /** The stored original's resource, or none: a resource new upstream is merged two-way, every difference a conflict. */
  base?: Units
  /** Units the lock holds on this resource: conflicts while upstream still does not change them. */
  held: ReadonlySet<string>
  local: IRResource
  remote: Units
  take: (unit: string) => boolean
}

const DEFINITION = ['label', 'group', 'fieldType', 'description', 'hasUniqueValue', 'formField'] as const
const OPTION_FIELDS = ['label', 'hidden', 'description'] as const
const ALIAS = 'binding.aliases['

type Resource = Pick<IRResource, 'type' | 'definition' | 'lifecycle'> & { binding?: BlueprintResource['binding'] }

/**
 * A resource as units. Defaults are filled so both sides compare alike: the lifecycle's `options` is 'additive',
 * `required`, `readonly` and `preventDestroy` are false when unstated.
 */
export function unitsOf(resource: Resource): Units {
  const d = resource.definition ?? {}
  const scalars = new Map<string, unknown>()
  if (resource.type !== 'property') {
    scalars.set('label', d.label)
    return { type: resource.type, scalars }
  }
  for (const field of DEFINITION) {
    scalars.set(field, field === 'group' ? (d.group as { $ref?: string } | undefined)?.$ref : d[field])
  }
  const l = resource.lifecycle
  scalars.set('lifecycle.options', l?.options ?? 'additive')
  scalars.set('lifecycle.removedOptions', l?.removedOptions)
  scalars.set('lifecycle.ignoreChanges', l?.ignoreChanges)
  scalars.set('lifecycle.preventDestroy', l?.preventDestroy === true)
  const b = resource.binding ?? {}
  scalars.set('binding.key', b.key)
  scalars.set('binding.codec', b.codec)
  scalars.set('binding.required', b.required === true)
  scalars.set('binding.readonly', b.readonly === true)
  for (const [value, alias] of Object.entries(b.aliases ?? {})) {
    scalars.set(`${ALIAS}${value}]`, alias)
  }
  const options = d.options as IROption[] | undefined
  return { type: resource.type, scalars, ...(options === undefined ? {} : { options }) }
}

/** A blueprint resource as the IR holds a managed one, the default lifecycle filled in for a property. */
export function toIR(resource: BlueprintResource): IRResource {
  const lifecycle: Lifecycle | undefined =
    resource.type === 'property' ? (resource.lifecycle ?? { options: 'additive' }) : undefined
  return {
    type: resource.type,
    managed: true,
    definition: resource.definition,
    ...(resource.binding === undefined ? {} : { binding: resource.binding }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
  }
}

type Decide = (unit: string, l: unknown, b: unknown, r: unknown, based: boolean) => unknown

/** Merges one resource. With no base, every unit the two sides hold differently is a conflict. */
export function mergeResource(input: MergeInput): Merged {
  const local = unitsOf(input.local)
  const out: Merged = { conflicts: [], converged: [], kept: [], notes: [], updated: [], resource: input.local }
  const decide = decider(input, out)
  const based = input.base !== undefined
  // With no base every unit reads undefined there.
  const base = input.base === undefined ? new Map<string, unknown>() : input.base.scalars
  const units = keys(local.scalars, base, input.remote.scalars)
  const decideUnit = (unit: string) =>
    decide(unit, local.scalars.get(unit), base.get(unit), input.remote.scalars.get(unit), based)
  const scalars = new Map<string, unknown>()
  for (const unit of units.filter((u) => !u.startsWith(ALIAS))) {
    scalars.set(unit, decideUnit(unit))
  }
  if (local.type !== 'property') {
    if (out.updated.length > 0) {
      out.resource = { ...input.local, definition: { label: scalars.get('label') } }
    }
    return out
  }
  const { options, removedUpstream } = mergeOptions(input, local, decide, out)
  // An alias belongs to an option config keeps; the rest have nothing to name. An option upstream removed keeps config's
  // alias as it keeps the option: dropping it would change the value the app's type names.
  const kept = new Set(options?.map((o) => o.value))
  const aliases: [string, string][] = []
  for (const unit of units.filter((u) => u.startsWith(ALIAS) && kept.has(u.slice(ALIAS.length, -1)))) {
    const option = unit.slice(ALIAS.length, -1)
    const value = removedUpstream.has(option) ? local.scalars.get(unit) : decideUnit(unit)
    if (typeof value === 'string') {
      aliases.push([option, value])
    }
  }
  if (out.updated.length > 0) {
    out.resource = build(input.local, scalars, options, aliases)
  }
  return out
}

function decider(input: MergeInput, out: Merged): Decide {
  // Both sides changed the unit differently: upstream's value when --take selects it, else config's, reported.
  const conflict = (unit: string, l: unknown, r: unknown) => {
    if (input.take(unit)) {
      out.updated.push(unit)
      return r
    }
    out.conflicts.push({ unit, ...(l === undefined ? {} : { local: l }), ...(r === undefined ? {} : { remote: r }) })
    return l
  }
  return (unit, l, b, r, based) => {
    if (!based) {
      return same(l, r) ? l : conflict(unit, l, r)
    }
    if (same(l, b)) {
      if (!same(r, b)) {
        out.updated.push(unit)
      }
      return r
    }
    if (same(r, b) && !input.held.has(unit)) {
      out.kept.push(unit)
      return l
    }
    if (same(l, r)) {
      out.converged.push(unit)
      return l
    }
    return conflict(unit, l, r)
  }
}

// Membership by value, then each member's fields, then the order. An option upstream removed that config still has
// stays, with a note, and is listed in `removedUpstream`; one the client removed stays removed; one upstream added is
// added.
function mergeOptions(
  input: MergeInput,
  local: Units,
  decide: Decide,
  out: Merged,
): { options: IROption[] | undefined; removedUpstream: Set<string> } {
  const based = input.base !== undefined
  const lists = { l: local.options, b: input.base?.options, r: input.remote.options }
  const [L, B, R] = [byValue(lists.l), byValue(lists.b), byValue(lists.r)]
  const members = new Map<string, IROption>()
  const removedUpstream = new Set<string>()
  for (const value of new Set([...L.keys(), ...B.keys(), ...R.keys()])) {
    // Removed on both sides: nothing to decide.
    if (!(L.has(value) || R.has(value))) {
      continue
    }
    const [l, b, r] = [L.get(value), B.get(value), R.get(value)]
    let present: boolean
    if (based && l && b && !r) {
      out.notes.push(`upstream removed option ${value}; remove it from config yourself if you want`)
      removedUpstream.add(value)
      present = true
    } else {
      present = decide(`options[${value}]`, l !== undefined, b !== undefined, r !== undefined, based) === true
    }
    if (present) {
      members.set(value, member(value, { l, b, r }, decide, based))
    }
  }
  const order = mergeOrder(lists, { L, B, R }, members, decide, based)
  const options = order.map((value) => members.get(value) as IROption)
  if (options.length > 0) {
    return { options, removedUpstream }
  }
  return { options: lists.l === undefined ? undefined : [], removedUpstream }
}

// A member both sides hold merges field by field, on the base's member when it has one.
function member(
  value: string,
  sides: { l?: IROption; b?: IROption; r?: IROption },
  decide: Decide,
  based: boolean,
): IROption {
  const { l, b, r } = sides
  if (!(l && r)) {
    return (l ?? r) as IROption
  }
  const merged: Record<string, unknown> = { ...l }
  const fieldBased = based && b !== undefined
  for (const field of OPTION_FIELDS) {
    const mine = optionField(l, field)
    const unit = `options[${value}].${field}`
    const chosen = decide(unit, mine, b && optionField(b, field), optionField(r, field), fieldBased)
    if (!same(chosen, mine)) {
      put(merged, field, chosen)
    }
  }
  return merged as unknown as IROption
}

// The order of the members all three sides hold decides which side's order the result follows; each other member
// goes after its nearest predecessor in the list it came from.
function mergeOrder(
  lists: { l?: IROption[]; b?: IROption[]; r?: IROption[] },
  maps: { L: Map<string, IROption>; B: Map<string, IROption>; R: Map<string, IROption> },
  members: Map<string, IROption>,
  decide: Decide,
  based: boolean,
): string[] {
  const { L, B, R } = maps
  const everywhere = (value: string) => L.has(value) && R.has(value) && (!based || B.has(value))
  const common = (list?: IROption[]) => (list ?? []).map((o) => o.value).filter(everywhere)
  const mine = common(lists.l)
  const chosen = decide('options.order', mine, based ? common(lists.b) : undefined, common(lists.r), based)
  const skeleton = same(chosen, mine) ? lists.l : lists.r
  const order = (skeleton ?? []).map((o) => o.value).filter((value) => members.has(value))
  for (const value of members.keys()) {
    if (!order.includes(value)) {
      insert(
        order,
        value,
        ((R.has(value) ? lists.r : lists.l) ?? []).map((o) => o.value),
      )
    }
  }
  return order
}

function insert(order: string[], value: string, origin: string[]): void {
  for (let i = origin.indexOf(value) - 1; i >= 0; i -= 1) {
    const at = order.indexOf(origin[i] as string)
    if (at >= 0) {
      order.splice(at + 1, 0, value)
      return
    }
  }
  if (origin.indexOf(value) === -1) {
    order.push(value)
  } else {
    order.unshift(value)
  }
}

// The merged property in IR form. Only called when a unit took an upstream value.
function build(
  local: IRResource,
  scalars: Map<string, unknown>,
  options: IROption[] | undefined,
  aliases: [string, string][],
): IRResource {
  const s = (unit: string) => scalars.get(unit)
  const codec = s('binding.codec') as BuilderKind | undefined
  const group = s('group') as string | undefined
  const fieldType = s('fieldType')
  const definition = compact({
    label: s('label'),
    group: group === undefined ? undefined : { $ref: group },
    type: fieldType === undefined || codec === undefined ? undefined : HUBSPOT_TYPES[codec],
    fieldType,
    description: s('description'),
    options,
    hasUniqueValue: s('hasUniqueValue'),
    formField: s('formField'),
  })
  const binding = compact({
    key: s('binding.key') as string | undefined,
    codec,
    aliases: aliases.length > 0 ? Object.fromEntries(aliases) : undefined,
    required: s('binding.required') === true || undefined,
    readonly: s('binding.readonly') === true || undefined,
  })
  const lifecycle = compact({
    options: (s('lifecycle.options') ?? 'additive') as Lifecycle['options'],
    removedOptions: s('lifecycle.removedOptions') as string[] | undefined,
    ignoreChanges: s('lifecycle.ignoreChanges') as string[] | undefined,
    preventDestroy: s('lifecycle.preventDestroy') === true || undefined,
  })
  return { type: local.type, managed: local.managed, definition, binding, lifecycle }
}

// An option field as it compares: a false `hidden` and an empty description are the defaults, as if unstated.
function optionField(option: IROption, field: (typeof OPTION_FIELDS)[number]): unknown {
  if (field === 'hidden') {
    return option.hidden === true ? true : undefined
  }
  if (field === 'description') {
    return option.description ? option.description : undefined
  }
  return option.label
}

function byValue(options: IROption[] | undefined): Map<string, IROption> {
  return new Map((options ?? []).map((o) => [o.value, o]))
}

function keys(...maps: Map<string, unknown>[]): string[] {
  return [...new Set(maps.flatMap((map) => [...map.keys()]))]
}

function same(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function put(record: Record<string, unknown>, field: string, value: unknown): void {
  if (value === undefined) {
    delete record[field]
  } else {
    record[field] = value
  }
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
