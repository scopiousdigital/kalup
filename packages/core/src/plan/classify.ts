// Unit classification, docs/architecture.md section 6 and ADR 0021. Pure. A unit that differs is config-change, drift
// or conflict against the base, and diverged when the base has no value for it. An option only one side holds is add,
// remove or keep, or drift when config and the base hold it and the portal no longer does.
import { DEFAULTS } from '../ir/defaults.js'
import { stableStringify } from '../ir/serialize.js'
import type { Base } from '../ir/state.js'
import type { IROption } from '../ir/types.js'
import { byCodeUnit } from '../loader/load.js'

/**
 * One side of a comparison: the definition fields it owns, options apart, and its options in display order when it
 * owns them. An observation fills a captured field it lacks with its default, or null; config leaves out what it
 * does not state, so a field missing on the observed side is not compared.
 */
export interface Spec {
  fields: Record<string, unknown>
  options?: IROption[]
}

/** The desired side's lifecycle. Pass ignoreChanges only for a resource that exists. */
export interface Rules {
  ignoreChanges?: string[]
  options: 'additive' | 'exact'
  removedOptions?: string[]
}

export type UnitClass = 'converged' | 'config-change' | 'drift' | 'conflict' | 'diverged' | 'add' | 'remove' | 'keep'

export interface UnitResult {
  /** The base value, when the base has one for the unit. An option member's is its base member. */
  base?: unknown
  class: UnitClass
  desired?: unknown
  observed?: unknown
  unit: string
}

/** One option of a base: the fields config and portal agreed on. No field: only its membership is agreed. */
interface BaseOption {
  description?: string
  hidden?: boolean
  label?: string
}

/** The value a base holds for a unit, or undefined when it holds none. */
type BaseValue = { value: unknown } | undefined

// The order of these lists means nothing, so they compare as sets. secondaryDisplayProperties keeps its order.
const SETS = new Set(['requiredProperties', 'searchableProperties'])

/** Every unit desired owns that observed holds, sorted by unit. */
export function classify(base: Base | undefined, desired: Spec, observed: Spec, rules: Rules): UnitResult[] {
  const ignored = new Set(rules.ignoreChanges)
  const units: UnitResult[] = []
  for (const [field, value] of Object.entries(desired.fields)) {
    if (!ignored.has(field) && Object.hasOwn(observed.fields, field)) {
      units.push(compare(field, value, observed.fields[field], valueIn(base, field), SETS.has(field)))
    }
  }
  if (desired.options && observed.options && !ignored.has('options')) {
    units.push(...options(desired.options, observed.options, base, rules))
  }
  return units.sort((a, b) => byCodeUnit(a.unit, b.unit))
}

/** A stored base as a Spec: its scalar units as fields, its members in the agreed order, then by value. */
export function specOfBase(base: Base): Spec {
  const { options: members, optionsOrder, ...fields } = base
  if (members === undefined) {
    return { fields }
  }
  const order = (optionsOrder as string[] | undefined) ?? []
  const rank = (value: string) => (order.includes(value) ? order.indexOf(value) : order.length)
  const entries = Object.entries(members as Record<string, BaseOption>).sort(
    ([a], [b]) => rank(a) - rank(b) || byCodeUnit(a, b),
  )
  // A member whose label is not agreed has none.
  return { fields, options: entries.map(([value, member]) => ({ value, ...member }) as IROption) }
}

/**
 * The base after an apply: every owned unit of `approved`, only those `units` names when given, whose live value
 * equals the approved value takes that value; every other unit keeps its previous base value or stays absent, so a
 * held unit never moves. `options[<value>]` names the member and its fields, and a member neither side holds leaves
 * the base. Keys in code-unit order. Undefined when nothing is agreed and there was no previous base.
 */
export function advanceBase(
  previous: Base | undefined,
  approved: Spec,
  live: Spec,
  units?: string[],
): Base | undefined {
  const named: Named = (unit) =>
    units === undefined || units.some((u) => unit === u || unit.startsWith(`${u}.`) || unit.startsWith(`${u}[`))
  const next = new Map(Object.entries(previous ?? {}))
  let agreed = false
  for (const [field, value] of Object.entries(approved.fields)) {
    if (named(field) && Object.hasOwn(live.fields, field) && same(value, live.fields[field], SETS.has(field))) {
      next.set(field, value)
      agreed = true
    }
  }
  if (approved.options && live.options) {
    agreed = advanceOptions(next, approved.options, live.options, named) || agreed
  }
  return agreed || previous !== undefined ? sortedRecord(next) : undefined
}

/** Whether advanceBase considers a unit. */
type Named = (unit: string) => boolean

// The option units of advanceBase, applied to `next`. Whether any was agreed.
function advanceOptions(next: Map<string, unknown>, approved: IROption[], live: IROption[], named: Named): boolean {
  const wanted = new Map(approved.map((o) => [o.value, o]))
  const held = new Map(live.map((o) => [o.value, o]))
  const members = new Map(Object.entries((next.get('options') ?? {}) as Record<string, BaseOption>))
  let agreed = false
  for (const value of new Set([...wanted.keys(), ...members.keys()])) {
    const unit = `options[${value}]`
    const option = wanted.get(value)
    const match = held.get(value)
    if (option && match) {
      const member = agreedMember(unit, option, match, members.get(value), named)
      if (member) {
        members.set(value, member)
        agreed = true
      }
    } else if (!(option || match) && named(unit)) {
      members.delete(value)
    }
  }
  if (members.size > 0) {
    next.set('options', sortedRecord(members))
  } else {
    next.delete('options')
  }
  // An order of no common member agrees on nothing.
  const order = common(approved, held)
  if (order.length > 0 && named('options.order') && same(order, common(live, wanted))) {
    next.set('optionsOrder', order)
    agreed = true
  }
  return agreed
}

// A member both sides hold: its agreed fields over its previous ones. Undefined when no unit of it is named.
function agreedMember(
  unit: string,
  option: IROption,
  match: IROption,
  previous: BaseOption | undefined,
  named: Named,
): BaseOption | undefined {
  const member = new Map(Object.entries(previous ?? {}))
  let recorded = named(unit)
  for (const [name, mine, theirs] of memberFields(option, match)) {
    if (named(`${unit}.${name}`) && same(mine, theirs)) {
      member.set(name, mine)
      recorded = true
    }
  }
  return recorded ? (sortedRecord(member) as BaseOption) : undefined
}

function options(desired: IROption[], observed: IROption[], base: Base | undefined, rules: Rules): UnitResult[] {
  const wanted = new Map(desired.map((o) => [o.value, o]))
  const live = new Map(observed.map((o) => [o.value, o]))
  const members = new Map(Object.entries((base?.options ?? {}) as Record<string, BaseOption>))
  const removed = new Set(rules.removedOptions)
  const units: UnitResult[] = []
  for (const option of desired) {
    const unit = `options[${option.value}]`
    const match = live.get(option.value)
    const member = members.get(option.value)
    if (match) {
      units.push(...memberUnits(unit, option, match, member))
    } else if (member) {
      // Config and the base hold it, the portal no longer does: removed in HubSpot.
      units.push({ unit, class: 'drift', desired: option, base: member })
    } else {
      units.push({ unit, class: 'add', desired: option })
    }
  }
  for (const option of observed) {
    if (!wanted.has(option.value)) {
      const remove = rules.options === 'exact' || removed.has(option.value)
      const member = members.get(option.value)
      units.push({
        unit: `options[${option.value}]`,
        class: remove ? 'remove' : 'keep',
        observed: option,
        ...(member ? { base: member } : {}),
      })
    }
  }
  const order = common(desired, live)
  units.push(compare('options.order', order, common(observed, wanted), orderIn(base, order)))
  return units
}

// The base's order of today's common members. None when the base did not order every one of them, since a member
// that became common later has no agreed position; members that are no longer common drop out.
function orderIn(base: Base | undefined, members: string[]): BaseValue {
  const stored = valueIn(base, 'optionsOrder')
  if (!stored) {
    return undefined
  }
  const current = new Set(members)
  const order = (stored.value as string[]).filter((value) => current.has(value))
  return order.length === members.length ? { value: order } : undefined
}

function memberUnits(at: string, desired: IROption, observed: IROption, member?: BaseOption): UnitResult[] {
  return memberFields(desired, observed).map(([name, mine, theirs]) =>
    compare(`${at}.${name}`, mine, theirs, valueIn(member, name)),
  )
}

// The units of an option both sides hold: label and hidden always, hidden defaulting to false, and description when
// the desired option states it, the observed side defaulting to empty.
function memberFields(desired: IROption, observed: IROption): [keyof BaseOption, unknown, unknown][] {
  const fields: [keyof BaseOption, unknown, unknown][] = [
    ['label', desired.label, observed.label],
    ['hidden', desired.hidden ?? DEFAULTS.option.hidden, observed.hidden ?? DEFAULTS.option.hidden],
  ]
  if (desired.description !== undefined) {
    fields.push(['description', desired.description, observed.description ?? ''])
  }
  return fields
}

// The values one side lists that the other holds too, in the first side's order.
function common(list: IROption[], other: Map<string, IROption>): string[] {
  return list.filter((o) => other.has(o.value)).map((o) => o.value)
}

function compare(unit: string, desired: unknown, observed: unknown, base: BaseValue, set = false): UnitResult {
  return {
    unit,
    class: classOf(desired, observed, base, set),
    desired,
    observed,
    ...(base ? { base: base.value } : {}),
  }
}

// Desired and observed differ from each other when this looks at the base, so at least one differs from it.
function classOf(desired: unknown, observed: unknown, base: BaseValue, set: boolean): UnitClass {
  if (same(desired, observed, set)) {
    return 'converged'
  }
  if (!base) {
    return 'diverged'
  }
  if (same(observed, base.value, set)) {
    return 'config-change'
  }
  return same(desired, base.value, set) ? 'drift' : 'conflict'
}

function valueIn(record: object | undefined, key: string): BaseValue {
  return record && Object.hasOwn(record, key) ? { value: (record as Record<string, unknown>)[key] } : undefined
}

function same(a: unknown, b: unknown, set = false): boolean {
  return set ? equal(asSet(a), asSet(b)) : equal(a, b)
}

function asSet(value: unknown): unknown {
  return Array.isArray(value) ? [...new Set(value as string[])].sort(byCodeUnit) : value
}

function equal(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

// fromEntries defines own keys, so an option value such as '__proto__' stays a key.
function sortedRecord(entries: Map<string, unknown>): Record<string, unknown> {
  return Object.fromEntries([...entries].sort(([a], [b]) => byCodeUnit(a, b)))
}
