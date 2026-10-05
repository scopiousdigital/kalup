// What apply reads before it writes: for each object a saved plan's effects touch, the three
// sensitivity lists and the groups list, the archived lists where a property create needs them, and the schemas list
// when the effects touch a custom object or the plan binds a type ID. Names come from the plan's bindings, which must
// be the ones the target's name overrides and the schemas list give, and each resource is normalized as the plan's
// observation was, so a step's `expect` compares with it directly. A list the key cannot read is E_INCOMPLETE: apply
// never writes on a partial read.
import type { Override } from '@kalup/core'
import { bin } from '../brand.js'
import { parseAddress } from '../ir/address.js'
import { stableStringify } from '../ir/serialize.js'
import type { Address, IRResource, Issue } from '../ir/types.js'
import { exitCodes, KalupError } from '../lib/errors.js'
import { type HttpClient, type HttpRequest, HubSpotApiError } from '../lib/http.js'
import {
  namesOf as definitionNames,
  pairUp,
  type RawAssociationDefinition,
  type RawLabel,
} from '../lib/pull/associations.js'
import {
  groupMembers,
  type Listed,
  type ListedProperty,
  type LivePipeline,
  normalizeGroups,
  normalizePipelines,
  normalizeProperties,
  normalizeSchema,
  type PropertyMeta,
  propertyMeta,
  type RawGroup,
  type RawPipeline,
  type RawProperty,
  type RawSchema,
  type Sensitivity,
} from '../lib/pull/normalize.js'
import {
  type ArchivedProperty,
  archivedProperties,
  archivedSchemaNames,
  localSchema,
  SCHEMA_LIST,
} from '../lib/pull/read.js'
import { STANDARD_OBJECTS } from '../lib/pull/scope.js'
import { readScope, registry } from '../lib/registry.js'
import { sanitize } from '../lib/sanitize.js'
import { byCodeUnit, definitionToIR } from '../loader/load.js'
import type { Plan, PlanBinding, PlanStep } from '../plan/types.js'
import { hasEffect } from './digest.js'
import { associationLabels, PIPELINE_TYPES } from './observe.js'
import { bindingsFor, dependencies } from './plan.js'
import { schemaNames } from './takeover.js'
import { objectOf, pairOf, pipelineOf, shownName, targetFlag } from './units.js'

/** What apply observed of the objects a plan's effects touch, under the plan's addresses. */
export interface ApplyObservation {
  /** Per object key whose archived lists were read, its archived properties by portal name. */
  archived: Record<string, ArchivedProperty[]>
  /** The names of the archived custom object schemas, read when the plan creates a custom object. */
  archivedSchemas: string[]
  /** Per association address the read found, its HubSpot type IDs, its direction's first. */
  associationIds: Record<Address, [number, number]>
  /**
   * Per object read, how many unarchived groups HubSpot's list returned and, for a custom object the plan archives, how
   * many pipelines: what the archive takes along, counted as plan counts them.
   */
  listed: Record<string, Listed>
  /** Per object key read, per portal group name, the portal names of its unarchived properties. */
  members: Record<string, Record<string, string[]>>
  /** Per property address the read found, its sensitivity list and HubSpot's flags. */
  meta: Record<Address, PropertyMeta>
  /** How many requests the observation sent. */
  reads: number
  /** Per effect step address the read found, the resource as the plan's observation held it. */
  resources: Record<Address, IRResource>
  /**
   * The type IDs of the custom objects the schemas list held, when it was read: a create HubSpot answers with one of
   * these made nothing (a create of an active schema's name answers 201 with that schema, observed 2026-10-05).
   */
  schemaIds: string[]
  /** Per custom object key whose schema was read, the local names of the properties the schema names. */
  schemaNamed: Record<string, string[]>
  /** Property addresses the read found with a type no builder carries. */
  unsupported: Address[]
}

/** How a plan names what it touches in the portal: portal names and object type IDs from its bindings. */
export interface Names {
  /** A group's local address from its portal name on one object. */
  localGroup: (key: string, portalName: string) => string
  /** A pipeline's local ID from its portal ID on one object. */
  localPipeline: (key: string, portalId: string) => string
  /** A property's local address from its portal name on one object. */
  localProperty: (key: string, portalName: string) => string
  /** A stage's local ID from its portal ID, in the pipeline of one object with that local ID. */
  localStage: (key: string, pipeline: string, portalId: string) => string
  /** The object type the paths take: a custom object's bound type ID, else the standard object's name. */
  objectType: (key: string) => string
  /** The portal ID of a pipeline address, or of the pipeline a stage address is under. */
  pipelineId: (address: Address) => string
  /** The portal name an address resolves to: its name binding, else its own name; a stage's own ID for a stage. */
  portalName: (address: Address) => string
}

/**
 * The names of one plan. With `overrides`, a target's overrides from kalup.config.ts, portal names come from its name
 * overrides, which cover the addresses no step touches, such as the properties a custom object schema names.
 */
export function namesOf(
  plan: Pick<Plan, 'bindings'>,
  overrides?: Record<string, Pick<Override, 'name' | 'skip'>>,
): Names {
  const own = (address: string) => (Object.hasOwn(plan.bindings, address) ? plan.bindings[address] : undefined)
  const pairs: [Address, string | undefined][] = overrides
    ? Object.entries(overrides).map(([a, o]) => [a, o.skip === true ? undefined : o.name])
    : Object.entries(plan.bindings).map(([a, b]) => [a, b.name])
  const renamed = new Map(pairs.filter((pair): pair is [Address, string] => pair[1] !== undefined))
  const local = (prefix: string, portalName: string) => {
    const bound = [...renamed].find(([address, name]) => address.startsWith(prefix) && name === portalName)
    return bound ? bound[0].slice(prefix.length) : portalName
  }
  const portalOf = (address: Address) => renamed.get(address) ?? shownName(address)
  return {
    portalName: portalOf,
    objectType: (key) => own(`object:${key}`)?.id ?? key,
    localGroup: (key, name) => local(`group:${key}/`, name),
    localProperty: (key, name) => local(`property:${key}/`, name),
    localPipeline: (key, id) => local(`pipeline:${key}/`, id),
    localStage: (key, pipeline, id) => local(`stage:${key}/${pipeline}/`, id),
    pipelineId: (address) => portalOf(kindOf(address) === 'stage' ? pipelineOf(address) : address),
  }
}

// HubSpot lists one data sensitivity per request.
const SENSITIVITIES: Sensitivity[] = ['non_sensitive', 'sensitive', 'highly_sensitive']

/** Reads one list, counting it; a 403 is E_INCOMPLETE naming the list. */
type Read = <T>(req: HttpRequest, list: string) => Promise<T>

/**
 * Reads what the plan's effect steps touch. E_INCOMPLETE on a 403 for any list an affected object needs, and
 * E_BINDING_CHANGED when the plan's bindings are not the ones `overrides` (the target's, from kalup.config.ts; the
 * plan's own name bindings when absent) and the schemas list give: a custom object's type ID changed, or the plan binds
 * an address to another portal resource. Any other error propagates.
 */
export async function observeForApply(
  http: HttpClient,
  plan: Plan,
  overrides?: Record<string, Override>,
  known: Record<Address, readonly number[]> = {},
): Promise<ApplyObservation> {
  const effects = plan.steps.filter(hasEffect)
  const keys = [...new Set(effects.map((s) => objectOf(s.address)))].sort(byCodeUnit)
  const out: ApplyObservation = {
    associationIds: {},
    archived: {},
    archivedSchemas: [],
    members: {},
    meta: {},
    listed: {},
    reads: 0,
    resources: {},
    schemaIds: [],
    schemaNamed: {},
    unsupported: [],
  }
  const read: Read = async <T>(req: HttpRequest, list: string): Promise<T> => {
    out.reads += 1
    try {
      return await http.request<T>(req)
    } catch (error) {
      throw refused(error) ? incomplete(plan, list, scopeFor(req)) : error
    }
  }
  const names = namesOf(plan, overrides)
  const schemas = await checkBindings(plan, read, overrides ?? overridesOf(plan))
  out.schemaIds = (schemas ?? []).map((s) => s.objectTypeId)
  if (effects.some(createsObject)) {
    out.reads += 1
    out.archivedSchemas = await archivedSchemaNames(http).catch((error: unknown) => {
      throw refused(error)
        ? incomplete(plan, 'the archived custom object schemas list', readScope(registry.object))
        : error
    })
  }
  const associationNames = new Map<string, Map<string, string>>()
  for (const key of keys) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one object at a time for the rate limits
    await observeObject(http, read, { plan, names, schemas, known, associationNames }, key, out)
  }
  return out
}

/** What one object's observation works from: the plan, its names, and the schemas list when it was read. */
interface Observing {
  /** The association names of each object type whose schema was read, by type ID. */
  associationNames: Map<string, Map<string, string>>
  /** The type IDs state records per association address. */
  known: Record<Address, readonly number[]>
  names: Names
  plan: Plan
  schemas: RawSchema[] | undefined
}

// One object: its pipelines when a pipeline or stage step touches it, and its properties and groups when any other step
// does. A custom object the plan creates has no lists to read yet: only whether a schema holds its name, ignoring case,
// as HubSpot does.
async function observeObject(http: HttpClient, read: Read, observing: Observing, key: string, out: ApplyObservation) {
  const effects = observing.plan.steps.filter((s) => hasEffect(s) && objectOf(s.address) === key)
  const create = effects.find(createsObject)
  if (create) {
    const name = observing.names.portalName(create.address).toLowerCase()
    const schema = observing.schemas?.find((s) => s.name.toLowerCase() === name)
    if (schema) {
      recordObject(out, create.address, objectResource(key, schema, observing.names))
    }
    return
  }
  const associations = effects.filter((s) => kindOf(s.address) === 'association')
  // An association on a custom object the plan creates has nothing to read yet: HubSpot knows no such object type.
  const created = new Set(observing.plan.steps.filter(createsObject).map((s) => objectOf(s.address)))
  for (const step of associations.filter((s) => !pairOf(s.address).some((side) => created.has(side)))) {
    const list = `the labels of ${step.address.slice('association:'.length, step.address.lastIndexOf('/'))}`
    const { names, known, associationNames } = observing
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one pair at a time for the rate limits
    const found = await readAssociation((req) => read(req, list), names, step.address, known, associationNames)
    if (found) {
      out.resources[step.address] = found.resource
      out.associationIds[step.address] = found.typeIds
    }
  }
  const pipelines = effects.filter((s) => PIPELINE_TYPES.has(kindOf(s.address)))
  if (pipelines.length > 0) {
    await observePipelines(read, observing, key, pipelines, out)
  }
  // An archive's step names what it takes along: the count of pipelines is checked against this read.
  if (effects.some((s) => kindOf(s.address) === 'object' && s.action === 'delete')) {
    const objectType = observing.names.objectType(key)
    const all = await read<{ results: RawPipeline[] }>(
      { type: 'pipeline', path: 'list', params: { objectType } },
      `the pipelines list of ${key}`,
    )
    out.listed[key] = { groups: 0, ...out.listed[key], pipelines: all.results.length }
  }
  if (pipelines.length + associations.length < effects.length) {
    await observeProperties(http, read, observing, key, out)
  }
}

/**
 * One association, from both labels lists of its pair and the internal names the from object's schema read gives: the
 * pair of types its portal name holds, else the pair `known` holds (the type IDs state records, or a create's answer
 * gave), since the schema read lists a new name only minutes after the create (observed 2026-10-05). Undefined when
 * neither finds it: both lists were read, so it is gone.
 */
export async function readAssociation(
  get: <T>(req: HttpRequest) => Promise<T>,
  names: Pick<Names, 'objectType' | 'portalName'>,
  address: Address,
  known: Record<Address, readonly number[]>,
  cache: Map<string, Map<string, string>> = new Map(),
): Promise<{ resource: IRResource; typeIds: [number, number] } | undefined> {
  const [from, to] = pairOf(address)
  const fromType = names.objectType(from)
  const toType = names.objectType(to)
  const list = (a: string, b: string) =>
    get<{ results: RawLabel[] }>({ type: 'association', path: 'list', params: { fromObjectType: a, toObjectType: b } })
  const forward = (await list(fromType, toType)).results
  const back = (await list(toType, fromType)).results
  const name = names.portalName(address)
  const ids = new Set(known[address] ?? [])
  const lookup = (named: Map<string, string>) =>
    pairUp(forward, back, (typeId) => named.get(String(typeId)) ?? (ids.has(typeId) ? name : undefined)).found.find(
      (f) => f.name === name,
    )
  // A type ID keeps its name, so the names `cache` holds from earlier in the run still hold. A schema read is large (the
  // companies one about 400 KB), so it is read again only when they do not find the association.
  const cached = cache.get(fromType)
  let found = cached && lookup(cached)
  if (found === undefined) {
    const schema = await get<{ associations?: RawAssociationDefinition[] }>({
      type: 'association',
      path: 'names',
      params: { objectType: fromType },
    })
    const named = definitionNames(schema.associations ?? [])
    cache.set(fromType, named)
    found = lookup(named)
  }
  if (found === undefined) {
    return undefined
  }
  const resource: IRResource = { type: 'association', managed: true, definition: associationLabels(...found.labels) }
  return { resource, typeIds: found.typeIds }
}

// The pipelines of one object, read once: each pipeline step's pipeline, and each stage step's stage and its pipeline,
// under the plan's local IDs, normalized as the plan's observation was.
async function observePipelines(
  read: Read,
  { names }: Observing,
  key: string,
  steps: PlanStep[],
  out: ApplyObservation,
): Promise<void> {
  const objectType = names.objectType(key)
  const listed = await read<{ results: RawPipeline[] }>(
    { type: 'pipeline', path: 'list', params: { objectType } },
    `the pipelines list of ${key}`,
  )
  const live = localPipelines(key, normalizePipelines(key, listed.results, !STANDARD_OBJECTS.has(key)), names)
  for (const step of steps) {
    const pipeline = kindOf(step.address) === 'stage' ? pipelineOf(step.address) : step.address
    Object.assign(out.resources, Object.fromEntries(pipelineResources(live, pipeline)))
  }
}

/** The pipelines of one object under the plan's local pipeline and stage IDs. */
export function localPipelines(key: string, live: LivePipeline[], names: Pick<Names, 'localPipeline' | 'localStage'>) {
  return live.map((p) => {
    const id = names.localPipeline(key, p.id)
    return { ...p, id, stages: p.stages.map((st) => ({ ...st, id: names.localStage(key, id, st.id) })) }
  })
}

/** One pipeline, `pipeline:<key>/<id>`, and its stages as resources, as observe captures them. None when absent. */
export function pipelineResources(live: LivePipeline[], pipeline: Address): [Address, IRResource][] {
  const id = pipeline.slice(pipeline.lastIndexOf('/') + 1)
  const found = live.find((p) => p.id === id)
  if (found === undefined) {
    return []
  }
  const definition = { label: found.label, displayOrder: found.displayOrder, stages: found.stages.map((st) => st.id) }
  const prefix = `${pipeline.replace('pipeline:', 'stage:')}/`
  return [
    [pipeline, { type: 'pipeline', managed: true, definition }],
    ...found.stages.map(({ id: stage, ...fields }): [Address, IRResource] => [
      `${prefix}${stage}`,
      { type: 'stage', managed: true, definition: fields },
    ]),
  ]
}

// One object's properties and groups: its three properties lists, its groups, what each effect step on it finds there
// (a custom object's step finds its schema), and the archived properties when a property create needs them.
async function observeProperties(
  http: HttpClient,
  read: Read,
  observing: Observing,
  key: string,
  out: ApplyObservation,
): Promise<void> {
  const { plan, names, schemas } = observing
  const effects = plan.steps.filter(
    (s) => hasEffect(s) && objectOf(s.address) === key && !PIPELINE_TYPES.has(kindOf(s.address)),
  )
  const objectType = names.objectType(key)
  const properties = await listProperties(read, key, objectType)
  const groups = await read<{ results: RawGroup[] }>(
    { type: 'group', path: 'list', params: { objectType } },
    `the groups list of ${key}`,
  )
  const { groups: live } = normalizeGroups(groups.results)
  out.listed[key] = { ...out.listed[key], groups: groups.results.filter((g) => !g.archived).length }
  out.members[key] = Object.fromEntries([...groupMembers(properties)].sort(([a], [b]) => byCodeUnit(a, b)))
  // Takeover never archives a property the object's schema names.
  const own = STANDARD_OBJECTS.has(key) ? undefined : schemas?.find((s) => s.name === names.portalName(`object:${key}`))
  if (own) {
    out.schemaNamed[key] = schemaNames({
      ...normalizeSchema(localSchema(own, (name) => names.localProperty(key, name))),
    })
  }
  for (const step of effects) {
    const name = names.portalName(step.address)
    const kind = kindOf(step.address)
    if (kind === 'object') {
      const schema = schemas?.find((s) => s.name === name)
      if (schema) {
        recordObject(out, step.address, objectResource(key, schema, names))
      }
      continue
    }
    const label = kind === 'group' ? live.get(name) : undefined
    const found = kind === 'group' ? undefined : properties.find((p) => p.name === name)
    if (label !== undefined) {
      out.resources[step.address] = groupResource(label)
    } else if (found) {
      record(out, step.address, toResource(key, found, names))
    }
  }
  if (effects.some(needsArchived)) {
    out.reads += SENSITIVITIES.length
    out.archived[key] = await archivedProperties(http, objectType).catch((error: unknown) => {
      const list = `the archived properties lists of ${key}`
      throw refused(error) ? incomplete(plan, list, readScope(registry.property, objectType)) : error
    })
  }
}

// The unarchived properties of one object from its three sensitivity lists, each with the list that returned it.
async function listProperties(read: Read, key: string, objectType: string): Promise<ListedProperty[]> {
  const properties: ListedProperty[] = []
  for (const sensitivity of SENSITIVITIES) {
    const query = sensitivity === 'non_sensitive' ? undefined : { dataSensitivity: sensitivity }
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one list at a time for the rate limits
    const listed = await read<{ results: RawProperty[] }>(
      { type: 'property', path: 'list', params: { objectType }, ...(query ? { query } : {}) },
      `the ${sensitivity} properties list of ${key}`,
    )
    for (const p of listed.results) {
      if (!(p.archived || properties.some((q) => q.name === p.name))) {
        properties.push({ ...p, sensitivity })
      }
    }
  }
  return properties
}

/** A property read, normalized as the plan's observation normalizes it. */
export interface Normalized {
  meta: PropertyMeta
  /** Absent for a property no builder carries. */
  resource?: IRResource
}

/** One property as a list or a single read returned it, under the plan's local group name. */
export function toResource(key: string, raw: ListedProperty, names: Pick<Names, 'localGroup'>): Normalized {
  const local = { ...raw, groupName: names.localGroup(key, raw.groupName) }
  const [meta] = propertyMeta([raw]).values()
  const { properties } = normalizeProperties(key, [local], [])
  const [live] = properties
  if (!live) {
    return { meta: meta as PropertyMeta }
  }
  const resource: IRResource = { type: 'property', managed: !live.reference }
  if (live.definition) {
    resource.definition = definitionToIR(key, live.kind, live.definition)
  }
  return { meta: meta as PropertyMeta, resource }
}

/** A group as a list returned it. */
export function groupResource(label: string): IRResource {
  return { type: 'group', managed: true, definition: { label } }
}

/**
 * A custom object schema as the schemas list returned it, its properties under their local names, as the plan's
 * observation holds it. Undefined for a schema without both labels, which no resource can carry.
 */
export function objectResource(
  key: string,
  schema: RawSchema,
  names: Pick<Names, 'localProperty'>,
): IRResource | undefined {
  const custom = normalizeSchema(localSchema(schema, (name) => names.localProperty(key, name)))
  if (custom.labels.singular === undefined || custom.labels.plural === undefined) {
    return undefined
  }
  return { type: 'object', managed: true, definition: { ...custom } }
}

function record(out: ApplyObservation, address: Address, normalized: Normalized): void {
  out.meta[address] = normalized.meta
  if (normalized.resource) {
    out.resources[address] = normalized.resource
  } else {
    out.unsupported.push(address)
  }
}

function recordObject(out: ApplyObservation, address: Address, resource: IRResource | undefined): void {
  if (resource) {
    out.resources[address] = resource
  } else {
    out.unsupported.push(address)
  }
}

// A create checks that no archived property holds the name. A group delete needs no archived list: only active
// properties block it (observed 2026-10-01).
function needsArchived(step: PlanStep): boolean {
  return step.action === 'create' && kindOf(step.address) === 'property'
}

/** Whether a step creates a custom object. */
export function createsObject(step: PlanStep): boolean {
  return step.action === 'create' && kindOf(step.address) === 'object'
}

// The plan's bindings against the ones its effect steps get from `overrides` and, when they touch a custom object or
// the plan binds a type ID, from the schemas list, read once. The unarchived schemas when the list was read.
async function checkBindings(
  plan: Plan,
  read: Read,
  overrides: Record<string, Override>,
): Promise<RawSchema[] | undefined> {
  const effects = plan.steps.filter(hasEffect)
  const objects = new Set(effects.flatMap(dependencies).map(objectOf))
  const custom = [...objects].some((key) => !STANDARD_OBJECTS.has(key))
  const typed = Object.values(plan.bindings).some((binding) => binding.id !== undefined)
  let schemas: RawSchema[] | undefined
  if (custom || typed) {
    const listed = await read<{ results: RawSchema[] }>(
      { type: 'object', path: 'list', query: SCHEMA_LIST },
      'the custom object schemas list',
    )
    schemas = listed.results.filter((s) => !s.archived)
  }
  const names = namesOf(plan, overrides)
  const idOf = (key: string) => schemas?.find((s) => s.name === names.portalName(`object:${key}`))?.objectTypeId
  const moved = bindingChanges(plan, bindingsFor(effects, overrides, idOf))
  if (moved.length > 0) {
    throw new KalupError({
      code: 'E_BINDING_CHANGED',
      message: sanitize(
        `The bindings of plan ${plan.planId} are not what kalup.config.ts and the portal give now: ${moved.join('; ')}. Nothing was written.`,
        1000,
      ),
      fix: `run ${bin} plan ${targetFlag(plan.target.name)} again and review it`,
    })
  }
  return schemas
}

/**
 * Where a plan's bindings differ from `expected`, the ones kalup.config.ts and the portal give its effect steps, one
 * line per address. Empty when they agree.
 */
export function bindingChanges(plan: Pick<Plan, 'bindings' | 'steps'>, expected: Plan['bindings']): string[] {
  const touched = new Set(plan.steps.filter(hasEffect).flatMap(dependencies))
  return [...new Set([...Object.keys(plan.bindings), ...Object.keys(expected)])].sort(byCodeUnit).flatMap((address) => {
    const was = Object.hasOwn(plan.bindings, address) ? plan.bindings[address] : undefined
    const now = Object.hasOwn(expected, address) ? expected[address] : undefined
    if (stableStringify(was) === stableStringify(now)) {
      return []
    }
    return touched.has(address)
      ? [bindingChange(address, was, now)]
      : [`the plan binds ${address}, which no step touches`]
  })
}

// How one binding differs: `was` from the plan, `now` from kalup.config.ts and the portal.
function bindingChange(address: Address, was: PlanBinding | undefined, now: PlanBinding | undefined): string {
  const parts: string[] = []
  if (was?.name !== now?.name) {
    const planned = was?.name === undefined ? 'no portal name' : `portal name ${was.name}`
    const given = now?.name === undefined ? 'none' : now.name
    parts.push(`the plan binds ${address} to ${planned}, and the name override in kalup.config.ts gives ${given}`)
  }
  if (was?.id !== now?.id) {
    const planned = was?.id === undefined ? 'no type ID' : `type ID ${was.id}`
    const given = now?.id === undefined ? 'no custom object by that name' : `type ID ${now.id}`
    parts.push(`${address} was bound to ${planned}, and the portal has ${given}`)
  }
  return parts.join('; ')
}

// The name overrides a plan's own bindings state, for a caller that passes no config.
function overridesOf(plan: Pick<Plan, 'bindings'>): Record<string, Override> {
  return Object.fromEntries(
    Object.entries(plan.bindings).flatMap(([address, b]) =>
      b.name === undefined ? [] : [[address, { name: b.name }]],
    ),
  )
}

function refused(error: unknown): boolean {
  return error instanceof HubSpotApiError && error.status === 403
}

// Apply reads with the write key, so the key needs the read scope of every list it reads.
function incomplete(plan: Plan, list: string, scope: string | undefined): KalupError {
  const issue: Issue = {
    code: 'E_INCOMPLETE',
    message: `apply could not read ${list} (403), so it cannot check the plan against the portal. Nothing was written.`,
    fix: `${scope ? `add the scope ${scope} to the write key` : 'check the scopes of the write key'}, then run ${bin} plan ${targetFlag(plan.target.name)} again`,
  }
  return new KalupError(issue, exitCodes.error)
}

function scopeFor(req: HttpRequest): string | undefined {
  return readScope(registry[req.type], req.params?.objectType)
}

function kindOf(address: Address): string {
  return parseAddress(address).type
}
