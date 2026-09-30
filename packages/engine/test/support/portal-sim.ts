// A stateful HubSpot simulator for tests: a fetch over an in-memory model of one or more portals, routed by the Bearer
// key, for the paths the registry names. It follows docs/hubspot.md where HubSpot documents a
// behaviour, what the live conformance runs observed on a developer test account (runs 89b45da9 and fb6155db,
// 2026-09-29, marked "observed" below), and picks one answer where neither says (each such choice is marked
// "unverified" below).
// Faults are injected by rule. Test-only: src/lib/testing.ts fakeFetch stays the read-only fake of the read command
// tests.
import { isDeepStrictEqual } from 'node:util'
import { STANDARD_OBJECT_TYPE_IDS, STANDARD_OBJECTS } from '../../src/lib/pull/scope.js'

export interface SimOption {
  description?: string
  displayOrder: number
  hidden: boolean
  label: string
  value: string
}

/** A property as the 2026-09 `Property` response documents it, the fields the simulator keeps. */
export interface SimProperty {
  archived: boolean
  archivedAt?: string
  calculated: boolean
  calculationFormula?: string
  createdAt: string
  dataSensitivity: 'non_sensitive' | 'sensitive' | 'highly_sensitive'
  description: string
  displayOrder: number
  externalOptions: boolean
  fieldType: string
  formField: boolean
  groupName: string
  hasUniqueValue: boolean
  hidden: boolean
  hubspotDefined: boolean
  label: string
  modificationMetadata: {
    archivable: boolean
    readOnlyDefinition: boolean
    readOnlyValue: boolean
    readOnlyOptions?: boolean
  }
  name: string
  options: SimOption[]
  type: string
  updatedAt: string
}

export interface SimGroup {
  archived: boolean
  displayOrder: number
  label: string
  name: string
}

export interface SimSchema {
  labels?: { singular?: string; plural?: string }
  name: string
  objectTypeId: string
  primaryDisplayProperty?: string
  requiredProperties?: string[]
  searchableProperties?: string[]
  secondaryDisplayProperties?: string[]
}

export type SimPropertyInput = Partial<SimProperty> & Pick<SimProperty, 'name' | 'type' | 'fieldType' | 'groupName'>
export type SimGroupInput = Partial<SimGroup> & Pick<SimGroup, 'name'>

export interface SimPortalInput {
  accountType?: string
  /**
   * What a property create of an archived property's name does. Observed: `restore`, the default, answers 201 and
   * makes the archived property active again with its old createdAt and the definition the create posted. `refuse`
   * answers as a create of an active name does.
   */
  archivedCreate?: 'restore' | 'refuse'
  /** X-HubSpot-RateLimit-Daily-Remaining before the first request, counting down; null sends no daily headers. */
  dailyRemaining?: number | null
  /**
   * The answer to a property create of an active name, and to a group create of an active group's name. Default,
   * observed for properties: 409 OBJECT_ALREADY_EXISTS, subCategory Properties.PROPERTY_WITH_NAME_EXISTS. For a group
   * the status and body are unverified. A group create of an archived group's name is observed to answer 201.
   */
  existingCreate?: { status: number; body: unknown }
  /** What a delete of a group that still holds active properties does. Observed: reject (400), the default. */
  groupDelete?: 'reject' | 'archive-members' | 'leave'
  /** Variable name to key. The request log names the variable, never the key. */
  keys: Record<string, string>
  /** Limits Tracking bodies. Default: a limit of 1000 custom properties and 10 custom object types. */
  limits?: { customObjectTypes?: unknown; customProperties?: unknown }
  /** By the object type in the path: a standard object's name or a custom object's type ID. */
  objects?: Record<string, { groups?: SimGroupInput[]; properties?: SimPropertyInput[] }>
  portalId: number
  schemas?: SimSchema[]
  /**
   * The scopes a key holds, by variable name; a key not named holds every scope. Observed: Limits Tracking
   * custom-properties answers 403 to a key with no crm.objects scope.
   */
  scopes?: Record<string, string[]>
  timeZone?: string
  uiDomain?: string
}

export interface SimRequest {
  body: unknown
  /** The variable whose key the request carried, or null for a key no portal holds. */
  key: string | null
  method: string
  path: string
  query: Record<string, string>
  /** The status answered, or null when the request timed out or failed. */
  status: number | null
}

export type SimFault =
  | { kind: 'status'; status: number; body?: unknown; headers?: Record<string, string>; apply?: boolean }
  | { kind: 'timeout'; apply?: boolean }
  | { kind: 'throw'; message?: string; apply?: boolean }
  | { kind: 'lag'; reads: number }

export interface SimRule {
  action: SimFault
  method?: string
  /** 1-based: only the nth request the rule matches. Every matching request when absent. */
  occurrence?: number
  /** An exact path or a pattern over the path. */
  path: string | RegExp
}

/** Fault actions. `apply` makes the change first, to model "HubSpot applied it but answered 502". */
export const fault = {
  status: (status: number, body?: unknown, options: { apply?: boolean; headers?: Record<string, string> } = {}) =>
    ({ kind: 'status', status, body, ...options }) as SimFault,
  /** Never settles. An aborted signal rejects it, as fetch does. */
  timeout: (options: { apply?: boolean } = {}) => ({ kind: 'timeout', ...options }) as SimFault,
  /** Rejects as fetch does on a network failure. */
  throw: (options: { apply?: boolean; message?: string } = {}) => ({ kind: 'throw', ...options }) as SimFault,
  /** The next `reads` reads of the resource the write created or changed see the old state, or a 404. */
  lag: (reads: number) => ({ kind: 'lag', reads }) as SimFault,
}

interface ObjectModel {
  groups: Map<string, SimGroup>
  properties: Map<string, SimProperty>
}

export interface SimPortal {
  accountType: string
  archivedCreate: 'restore' | 'refuse'
  dailyRemaining: number | null
  /** Undefined: HubSpot's observed answer, naming the property. */
  existingCreate: { status: number; body: unknown } | undefined
  groupDelete: 'reject' | 'archive-members' | 'leave'
  keys: Record<string, string>
  limits: { customObjectTypes?: unknown; customProperties?: unknown }
  /** The model, by object type. Tests may edit it, to model a change made in the HubSpot UI. */
  objects: Map<string, ObjectModel>
  portalId: number
  schemas: SimSchema[]
  scopes: Record<string, string[]>
  timeZone: string
  uiDomain: string
}

export interface PortalSim {
  fault: (rule: SimRule) => void
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  /** Every request, in order. */
  log: SimRequest[]
  /** One object of one portal, created empty on first use. */
  object: (portalId: number, objectType: string) => ObjectModel
  portal: (portalId: number) => SimPortal
  /** The requests that were not GETs. */
  writes: () => SimRequest[]
}

interface Answer {
  body?: unknown
  headers?: Record<string, string>
  status: number
}

interface Lag {
  before: SimProperty | SimGroup | null
  reads: number
}

interface Call {
  body: unknown
  method: string
  portal: SimPortal
  query: URLSearchParams
  segments: string[]
  signal: AbortSignal | undefined
  /** The variable whose key the request carried. */
  variable: string | null
}

const BEARER = /^Bearer\s+(.+)$/i
const PROPERTIES = '/crm/properties/2026-09/'
const SCHEMAS = '/crm-object-schemas/2026-09/schemas'
const PROPERTY_UPDATES = new Set([
  'label',
  'description',
  'groupName',
  'displayOrder',
  'hidden',
  'formField',
  'options',
  'calculationFormula',
  'currencyPropertyName',
  'numberDisplayHint',
  'textDisplayHint',
  'showCurrencySymbol',
  'type',
  'fieldType',
])
const PROPERTY_CREATES = [
  'name',
  'label',
  'type',
  'fieldType',
  'groupName',
  'description',
  'displayOrder',
  'options',
  'hasUniqueValue',
  'hidden',
  'formField',
  'dataSensitivity',
  'externalOptions',
  'calculationFormula',
] as const
const GROUP_UPDATES = new Set(['label', 'displayOrder'])
// What separates the property names in a calculation formula.
const WORDS = /[^A-Za-z0-9_]+/
const DEFINITION_UPDATES = [...PROPERTY_UPDATES].filter((field) => field !== 'options')

/** A simulator over the given portals. `now` stamps createdAt, updatedAt and archivedAt. */
export function createPortalSim(portals: SimPortalInput[], now: () => Date = () => new Date()): PortalSim {
  const models = new Map(portals.map((input) => [input.portalId, portalOf(input, now)]))
  const log: SimRequest[] = []
  const rules: { rule: SimRule; seen: number }[] = []
  const lags = new Map<string, Lag>()
  let correlation = 0

  function portal(portalId: number): SimPortal {
    const found = models.get(portalId)
    if (!found) {
      throw new Error(`the simulator has no portal ${portalId}`)
    }
    return found
  }

  function error(status: number, category: string, message: string, subCategory?: string): Answer {
    correlation += 1
    const correlationId = `00000000-0000-4000-8000-${String(correlation).padStart(12, '0')}`
    return {
      status,
      body: { status: 'error', message, correlationId, category, ...(subCategory ? { subCategory } : {}) },
    }
  }

  // A create of an active name: the configured answer, else HubSpot's, observed for a property.
  function exists(p: SimPortal, kind: 'property' | 'group', name: string): Answer {
    if (p.existingCreate) {
      return { status: p.existingCreate.status, body: p.existingCreate.body }
    }
    const noun = kind === 'property' ? 'A property' : 'A property group'
    const subCategory = kind === 'property' ? 'Properties.PROPERTY_WITH_NAME_EXISTS' : undefined
    return error(409, 'OBJECT_ALREADY_EXISTS', `${noun} named '${name}' already exists.`, subCategory)
  }

  function respond(answer: Answer, owner: SimPortal | undefined): Response {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...rateHeaders(owner),
      ...answer.headers,
    }
    const text = answer.status === 204 || answer.body === undefined ? null : JSON.stringify(answer.body)
    return new Response(text, { status: answer.status, headers })
  }

  // The rule the request triggers, if any: the first matching rule whose occurrence this is. Every matching rule counts
  // the request.
  function triggered(method: string, path: string): SimFault | undefined {
    const matching = rules.filter(({ rule }) => matches(rule, method, path))
    for (const entry of matching) {
      entry.seen += 1
    }
    return matching.find(({ rule, seen }) => rule.occurrence === undefined || rule.occurrence === seen)?.rule.action
  }

  // Answers one request against the model, applying any change it makes. `lagReads` holds back what it changed.
  function handle(call: Call, lagReads = 0): Answer {
    const [first] = call.segments
    if (call.segments.length === 0) {
      return error(404, 'OBJECT_NOT_FOUND', 'the simulator has no route here')
    }
    if (first === 'account-info') {
      return { status: 200, body: accountInfo(call.portal) }
    }
    if (first === 'limits') {
      return limits(call)
    }
    if (first === 'schemas') {
      return schemas(call)
    }
    return properties(call, lagReads)
  }

  function limits(call: Call): Answer {
    const { portal: p, segments } = call
    const active = [...p.objects.values()].flatMap((o) => [...o.properties.values()])
    const usage = active.filter((prop) => !(prop.archived || prop.hubspotDefined)).length
    const held = call.variable === null ? undefined : p.scopes[call.variable]
    // Observed: a key with crm.schemas scopes only gets 403 here. The body is the simulator's own: the run recorded no
    // body for that 403.
    if (segments[1] === 'custom-properties' && held && !held.some((scope) => scope.startsWith('crm.objects.'))) {
      return error(403, 'MISSING_SCOPES', "This app hasn't been granted all required scopes to make this call.")
    }
    if (segments[1] === 'custom-properties') {
      const body = p.limits.customProperties ?? {
        overallLimit: 1000,
        overallUsage: usage,
        overallPercentage: usage / 10,
        byObjectType: [],
      }
      return { status: 200, body }
    }
    const count = p.schemas.length
    return { status: 200, body: p.limits.customObjectTypes ?? { limit: 10, usage: count, percentage: count * 10 } }
  }

  function schemas(call: Call): Answer {
    const [, objectType] = call.segments
    const all = call.portal.schemas.map((s) => ({ ...s, archived: false }))
    if (objectType === undefined) {
      return { status: 200, body: { results: all } }
    }
    const found = all.find((s) => s.objectTypeId === objectType || s.name === objectType)
    return found ? { status: 200, body: found } : error(404, 'OBJECT_NOT_FOUND', `no object schema ${objectType}`)
  }

  function properties(call: Call, lagReads: number): Answer {
    const { method, portal: p, segments } = call
    const [objectType = '', second, third] = segments
    if (!knows(p, objectType)) {
      return error(404, 'OBJECT_NOT_FOUND', `unknown object type ${objectType}`)
    }
    const model = objectOf(p, objectType)
    if (second === 'groups') {
      return groups(call, model, objectType, third, lagReads)
    }
    if (second === undefined && method === 'GET') {
      return list(call, model, objectType)
    }
    if (second === undefined && method === 'POST') {
      return track(call, objectType, 'property', lagReads, () => create(call, model, objectType))
    }
    if (second !== undefined && method === 'GET') {
      return single(call, model, objectType, second)
    }
    if (second !== undefined && method === 'PATCH') {
      return track(call, objectType, 'property', lagReads, () => update(call, model, second), second)
    }
    if (second !== undefined && method === 'DELETE') {
      return track(call, objectType, 'property', lagReads, () => archive(model, objectType, second), second)
    }
    return error(404, 'OBJECT_NOT_FOUND', 'the simulator has no route here')
  }

  // Runs a write and, under a lag rule, holds the resource's old state back from the next reads.
  function track(
    call: Call,
    objectType: string,
    kind: 'property' | 'group',
    lagReads: number,
    change: () => Answer,
    known?: string,
  ): Answer {
    const name = known ?? String((call.body as { name?: unknown } | undefined)?.name ?? '')
    const model = objectOf(call.portal, objectType)
    const held = kind === 'property' ? model.properties.get(name) : model.groups.get(name)
    const before = held ? structuredClone(held) : null
    const answer = change()
    if (lagReads > 0 && answer.status < 300) {
      lags.set(lagKey(call.portal, objectType, kind, name), { before, reads: lagReads })
    }
    return answer
  }

  // What a read shows of one kind of resource on one object: the model, with lagging resources in their old state.
  // Each lagging resource the read shows counts one read against its lag.
  function visible<T extends SimProperty | SimGroup>(
    p: SimPortal,
    objectType: string,
    kind: 'property' | 'group',
    current: Map<string, T>,
    only?: string,
  ): Map<string, T> {
    const out = new Map(current)
    const prefix = lagKey(p, objectType, kind, '')
    for (const [key, lag] of lags) {
      const name = key.slice(prefix.length)
      if (!key.startsWith(prefix) || (only !== undefined && name !== only)) {
        continue
      }
      if (lag.before === null) {
        out.delete(name)
      } else {
        out.set(name, lag.before as T)
      }
      lag.reads -= 1
      if (lag.reads <= 0) {
        lags.delete(key)
      }
    }
    return out
  }

  function list(call: Call, model: ObjectModel, objectType: string): Answer {
    const archived = call.query.get('archived') === 'true'
    const sensitivity = call.query.get('dataSensitivity') ?? 'non_sensitive'
    const shown = [...visible(call.portal, objectType, 'property', model.properties).values()]
    const results = shown.filter((prop) => prop.archived === archived && prop.dataSensitivity === sensitivity)
    return { status: 200, body: { results: structuredClone(results) } }
  }

  // Unverified: a single read answers 404 for a name it does not hold under the asked sensitivity and archived flag.
  function single(call: Call, model: ObjectModel, objectType: string, name: string): Answer {
    const archived = call.query.get('archived') === 'true'
    const sensitivity = call.query.get('dataSensitivity') ?? 'non_sensitive'
    const prop = visible(call.portal, objectType, 'property', model.properties, name).get(name)
    if (!prop || prop.archived !== archived || prop.dataSensitivity !== sensitivity) {
      return error(404, 'OBJECT_NOT_FOUND', `property ${name} does not exist`)
    }
    return { status: 200, body: structuredClone(prop) }
  }

  function create(call: Call, model: ObjectModel, objectType: string): Answer {
    const input = (call.body ?? {}) as Partial<SimProperty>
    const missing = ['name', 'label', 'type', 'fieldType', 'groupName'].filter(
      (field) => typeof input[field as keyof SimProperty] !== 'string',
    )
    if (missing.length > 0) {
      return error(400, 'VALIDATION_ERROR', `missing required fields: ${missing.join(', ')}`)
    }
    const name = input.name as string
    const held = model.properties.get(name)
    if (held && !(held.archived && call.portal.archivedCreate === 'restore')) {
      return exists(call.portal, 'property', name)
    }
    // PropertyCreate's options: "This field is required for enumerated properties."
    const needsOptions = input.type === 'enumeration' && input.options === undefined
    const invalid =
      checkGroup(model, input.groupName) ??
      (needsOptions ? 'an enumeration property needs options' : checkOptions(input.options))
    if (invalid) {
      return error(400, 'VALIDATION_ERROR', invalid)
    }
    const fields = PROPERTY_CREATES.filter((field) => input[field] !== undefined).map((field) => [field, input[field]])
    const posted = Object.fromEntries(fields) as SimPropertyInput
    // Observed: a create of an archived property's name restores that property with its old createdAt and the posted
    // definition. Unverified: that a field the create leaves out keeps its archived value.
    let created = propertyOf(posted, now)
    if (held) {
      const { archivedAt: _, ...kept } = held
      created = { ...kept, ...structuredClone(posted), archived: false, updatedAt: now().toISOString() }
    }
    model.properties.set(name, created)
    return { status: 201, body: structuredClone(created), headers: { location: `${PROPERTIES}${objectType}/${name}` } }
  }

  function update(call: Call, model: ObjectModel, name: string): Answer {
    const prop = model.properties.get(name)
    if (!prop || prop.archived) {
      return error(404, 'OBJECT_NOT_FOUND', `property ${name} does not exist`)
    }
    const input = (call.body ?? {}) as Record<string, unknown>
    const refused = Object.keys(input).filter((field) => !PROPERTY_UPDATES.has(field))
    if (refused.length > 0) {
      return error(400, 'VALIDATION_ERROR', `fields not in PropertyUpdate: ${refused.join(', ')}`)
    }
    // PropertyUpdate requires no field, so a PATCH that sends the type without options keeps the options it has.
    const invalid = readOnly(prop, input) ?? checkGroup(model, input.groupName) ?? checkOptions(input.options)
    if (invalid) {
      return error(400, 'VALIDATION_ERROR', invalid)
    }
    Object.assign(prop, structuredClone(input), { updatedAt: now().toISOString() })
    return { status: 200, body: structuredClone(prop) }
  }

  function archive(model: ObjectModel, objectType: string, name: string): Answer {
    const prop = model.properties.get(name)
    if (!prop || prop.archived) {
      return error(404, 'OBJECT_NOT_FOUND', `property ${name} does not exist`)
    }
    if (!prop.modificationMetadata.archivable) {
      return error(400, 'VALIDATION_ERROR', `property ${name} cannot be archived`)
    }
    // Observed: HubSpot refuses to archive a property an active calculation property's formula uses.
    const uses = [...model.properties.values()].filter(
      (other) => !other.archived && (other.calculationFormula ?? '').split(WORDS).includes(name),
    ).length
    if (uses > 0) {
      const typeId = Object.hasOwn(STANDARD_OBJECT_TYPE_IDS, objectType)
        ? STANDARD_OBJECT_TYPE_IDS[objectType]
        : objectType
      return error(
        400,
        'VALIDATION_ERROR',
        `Property: ${name} of object type ${typeId} is currently used in ${uses} places and cannot be deleted`,
        'PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE',
      )
    }
    const stamp = now().toISOString()
    Object.assign(prop, { archived: true, archivedAt: stamp, updatedAt: stamp })
    return { status: 204 }
  }

  function groups(
    call: Call,
    model: ObjectModel,
    objectType: string,
    name: string | undefined,
    lagReads: number,
  ): Answer {
    const { method } = call
    if (name === undefined && method === 'GET') {
      // Observed: an archived group is not in the list.
      const shown = [...visible(call.portal, objectType, 'group', model.groups).values()].filter((g) => !g.archived)
      return { status: 200, body: { results: structuredClone(shown) } }
    }
    if (name === undefined && method === 'POST') {
      return track(call, objectType, 'group', lagReads, () => createGroup(call, model, objectType))
    }
    if (name !== undefined && method === 'PATCH') {
      return track(call, objectType, 'group', lagReads, () => updateGroup(call, model, name), name)
    }
    if (name !== undefined && method === 'DELETE') {
      return track(call, objectType, 'group', lagReads, () => deleteGroup(call.portal, model, name), name)
    }
    return error(404, 'OBJECT_NOT_FOUND', 'the simulator has no route here')
  }

  function createGroup(call: Call, model: ObjectModel, objectType: string): Answer {
    const input = (call.body ?? {}) as Partial<SimGroup>
    if (typeof input.name !== 'string' || typeof input.label !== 'string') {
      return error(400, 'VALIDATION_ERROR', 'missing required fields: name, label')
    }
    // Observed: a create of an archived group's name answers 201, and the group reads back with the posted label.
    if (model.groups.get(input.name)?.archived === false) {
      return exists(call.portal, 'group', input.name)
    }
    const created: SimGroup = {
      name: input.name,
      label: input.label,
      displayOrder: input.displayOrder ?? -1,
      archived: false,
    }
    model.groups.set(created.name, created)
    const location = `${PROPERTIES}${objectType}/groups/${created.name}`
    return { status: 201, body: structuredClone(created), headers: { location } }
  }

  function updateGroup(call: Call, model: ObjectModel, name: string): Answer {
    const group = model.groups.get(name)
    if (!group || group.archived) {
      return error(404, 'OBJECT_NOT_FOUND', `group ${name} does not exist`)
    }
    const input = (call.body ?? {}) as Record<string, unknown>
    const refused = Object.keys(input).filter((field) => !GROUP_UPDATES.has(field))
    if (refused.length > 0) {
      return error(400, 'VALIDATION_ERROR', `fields not in PropertyGroupUpdate: ${refused.join(', ')}`)
    }
    Object.assign(group, input)
    return { status: 200, body: structuredClone(group) }
  }

  function deleteGroup(p: SimPortal, model: ObjectModel, name: string): Answer {
    const group = model.groups.get(name)
    if (!group || group.archived) {
      return error(404, 'OBJECT_NOT_FOUND', `group ${name} does not exist`)
    }
    const members = [...model.properties.values()].filter((prop) => prop.groupName === name && !prop.archived)
    if (members.length > 0 && p.groupDelete === 'reject') {
      // Observed: this refusal nests its error body, as JSON text, in the message.
      const { body } = error(
        400,
        'VALIDATION_ERROR',
        "Can't delete or purge a group with active properties",
        'PropertyGroupError.GROUP_WITH_ACTIVE_PROPERTIES',
      ) as { body: { correlationId: string } }
      return {
        status: 400,
        body: { status: 'error', message: JSON.stringify(body), correlationId: body.correlationId },
      }
    }
    const stamp = now().toISOString()
    if (p.groupDelete === 'archive-members') {
      for (const prop of members) {
        Object.assign(prop, { archived: true, archivedAt: stamp, updatedAt: stamp })
      }
    }
    group.archived = true
    return { status: 204 }
  }

  function reply(call: Call, action: SimFault | undefined): Promise<Response> | Response {
    if (action === undefined) {
      return respond(handle(call), call.portal)
    }
    if (action.kind === 'lag') {
      return respond(handle(call, action.reads), call.portal)
    }
    if (action.apply) {
      handle(call)
    }
    if (action.kind === 'status') {
      return respond({ status: action.status, body: action.body, headers: action.headers }, call.portal)
    }
    return action.kind === 'throw'
      ? Promise.reject(new TypeError(action.message ?? 'fetch failed'))
      : never(call.signal)
  }

  async function simFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const key = BEARER.exec(new Headers(init.headers).get('authorization') ?? '')?.[1]
    const owner = [...models.values()].find((p) => key !== undefined && Object.values(p.keys).includes(key))
    const variable = owner ? (Object.entries(owner.keys).find(([, value]) => value === key)?.[0] ?? null) : null
    const entry: SimRequest = {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      key: variable,
      body,
      status: null,
    }
    log.push(entry)
    if (owner && owner.dailyRemaining !== null) {
      owner.dailyRemaining = Math.max(0, owner.dailyRemaining - 1)
    }
    const action = triggered(method, url.pathname)
    if (!owner) {
      entry.status = 401
      return respond(error(401, 'INVALID_AUTHENTICATION', 'Authentication credentials not found.'), undefined)
    }
    const call: Call = {
      body,
      method,
      portal: owner,
      query: url.searchParams,
      segments: segmentsOf(url.pathname),
      signal: init.signal ?? undefined,
      variable,
    }
    const response = await reply(call, action)
    entry.status = response.status
    return response
  }

  return {
    fault: (rule) => {
      rules.push({ rule, seen: 0 })
    },
    fetch: simFetch,
    log,
    object: (portalId, objectType) => objectOf(portal(portalId), objectType),
    portal,
    writes: () => log.filter((entry) => entry.method !== 'GET'),
  }
}

function matches(rule: SimRule, method: string, path: string): boolean {
  const pathMatches = typeof rule.path === 'string' ? rule.path === path : rule.path.test(path)
  return pathMatches && (rule.method === undefined || rule.method.toUpperCase() === method)
}

// A request that never settles, unless its signal aborts it. A signal aborted already rejects at once, as fetch does.
function never(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    const abort = () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError'))
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function portalOf(input: SimPortalInput, now: () => Date): SimPortal {
  const objects = new Map<string, ObjectModel>()
  for (const [objectType, { groups = [], properties = [] }] of Object.entries(input.objects ?? {})) {
    objects.set(objectType, {
      groups: new Map(groups.map((g) => [g.name, { label: g.name, displayOrder: -1, archived: false, ...g }])),
      properties: new Map(properties.map((p) => [p.name, propertyOf(p, now)])),
    })
  }
  return {
    portalId: input.portalId,
    keys: input.keys,
    accountType: input.accountType ?? 'SANDBOX',
    uiDomain: input.uiDomain ?? 'app-eu1.hubspot.com',
    timeZone: input.timeZone ?? 'Europe/Ljubljana',
    objects,
    schemas: input.schemas ?? [],
    limits: input.limits ?? {},
    archivedCreate: input.archivedCreate ?? 'restore',
    existingCreate: input.existingCreate,
    groupDelete: input.groupDelete ?? 'reject',
    scopes: input.scopes ?? {},
    dailyRemaining: input.dailyRemaining === undefined ? 1_000_000 : input.dailyRemaining,
  }
}

/** A full property from partial input, with HubSpot's defaults for a custom property. */
function propertyOf(input: SimPropertyInput, now: () => Date): SimProperty {
  const stamp = now().toISOString()
  return {
    label: input.name,
    description: '',
    options: [],
    displayOrder: -1,
    hasUniqueValue: false,
    hidden: false,
    formField: false,
    calculated: false,
    externalOptions: false,
    hubspotDefined: false,
    dataSensitivity: 'non_sensitive',
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...structuredClone(input),
    modificationMetadata: {
      archivable: true,
      readOnlyDefinition: false,
      readOnlyValue: false,
      ...input.modificationMetadata,
    },
  }
}

function objectOf(p: SimPortal, objectType: string): ObjectModel {
  let model = p.objects.get(objectType)
  if (!model) {
    model = { groups: new Map(), properties: new Map() }
    p.objects.set(objectType, model)
  }
  return model
}

function knows(p: SimPortal, objectType: string): boolean {
  return (
    p.objects.has(objectType) ||
    STANDARD_OBJECTS.has(objectType) ||
    p.schemas.some((s) => s.objectTypeId === objectType)
  )
}

function accountInfo(p: SimPortal): Record<string, unknown> {
  return {
    portalId: p.portalId,
    accountType: p.accountType,
    timeZone: p.timeZone,
    companyCurrency: 'EUR',
    additionalCurrencies: [],
    utcOffset: '+02:00',
    utcOffsetMilliseconds: 7_200_000,
    uiDomain: p.uiDomain,
    dataHostingLocation: 'eu1',
  }
}

function rateHeaders(p: SimPortal | undefined): Record<string, string> {
  const burst = {
    'x-hubspot-ratelimit-max': '190',
    'x-hubspot-ratelimit-remaining': '189',
    'x-hubspot-ratelimit-interval-milliseconds': '10000',
  }
  if (!p || p.dailyRemaining === null) {
    return burst
  }
  return {
    ...burst,
    'x-hubspot-ratelimit-daily': '1000000',
    'x-hubspot-ratelimit-daily-remaining': String(p.dailyRemaining),
  }
}

// The path under each route prefix: ['account-info'], ['limits', <kind>], ['schemas', <objectType>?] or the segments
// after /crm/properties/2026-09/. Empty for a path no route holds.
function segmentsOf(path: string): string[] {
  if (path === '/account-info/2026-09/details') {
    return ['account-info']
  }
  if (path.startsWith('/crm/limits/2026-09/')) {
    return ['limits', path.slice('/crm/limits/2026-09/'.length)]
  }
  if (path === SCHEMAS || path.startsWith(`${SCHEMAS}/`)) {
    return [
      'schemas',
      ...path
        .slice(SCHEMAS.length + 1)
        .split('/')
        .filter(Boolean)
        .map(decodeURIComponent),
    ]
  }
  if (path.startsWith(PROPERTIES)) {
    return path.slice(PROPERTIES.length).split('/').map(decodeURIComponent)
  }
  return []
}

function lagKey(p: SimPortal, objectType: string, kind: string, name: string): string {
  return `${p.portalId}\u0000${objectType}\u0000${kind}\u0000${name}`
}

function checkGroup(model: ObjectModel, groupName: unknown): string | undefined {
  if (groupName === undefined) {
    return undefined
  }
  const group = typeof groupName === 'string' ? model.groups.get(groupName) : undefined
  return group && !group.archived ? undefined : `group ${String(groupName)} does not exist`
}

// OptionInput requires label, value, displayOrder and hidden. Absent options pass.
function checkOptions(options: unknown): string | undefined {
  if (options === undefined) {
    return undefined
  }
  const complete = (o: Record<string, unknown>) =>
    typeof o.label === 'string' &&
    typeof o.value === 'string' &&
    typeof o.displayOrder === 'number' &&
    typeof o.hidden === 'boolean'
  return Array.isArray(options) && (options as Record<string, unknown>[]).every(complete)
    ? undefined
    : 'each option needs label, value, displayOrder and hidden'
}

// Unverified: a read-only definition refuses a change to any field but options, and read-only options refuse a change
// to options. A field sent with the value it already has changes nothing, so it passes.
function readOnly(prop: SimProperty, input: Record<string, unknown>): string | undefined {
  const { readOnlyDefinition, readOnlyOptions } = prop.modificationMetadata
  const changes = (field: string) =>
    field in input && !isDeepStrictEqual(input[field], prop[field as keyof SimProperty])
  if (readOnlyDefinition && DEFINITION_UPDATES.some(changes)) {
    return `property ${prop.name} has a read-only definition`
  }
  if (readOnlyOptions && changes('options')) {
    return `property ${prop.name} has read-only options`
  }
  return undefined
}
