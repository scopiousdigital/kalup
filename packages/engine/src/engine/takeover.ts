// What takeover would archive on one target: the custom properties and groups a read found in an object's pull scope
// (custom, or named by include, minus exclude) that config lacks and no tombstone names. Never a HubSpot-defined or
// calculated property, a kind Kalup does not write (unsupported, owner and externalOptions properties are coverage,
// not resources), anything an object file lists (references and .managed(false) included), a name a skip or name
// override covers, a property in a group a skip override covers, or a property a custom object schema names. A group
// only when every property HubSpot holds in it is archived with it: HubSpot marks no group as its own, so an empty
// group is never taken for a custom one. Apply checks the same rules against its own read. Pure.
import type { Override } from '@kalup/core'
import { parseAddress } from '../ir/address.js'
import type { Address, IRResource, Ref } from '../ir/types.js'
import { excluder, scopeOf } from '../lib/pull/scope.js'
import { byCodeUnit, type Loaded } from '../loader/load.js'
import type { Observation } from './observe.js'
import { modeOf } from './settings.js'
import { coverOf, nameOf, objectOf } from './units.js'

export interface Candidates {
  groups: Address[]
  properties: Address[]
}

// The fields of a custom object schema that name properties.
const SCHEMA_FIELDS = [
  'primaryDisplayProperty',
  'secondaryDisplayProperties',
  'requiredProperties',
  'searchableProperties',
]

/** What takeover would archive on `target`, from its observation. Sorted. */
export function takeoverCandidates(
  loaded: Pick<Loaded, 'config' | 'ir'>,
  observation: Observation,
  target: string,
): Candidates {
  const { coverage, members = {}, meta = {}, resources } = observation
  const out: Candidates = { groups: [], properties: [] }
  if (!coverage) {
    return out
  }
  const overrides = own(loaded.config.targets, target)?.overrides ?? {}
  for (const [address, resource] of Object.entries(resources).sort(([a], [b]) => byCodeUnit(a, b))) {
    const { type, path } = parseAddress(address)
    const object = path.slice(0, path.indexOf('/'))
    const covered = own(coverage.objects, object)
    if (type !== 'property' || covered?.status !== 'read' || !resource.managed) {
      continue
    }
    const name = path.slice(path.indexOf('/') + 1)
    if (
      takeoverRefusal(loaded, target, address) === undefined &&
      meta[address]?.hubspotDefined !== true &&
      !covered.shadowed?.includes(name) &&
      !covered.excluded?.includes(address) &&
      keptByRead(overrides, target, address, resource, schemaNames(resources[`object:${object}`]?.definition)) ===
        undefined
    ) {
      out.properties.push(address)
    }
  }
  const archived = new Set(out.properties)
  for (const address of Object.keys(resources).sort(byCodeUnit)) {
    const { type, path } = parseAddress(address)
    const object = path.slice(0, path.indexOf('/'))
    const name = path.slice(path.indexOf('/') + 1)
    const covered = own(coverage.objects, object)
    if (type !== 'group' || covered?.status !== 'read' || covered.shadowed?.includes(name)) {
      continue
    }
    const held = own(own(members, object) ?? {}, name) ?? []
    const emptied = held.length > 0 && held.every((p) => archived.has(`property:${object}/${p}`))
    if (emptied && takeoverRefusal(loaded, target, address) === undefined) {
      out.groups.push(address)
    }
  }
  return out
}

/**
 * Why config does not let takeover archive `address` on `target`, or undefined when it does: the object's mode is
 * takeover, config and removed.ts do not name it, no name override reads it, exclude leaves it in, and for a
 * property the pull scope takes custom properties or include names it. What only a read can tell (HubSpot-defined,
 * calculated, unsupported, the members of a group) is the observation's to check.
 */
export function takeoverRefusal(
  loaded: Pick<Loaded, 'config' | 'ir'>,
  target: string,
  address: Address,
): string | undefined {
  const { config, ir } = loaded
  const { type } = parseAddress(address)
  if (type === 'object') {
    return 'takeover never archives a custom object'
  }
  // A custom object's tombstone covers everything on it: a release keeps it all in HubSpot, a destroy archives it all
  // with the object. Either way takeover leaves it alone.
  const cover = coverOf(ir.tombstones, address)
  if (cover !== undefined) {
    return `removed.ts names ${cover}, which takes ${address} along`
  }
  const object = objectOf(address)
  const name = nameOf(address)
  const mode = modeOf(config, target, object)
  if (mode.value !== 'takeover') {
    return `the mode of ${object} on target ${target} is ${mode.value}`
  }
  if (Object.hasOwn(ir.resources, address)) {
    return `${address} is in config`
  }
  if (Object.hasOwn(ir.tombstones, address)) {
    return `${address} is in removed.ts`
  }
  const overrides: Record<string, Override> = own(config.targets, target)?.overrides ?? {}
  if (own(overrides, `object:${object}`)?.skip === true) {
    return `a skip override leaves ${object} out on target ${target}`
  }
  if (own(overrides, address)?.skip === true) {
    return `a skip override leaves ${address} out on target ${target}`
  }
  const renamed = Object.entries(overrides).find(
    ([a, o]) => o.skip !== true && o.name === name && a.startsWith(`${type}:${object}/`),
  )
  if (renamed) {
    return `the name override of ${renamed[0]} reads ${name}`
  }
  const scope = own(config.objects, object)
  if (excluder(scope?.exclude)(name)) {
    return `objects.${object}.exclude names ${name}`
  }
  const inScope = scopeOf(scope)
  if (type === 'property' && !(inScope.custom || inScope.include.has(name))) {
    return `${name} is outside the pull scope of ${object}`
  }
  if (type !== 'property' && type !== 'group') {
    return `takeover archives properties and groups, not ${type}`
  }
  return undefined
}

/**
 * Why what a read found keeps takeover from archiving the property at `address` on `target`, or undefined when it does
 * not: a skip override covers the group HubSpot holds it in (`observed`), or its object's custom object schema names it
 * (`schemaNamed`, local names).
 */
export function keptByRead(
  overrides: Record<string, Pick<Override, 'skip'>>,
  target: string,
  address: Address,
  observed: IRResource | undefined,
  schemaNamed: readonly string[],
): string | undefined {
  const { path } = parseAddress(address)
  const group = (observed?.definition?.group as Ref | undefined)?.$ref
  if (group !== undefined && own(overrides, group)?.skip === true) {
    return `HubSpot holds it in ${group}, which a skip override leaves out on target ${target}`
  }
  const name = path.slice(path.indexOf('/') + 1)
  if (schemaNamed.includes(name)) {
    return `the ${path.slice(0, path.indexOf('/'))} schema names ${name}`
  }
  return undefined
}

/** The local names of the properties a custom object schema's definition names, sorted. */
export function schemaNames(definition: Record<string, unknown> | undefined): string[] {
  const d = definition ?? {}
  const names = SCHEMA_FIELDS.flatMap((field) => [d[field]].flat().filter((v): v is string => typeof v === 'string'))
  return [...new Set(names)].sort(byCodeUnit)
}

// An own key only: a key such as 'constructor' must not find Object.prototype.
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
