// Pull and a target's definition overrides. Pulling target T merges the portal into each export as T sees
// it: a property or group T overrides carries the override's fields in place of the file's. The merged export is then
// split: the value of each field T overrides goes into T's override, the file keeps its own, and every other field
// follows the normal pull rules, but for what T alone leaves to its portal (targetOnly). Another target's overrides are
// never read or written. Pure.
import type { Definition, Override } from '@kalup/core'
import type { ObjectExport } from '../../grammar/types.js'
import { DEFAULTS } from '../../ir/defaults.js'
import { stableStringify } from '../../ir/serialize.js'
import { OVERRIDABLE } from '../../loader/effective.js'
import type { TargetOnly } from './merge.js'

export interface Split {
  export: ObjectExport
  /** T's overrides whose definition the merge changed, by address, each whole. */
  overrides: Record<string, Override>
}

/** The export as target T sees it: each field a definition override of T's states, in place of the file's. */
export function asTarget(e: ObjectExport, overrides: Record<string, Override>): ObjectExport {
  return {
    ...e,
    groups: e.groups.map((g) => {
      const d = definitionOf(overrides, `group:${e.object}/${g.name}`)
      return d?.label === undefined ? g : { ...g, label: d.label }
    }),
    properties: e.properties.map((p) => {
      const d = definitionOf(overrides, `property:${e.object}/${p.name}`)
      if (!(d && p.definition && p.chain.managed)) {
        return p
      }
      return { ...p, definition: { ...p.definition, ...pick(d, OVERRIDABLE.property) } }
    }),
  }
}

/**
 * Splits an export merged from asTarget's view against `file`, the export as written: each field T overrides takes the
 * merged value into T's override and the file's own value back, a field the file leaves out left out again. An
 * override keeps each field it states, an explicit empty value included.
 */
export function fromTarget(
  merged: ObjectExport,
  file: ObjectExport | undefined,
  overrides: Record<string, Override>,
): Split {
  const changed: Record<string, Override> = {}
  // The merged value of each field the override states goes into it. Returns those fields.
  const take = (address: string, fields: readonly (keyof Definition)[], from: Definition) => {
    const override = own(overrides, address) as Override & { definition: Definition }
    const taken = fields.filter((f) => override.definition[f] !== undefined)
    const definition = { ...override.definition }
    for (const field of taken) {
      Object.assign(definition, { [field]: from[field] ?? stated(field) })
    }
    if (stableStringify(definition) !== stableStringify(override.definition)) {
      changed[address] = { ...override, definition }
    }
    return taken
  }
  const groups = merged.groups.map((g) => {
    const mine = file?.groups.find((f) => f.name === g.name)
    const address = `group:${merged.object}/${g.name}`
    if (!mine || definitionOf(overrides, address)?.label === undefined) {
      return g
    }
    take(address, OVERRIDABLE.group, { label: g.label })
    return { ...g, label: mine.label }
  })
  const properties = merged.properties.map((p) => {
    const address = `property:${merged.object}/${p.name}`
    const d = p.definition
    // A property the merge made a reference keeps the override as it is; validate then refuses the candidate.
    const full = d?.label !== undefined && d.group !== undefined && d.fieldType !== undefined
    if (!(d && full && p.chain.managed && definitionOf(overrides, address))) {
      return p
    }
    const mine = file?.properties.find((f) => f.name === p.name)?.definition ?? {}
    const into: Definition = { ...d }
    for (const field of take(address, OVERRIDABLE.property, d)) {
      put(into, field, mine[field])
    }
    return { ...p, definition: into }
  })
  return { export: { ...merged, groups, properties }, overrides: changed }
}

/**
 * What T's override keeps out of the shared file on a property of `file`, the export as written: whether it states the
 * group, and each field its lifecycle ignores that the shared lifecycle does not and it does not state. Pulling T keeps
 * the file's value of those: the other targets own them.
 */
export function targetOnly(
  file: ObjectExport,
  overrides: Record<string, Override>,
): (address: string) => TargetOnly | undefined {
  return (address) => {
    const d = definitionOf(overrides, address)
    if (!d) {
      return undefined
    }
    const shared = file.properties.find((p) => `property:${file.object}/${p.name}` === address)?.definition
    const ignores = new Set(shared?.lifecycle?.ignoreChanges)
    const ignored = (d.lifecycle?.ignoreChanges ?? []).filter(
      (field) => !ignores.has(field) && own(d as Record<string, unknown>, field) === undefined,
    )
    return { group: d.group !== undefined, ignored }
  }
}

// T's definition override of an address, unless a skip wins over it.
function definitionOf(overrides: Record<string, Override>, address: string): Definition | undefined {
  const override = own(overrides, address)
  return override?.skip === true ? undefined : override?.definition
}

// A stated field the merge left out holds its default, as pull keeps a stated field in a file.
function stated(field: keyof Definition): unknown {
  const value = DEFAULTS.definition[field]
  return Array.isArray(value) ? [] : value
}

function put(record: Definition, field: keyof Definition, value: unknown): void {
  if (value === undefined) {
    delete record[field]
  } else {
    Object.assign(record, { [field]: value })
  }
}

function pick(d: Definition, fields: readonly (keyof Definition)[]): Definition {
  return Object.fromEntries(fields.filter((f) => d[f] !== undefined).map((f) => [f, d[f]]))
}

// An own key only: an address or field such as 'constructor' must not find Object.prototype.
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
