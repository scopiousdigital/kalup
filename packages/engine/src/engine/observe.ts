// One side of a comparison, as IR resources under local addresses. A target is read through the shared read pipeline
// and recorded with the coverage that says what the read proved; config is its own observation. Portal strings stay
// exact here: sanitizing is for text a person reads.
import type { Override, Target } from '@kalup/core'
import { isAddress, parseAddress } from '../ir/address.js'
import type { Address, Coverage, IRResource, Issue, ObjectCoverage, UnsupportedProperty } from '../ir/types.js'
import type { HttpClient } from '../lib/http.js'
import type {
  Listed,
  LiveObject,
  LiveProperty,
  UnsupportedProperty as LiveUnsupported,
  PropertyMeta,
} from '../lib/pull/normalize.js'
import { type Portal, readPortal } from '../lib/pull/read.js'
import { inScope, scopeOf } from '../lib/pull/scope.js'
import { sanitize } from '../lib/sanitize.js'
import { effectiveResources } from '../loader/effective.js'
import { byCodeUnit, definitionToIR, type Loaded } from '../loader/load.js'
import { nameOf, objectOf } from './units.js'

export type Side =
  | { kind: 'config' }
  | { kind: 'target'; name: string; portalId: number }
  | { kind: 'snapshot'; file: string; name: string; observedAt: string; portalId: number }

export type { PropertyMeta } from '../lib/pull/normalize.js'

export interface Observation {
  /** Absent on the config side. */
  coverage?: Coverage
  /**
   * A read of a target only: per object read, how many unarchived groups and, when read, pipelines HubSpot's lists
   * returned, skipped and unaddressable ones included. Kept out of snapshots and coverage.
   */
  listed?: Record<string, Listed>
  /**
   * A read of a target only: per object read, per portal group name, the portal names of the unarchived properties in
   * it, whatever the scope, overrides and names. Sorted. Kept out of snapshots and coverage.
   */
  members?: Record<string, Record<string, string[]>>
  /**
   * A read of a target only: per property the read returned under an address, its sensitivity list, HubSpot's
   * hubspotDefined, modificationMetadata, createdAt and updatedAt, and its options' raw displayOrder, whether or not it
   * was captured. Sorted. Kept out of snapshots and coverage.
   */
  meta?: Record<Address, PropertyMeta>
  /** Local addresses, after name overrides, sorted. A captured resource has no binding and no lifecycle. */
  resources: Record<Address, IRResource>
  side: Side
}

export interface TargetObservation {
  /**
   * E_SCOPE for each list the key could not read, W_UNSUPPORTED_TYPE for each property no builder carries, and
   * W_UNADDRESSABLE_NAME for each group or property left out because no address can hold its name.
   */
  issues: Issue[]
  observation: Observation
}

export type Status = 'present' | 'absent' | 'unreadable' | 'unsupported' | 'excluded' | 'not-observed'

/**
 * The fields the 2026-09 properties, groups and schemas lists document that no captured resource carries. `archived`
 * is not listed: an archived resource is not captured at all. `dateDisplayHint` is read-only in practice: HubSpot
 * ignores it on create and update (observed, docs/hubspot.md).
 */
export const NOT_CAPTURED: Coverage['notCaptured'] = {
  property: [
    'archivedAt',
    'createdAt',
    'createdUserId',
    'dateDisplayHint',
    'modificationMetadata',
    'sensitiveDataCategories',
    'updatedAt',
    'updatedUserId',
  ],
  group: ['displayOrder'],
  pipeline: ['archived', 'createdAt', 'updatedAt'],
  stage: ['archived', 'createdAt', 'isClosed', 'updatedAt', 'writePermissions'],
  object: [
    'allowsSensitiveProperties',
    'associations',
    'createdAt',
    'createdByUserId',
    'description',
    'fullyQualifiedName',
    'id',
    'properties',
    'updatedAt',
    'updatedByUserId',
  ],
}

const OBSERVED_TYPES = new Set(['object', 'group', 'property', 'pipeline', 'stage'])
/** The resource types read from an object's pipelines list. */
export const PIPELINE_TYPES: ReadonlySet<string> = new Set(['pipeline', 'stage'])

const NAME_FIX = 'rename it in HubSpot to a name without spaces'

/**
 * The config IR as the side of a comparison, as target `target` sees it when one is given: its definition overrides
 * applied. It has no coverage: an address is present or absent.
 */
export function configObservation(loaded: Pick<Loaded, 'ir'>, target?: string): Observation {
  const resources = target === undefined ? loaded.ir.resources : effectiveResources(loaded.ir, target)
  return { side: { kind: 'config' }, resources }
}

/**
 * Reads target `targetName` and records what it holds for the config's objects. The command runs the portal guard
 * first. The read's E_UNKNOWN_OBJECT and E_OVERRIDE_AMBIGUOUS propagate.
 */
export async function observeTarget(
  http: HttpClient,
  loaded: Pick<Loaded, 'config' | 'configLines' | 'ir'>,
  targetName: string,
): Promise<TargetObservation> {
  // validate rejected an unknown target and a missing portalId before any command reads.
  const target = loaded.config.targets[targetName] as Target
  const issues: Issue[] = []
  const portal = await readPortal(http, loaded, target, issues)
  return observePortal(portal, loaded, targetName, issues)
}

/**
 * What a read of target `targetName` holds for the config's objects, as observeTarget records it. pull records its own
 * read through here, so it classifies against the base exactly as plan does. Issues about the read go to `issues`.
 */
export function observePortal(
  portal: Portal,
  loaded: Pick<Loaded, 'config' | 'ir'>,
  targetName: string,
  issues: Issue[],
): TargetObservation {
  const target = loaded.config.targets[targetName] as Target
  const resources: [Address, IRResource][] = []
  const meta: [Address, PropertyMeta][] = []
  const objects: Record<string, ObjectCoverage> = {}
  const members: Record<string, Record<string, string[]>> = {}
  const listed: Record<string, Listed> = {}
  for (const key of Object.keys(loaded.config.objects).sort(byCodeUnit)) {
    const live = portal.objects.find((o) => o.object === key)
    if (live) {
      members[key] = Object.fromEntries([...live.members].sort(([a], [b]) => byCodeUnit(a, b)))
    }
    if (live?.listed) {
      listed[key] = live.listed
    }
    const under = (address: Address) => objectOf(address) === key
    objects[key] = compact({
      ...(live ? capture(live, loaded, { resources, meta }, issues) : unread(key, portal)),
      pipelines: live ? pipelineCoverage(live, portal, resources, issues) : undefined,
      shadowed: nonEmpty([...new Set(portal.shadowed.filter(under).map(nameOf))].sort(byCodeUnit)),
      excluded: nonEmpty(portal.excluded.filter(under)),
      renamed: renamed(target.overrides ?? {}, under),
    })
  }
  // A property config names that the read could not capture is unknown too, so the read is not complete.
  const coverage: Coverage = {
    complete: Object.values(objects).every(
      (o) => o.status !== 'unreadable' && o.unaddressable === undefined && o.pipelines?.status !== 'unreadable',
    ),
    objects,
    otherObjects: portal.customObjects === undefined ? 'unknown' : [...portal.otherObjects].sort(byCodeUnit),
    notCaptured: NOT_CAPTURED,
  }
  const observation: Observation = {
    side: { kind: 'target', name: targetName, portalId: target.portalId as number },
    resources: Object.fromEntries(resources.sort(([a], [b]) => byCodeUnit(a, b))),
    coverage,
    meta: Object.fromEntries(meta.sort(([a], [b]) => byCodeUnit(a, b))),
    members,
    listed,
  }
  return { observation, issues }
}

/**
 * Whether an observation holds an address. Config: present or absent. A target or snapshot: the object's status
 * first, then a skip override, then the resource itself, then an unsupported property, then one config names that its
 * group's name kept out (unreadable), then the pull scope. A renamed address is the portal resource its override names,
 * so it is never out of scope.
 */
export function statusOf(observation: Observation, address: Address): Status {
  const { coverage, resources } = observation
  const held = Object.hasOwn(resources, address)
  if (!coverage) {
    return held ? 'present' : 'absent'
  }
  const { type } = parseAddress(address)
  const key = objectOf(address)
  const object = Object.hasOwn(coverage.objects, key) ? coverage.objects[key] : undefined
  if (!(object && OBSERVED_TYPES.has(type))) {
    return 'not-observed'
  }
  if (object.status !== 'read') {
    return object.status
  }
  if (PIPELINE_TYPES.has(type)) {
    return pipelineStatus(object, address, held)
  }
  if (type === 'object') {
    if (object.unsupportedSchema) {
      return 'unsupported'
    }
    // A standard object is read through its lists alone: no custom object schema, so no resource, stands behind it.
    return held ? 'present' : 'absent'
  }
  if (object.excluded?.includes(address)) {
    return 'excluded'
  }
  if (held) {
    return 'present'
  }
  return type === 'property' ? propertyStatus(object, address) : 'absent'
}

// A property the read did not hold: unsupported, unreadable, out of the pull scope or absent.
function propertyStatus(object: ObjectCoverage, address: Address): Status {
  const name = nameOf(address)
  if (object.unsupported?.some((u) => u.name === name)) {
    return 'unsupported'
  }
  if (object.unaddressable?.includes(name)) {
    return 'unreadable'
  }
  const renamedTo = object.renamed && Object.hasOwn(object.renamed, address)
  return !renamedTo && object.outOfScope?.includes(name) ? 'excluded' : 'absent'
}

// A pipeline or stage: not observed unless the object's pipelines were read, then the resource itself.
function pipelineStatus(object: ObjectCoverage, address: Address, held: boolean): Status {
  if (object.pipelines === undefined) {
    return 'not-observed'
  }
  if (object.pipelines.status !== 'read') {
    return 'unreadable'
  }
  if (object.excluded?.includes(address)) {
    return 'excluded'
  }
  return held ? 'present' : 'absent'
}

/** The type ID of each custom object the observation saw exist, by config key. */
export function objectTypeIds(observation: Observation): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, object] of Object.entries(observation.coverage?.objects ?? {})) {
    if (object.objectTypeId !== undefined) {
      out[key] = object.objectTypeId
    }
  }
  return out
}

// One object that was read: its groups, the properties the pull scope, config or a tombstone names, and its schema,
// plus the meta of every property with an address. A schema missing a label is recorded in coverage, since no resource
// can carry it. A reference to a shadowed name arrives as `shadowed:<name>` from the read. A property config names that
// its group's name kept out is unaddressable, never out of scope: config manages it, so what the portal holds there is
// unknown, not absent.
function capture(
  live: LiveObject,
  loaded: Pick<Loaded, 'config' | 'ir'>,
  into: { resources: [Address, IRResource][]; meta: [Address, PropertyMeta][] },
  issues: Issue[],
): ObjectCoverage {
  const { object, custom } = live
  const { resources } = into
  const scope = scopeOf(loaded.config.objects[object])
  // A tombstoned property is read wherever the scope puts it: a delete compares its live values.
  const named = (name: string) => {
    const address = `property:${object}/${name}`
    return (
      isAddress(address) &&
      (Object.hasOwn(loaded.ir.resources, address) || Object.hasOwn(loaded.ir.tombstones, address))
    )
  }
  const left = unaddressable(live, issues, (p) => inScope(scope, p) || named(p.name))
  for (const [name, meta] of live.meta) {
    if (!left.properties.has(name)) {
      into.meta.push([`property:${object}/${name}`, meta])
    }
  }
  const captured = (p: { name: string; hubspotDefined: boolean }) =>
    !left.properties.has(p.name) && (inScope(scope, p) || named(p.name))
  const unknown = [...left.properties].filter(named)
  for (const [name, label] of live.groups) {
    if (!left.groups.has(name)) {
      resources.push([`group:${object}/${name}`, { type: 'group', managed: true, definition: { label } }])
    }
  }
  for (const p of live.properties.filter(captured)) {
    resources.push([`property:${object}/${p.name}`, propertyResource(object, p)])
  }
  const labelled = custom?.labels.singular !== undefined && custom.labels.plural !== undefined
  if (custom && labelled) {
    resources.push([`object:${object}`, { type: 'object', managed: true, definition: { ...custom } }])
  }
  return {
    status: 'read',
    objectTypeId: live.objectTypeId,
    outOfScope: nonEmpty(
      [...live.properties, ...live.unsupported]
        .filter((p) => !(captured(p) || unknown.includes(p.name)))
        .map((p) => p.name)
        .sort(byCodeUnit),
    ),
    unaddressable: nonEmpty(unknown.sort(byCodeUnit)),
    unsupported: nonEmpty(
      live.unsupported
        .filter(captured)
        .map((u) => unsupportedProperty(object, u))
        .sort((a, b) => byCodeUnit(a.name, b.name)),
    ),
    unsupportedSchema: labelled ? undefined : custom,
  }
}

// The names of one object that no address can hold, each with W_UNADDRESSABLE_NAME: a group's, and a property's own
// or its group's, the property's only when `wanted` says the project pulls or names it. A snapshot could not hold them,
// so they are left out.
function unaddressable(
  live: LiveObject,
  issues: Issue[],
  wanted: (p: { name: string; hubspotDefined: boolean }) => boolean,
): { groups: Set<string>; properties: Set<string> } {
  const { object } = live
  const held = (type: string, name: string) => isAddress(`${type}:${object}/${name}`)
  const groups = new Set([...live.groups.keys()].filter((name) => !held('group', name)))
  const properties = new Set<string>()
  const leave = (message: string, fix: string) =>
    issues.push({ code: 'W_UNADDRESSABLE_NAME', message: `${message}, so it is not captured`, fix })
  for (const name of groups) {
    leave(`group '${sanitize(name)}' on ${object} has a name no address can hold`, NAME_FIX)
  }
  for (const p of [
    ...live.unsupported,
    ...live.properties.map((l) => ({ name: l.name, group: l.definition?.group, hubspotDefined: l.hubspotDefined })),
  ]) {
    if (!held('property', p.name)) {
      properties.add(p.name)
      if (wanted(p)) {
        leave(`property '${sanitize(p.name)}' on ${object} has a name no address can hold`, NAME_FIX)
      }
    } else if (p.group !== undefined && !held('group', p.group)) {
      properties.add(p.name)
      const where = `is in group '${sanitize(p.group)}', whose name no address can hold`
      if (wanted(p)) {
        leave(
          `property '${sanitize(p.name)}' on ${object} ${where}`,
          'rename the group in HubSpot to a name without spaces',
        )
      }
    }
  }
  return { groups, properties }
}

// A managed property with its full definition, or a reference with its options at most.
function propertyResource(object: string, p: LiveProperty): IRResource {
  const resource: IRResource = { type: 'property', managed: !p.reference }
  if (p.definition) {
    resource.definition = definitionToIR(object, p.kind, p.definition)
  }
  return resource
}

function unsupportedProperty(object: string, u: LiveUnsupported): UnsupportedProperty {
  return { ...u, group: { $ref: `group:${object}/${u.group}` } }
}

// The pipelines of an object that was read, each one and its stages as resources, and whether its pipelines list was
// read: absent when they are not in scope. A pipeline or stage ID no address can hold is left out with
// W_UNADDRESSABLE_NAME.
function pipelineCoverage(
  live: LiveObject,
  portal: Portal,
  resources: [Address, IRResource][],
  issues: Issue[],
): ObjectCoverage['pipelines'] {
  const { object } = live
  if (live.pipelines === undefined) {
    const gap = portal.gaps.find((g) => g.object === object && g.list === 'pipelines')
    return gap ? { status: 'unreadable', missingScope: gap.scope } : undefined
  }
  const held = (id: string) => isAddress(`pipeline:${object}/${id}`) && !id.includes('/')
  const leave = (what: string, id: string) =>
    issues.push({
      code: 'W_UNADDRESSABLE_NAME',
      message: `${what} '${sanitize(id)}' on ${object} has an ID no address can hold, so it is not captured`,
      fix: 'leave it out of config; HubSpot never changes a pipeline or stage ID',
    })
  for (const p of live.pipelines) {
    if (!held(p.id)) {
      leave('pipeline', p.id)
      continue
    }
    const stages = p.stages.filter((st) => {
      if (!held(st.id)) {
        leave('stage', st.id)
      }
      return held(st.id)
    })
    const definition = { label: p.label, displayOrder: p.displayOrder, stages: stages.map((st) => st.id) }
    resources.push([`pipeline:${object}/${p.id}`, { type: 'pipeline', managed: true, definition }])
    for (const st of stages) {
      const { id, ...fields } = st
      resources.push([`stage:${object}/${p.id}/${id}`, { type: 'stage', managed: true, definition: fields }])
    }
  }
  return { status: 'read' }
}

// An object that was not read: skipped, absent from the portal, or behind a 403 on one of its lists or, for a custom
// object, on the schemas list. A gap is always a 403, which the client reports as E_SCOPE.
function unread(key: string, portal: Portal): ObjectCoverage {
  if (portal.excluded.includes(`object:${key}`)) {
    return { status: 'excluded' }
  }
  if (portal.absent.includes(key)) {
    return { status: 'absent' }
  }
  const gap = portal.gaps.find((g) => g.object === key) ?? portal.gaps.find((g) => g.list === 'schemas')
  return { status: 'unreadable', missingScope: gap?.scope, issue: 'E_SCOPE' }
}

// The name overrides under one object, a skip winning over a name as in the read. Sorted.
function renamed(overrides: Record<string, Override>, under: (address: Address) => boolean) {
  const entries = Object.entries(overrides)
    .filter(([address, o]) => o.name !== undefined && o.skip !== true && under(address))
    .map(([address, o]) => [address, o.name as string] as const)
    .sort(([a], [b]) => byCodeUnit(a, b))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function nonEmpty<T>(list: T[]): T[] | undefined {
  return list.length > 0 ? list : undefined
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
