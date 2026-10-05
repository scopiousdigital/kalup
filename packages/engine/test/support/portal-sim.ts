// A stateful HubSpot simulator for tests: a fetch over an in-memory model of one or more portals, routed by the Bearer
// key, for the paths the registry names. It follows docs/hubspot.md where HubSpot documents a
// behaviour, what the live runs observed on the developer test account (runs 89b45da9 and fb6155db on 2026-09-29
// and the sweep of 2026-10-01, marked "observed" below; by the founder's ruling an observation there counts for every
// account type), and picks one answer where neither says (each such choice is marked "unverified" below).
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
  currencyPropertyName?: string
  dataSensitivity: 'non_sensitive' | 'sensitive' | 'highly_sensitive'
  dateDisplayHint?: string
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
  numberDisplayHint?: string
  options: SimOption[]
  referencedObjectType?: string
  showCurrencySymbol?: boolean
  textDisplayHint?: string
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
  allowsSensitiveProperties?: boolean
  /** When HubSpot made it. A schema a test gives without one lists none. */
  createdAt?: string
  description?: string | null
  labels?: { singular?: string; plural?: string }
  name: string
  objectTypeId: string
  primaryDisplayProperty?: string
  requiredProperties?: string[]
  restorable?: boolean
  searchableProperties?: string[]
  secondaryDisplayProperties?: string[]
}

/** A pipeline stage as the 2026-09 pipelines list returns it. Every metadata value is a string. */
export interface SimStage {
  archived: boolean
  createdAt: string
  displayOrder: number
  id: string
  label: string
  metadata: Record<string, string>
  updatedAt: string
  writePermissions: string
}

/** A pipeline as the 2026-09 pipelines list returns it, its stages included. */
export interface SimPipeline {
  archived: boolean
  createdAt: string
  displayOrder: number
  id: string
  label: string
  stages: SimStage[]
  updatedAt: string
}

/**
 * One association definition of a pair, as HubSpot holds it: two type IDs, one per direction, sharing one name. `from`
 * and `to` are the object types the paths take, a standard object's name or a custom object's type ID. A plain
 * association has no label on either side.
 */
export interface SimAssociation {
  category: 'HUBSPOT_DEFINED' | 'USER_DEFINED'
  from: string
  labels: [string | null, string | null]
  name: string
  to: string
  typeIds: [number, number]
}

export type SimAssociationInput = Pick<SimAssociation, 'from' | 'to' | 'name'> &
  Partial<Pick<SimAssociation, 'category' | 'typeIds'>> & { label?: string | null; inverseLabel?: string | null }

export type SimStageInput = Pick<SimStage, 'id' | 'label'> & Partial<Pick<SimStage, 'displayOrder' | 'metadata'>>
export type SimPipelineInput = Pick<SimPipeline, 'id' | 'label'> &
  Partial<Pick<SimPipeline, 'displayOrder'>> & { stages: SimStageInput[] }

export type SimPropertyInput = Partial<SimProperty> & Pick<SimProperty, 'name' | 'type' | 'fieldType' | 'groupName'>
export type SimGroupInput = Partial<SimGroup> & Pick<SimGroup, 'name'>

export interface SimPortalInput {
  accountType?: string
  /**
   * What a property create of an archived property's name does. Observed (2026-09-29 and 2026-10-01): `restore`, the
   * default, answers 201 and makes the archived property active again as a fresh create would make it: the posted
   * definition with the create defaults for every field it leaves out, a different type accepted, only the original
   * createdAt kept. Record values survive. `refuse` answers as a create of an active name does.
   */
  archivedCreate?: 'restore' | 'refuse'
  /** Custom object schemas HubSpot holds archived. */
  archivedSchemas?: SimSchema[]
  /**
   * How many schema reads after a label create leave its name out (observed 2026-10-05: the companies schema showed a new
   * label's name about 5 minutes after the create). Default 0.
   */
  associationNameLag?: number
  /** Association definitions, labelled and plain. Default: none. */
  associations?: SimAssociationInput[]
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
  /**
   * Limits Tracking bodies. Default: a limit of 1000 custom properties, 10 custom object types, and 100 pipelines on
   * deals and tickets and 100 across the custom objects.
   */
  limits?: { associationLabels?: unknown; customObjectTypes?: unknown; customProperties?: unknown; pipelines?: unknown }
  /** By the object type in the path: a standard object's name or a custom object's type ID. */
  objects?: Record<string, { groups?: SimGroupInput[]; properties?: SimPropertyInput[] }>
  /** Pipelines by the object type in the path, in list order. Default: none. */
  pipelines?: Record<string, SimPipelineInput[]>
  portalId: number
  /** Custom object type IDs that hold records: an archive answers 400 EXISTING_OBJECT_RECORDS (observed). */
  recordsIn?: string[]
  schemas?: SimSchema[]
  /**
   * The scopes a key holds, by variable name; a key not named holds every scope. Observed: Limits Tracking
   * custom-properties answers 403 to a key with no crm.objects scope.
   */
  scopes?: Record<string, string[]>
  /** Stage IDs records sit in: a delete of the stage or its pipeline answers 400 STAGE_ID_IN_USE (observed). */
  stagesInUse?: string[]
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
  archivedSchemas: SimSchema[]
  associationNameLag: number
  /** Association definitions. Tests may edit them, to model a change made in the HubSpot UI. */
  associations: SimAssociation[]
  dailyRemaining: number | null
  /** Undefined: HubSpot's observed answer, naming the property. */
  existingCreate: { status: number; body: unknown } | undefined
  groupDelete: 'reject' | 'archive-members' | 'leave'
  /** Per type ID a create made, the schema reads that still leave its name out. */
  hiddenNames: Map<number, number>
  keys: Record<string, string>
  limits: { associationLabels?: unknown; customObjectTypes?: unknown; customProperties?: unknown; pipelines?: unknown }
  /** The model, by object type. Tests may edit it, to model a change made in the HubSpot UI. */
  objects: Map<string, ObjectModel>
  /** Pipelines by object type, in list order. Tests may edit them, to model a change made in the HubSpot UI. */
  pipelines: Map<string, SimPipeline[]>
  portalId: number
  /**
   * Each schema as it was before its last write, by type ID: the copy a PATCH builds on and a single read serves for a
   * while after a write (observed 2026-10-05).
   */
  previousSchemas: Map<string, SimSchema>
  recordsIn: Set<string>
  schemas: SimSchema[]
  scopes: Record<string, string[]>
  stagesInUse: Set<string>
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
const PIPELINES = '/crm/pipelines/2026-09/'
const ASSOCIATIONS = '/crm/associations/2026-09/'
const SCHEMAS = '/crm-object-schemas/2026-09/schemas'
const TOKEN_INFO = '/oauth/v2/private-apps/get/access-token-info'
// The scopes HubSpot's introspection lists with a .v2 suffix (observed 2026-10-01).
const SENSITIVE_SCOPE = /\.(highly_)?sensitive\.(read|write)$/
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
  'referencedObjectType',
  'calculationFormula',
  'numberDisplayHint',
  'showCurrencySymbol',
  'currencyPropertyName',
  'textDisplayHint',
] as const
// Observed: a PATCH that sends one of these answers 200 and changes nothing. dateDisplayHint is ignored on create too.
const IGNORED_UPDATES = new Set(['hasUniqueValue', 'dataSensitivity', 'referencedObjectType', 'dateDisplayHint'])
// Observed: HubSpot refuses a hint outside these lists, the empty string included, and keeps a hint sent as null.
const HINTS: Record<string, readonly string[]> = {
  numberDisplayHint: ['currency', 'duration', 'formatted', 'percentage', 'probability', 'unformatted'],
  textDisplayHint: [
    'domain_name',
    'email',
    'ip_address',
    'multi_line',
    'phone_number',
    'physical_address',
    'postal_code',
    'unformatted_single_line',
  ],
}
const CALCULATION = 'calculation_equation'
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
  // Under a lag rule, a schema PATCH leaves the schema as it was before in the next list reads, by type ID.
  const schemaLags = new Map<string, { before: SimSchema; reads: number }>()
  let correlation = 0
  // The type IDs of the custom objects a create makes: 2-4243001 and on.
  let schemaCount = 4_243_000
  // The type IDs of the association pairs a create makes, two at a time: 9901 and 9902, then on.
  let typeIdCount = 9900

  function nextTypeIds(): [number, number] {
    typeIdCount += 2
    return [typeIdCount - 1, typeIdCount]
  }

  function portal(portalId: number): SimPortal {
    const found = models.get(portalId)
    if (!found) {
      throw new Error(`the simulator has no portal ${portalId}`)
    }
    return found
  }

  // Token introspection (observed 2026-10-01): a POST whose body names the key answers the scopes it holds, every
  // service key carries `oauth`, and sensitive scopes come back with a `.v2` suffix. The simulator cannot list every
  // scope, so a key the portal names no scopes for sees the endpoint as absent (404), and status falls back to its
  // list probes. A body naming another key is a 400.
  function tokenInfo(call: Call): Answer {
    if (call.method !== 'POST') {
      return error(405, 'METHOD_NOT_ALLOWED', 'POST the key as tokenKey')
    }
    const held = call.variable === null ? undefined : call.portal.scopes[call.variable]
    if (held === undefined) {
      return error(404, 'OBJECT_NOT_FOUND', 'the simulator lists no scopes for this key')
    }
    const sent = (call.body as { tokenKey?: unknown } | undefined)?.tokenKey
    if (sent !== call.portal.keys[call.variable as string]) {
      return error(400, 'VALIDATION_ERROR', 'tokenKey is not the key of this request')
    }
    const scopes = held.map((scope) => (SENSITIVE_SCOPE.test(scope) ? `${scope}.v2` : scope))
    return {
      status: 200,
      body: { userId: 1, hubId: call.portal.portalId, appId: 1, scopes: ['oauth', ...scopes], isUserToken: false },
    }
  }

  function error(
    status: number,
    category: string,
    message: string,
    subCategory?: string,
    extra?: { context?: Record<string, string[]>; errors?: unknown[] },
  ): Answer {
    correlation += 1
    const correlationId = `00000000-0000-4000-8000-${String(correlation).padStart(12, '0')}`
    return {
      status,
      body: { status: 'error', message, correlationId, category, ...(subCategory ? { subCategory } : {}), ...extra },
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
    if (first === 'token-info') {
      return tokenInfo(call)
    }
    if (first === 'limits') {
      return limits(call)
    }
    if (first === 'schemas') {
      return schemas(call, lagReads)
    }
    if (first === 'pipelines') {
      return pipelines(call)
    }
    if (first === 'associations') {
      return associations(call)
    }
    return properties(call, lagReads)
  }

  // The 2026-09 association labels paths, as the live runs of 2026-10-01 and 2026-10-05 observed them: a label is a pair
  // of type IDs sharing one name, never read back from the labels lists; a create of a label on a pair with no
  // association also makes the plain one, under a name HubSpot picks; `label: ""` makes the plain association alone; a
  // PUT without inverseLabel puts the label on both sides; a delete of either type ID removes the pair; a plain
  // association goes only once no label of its pair is left; the 51st label of a pair is refused with 437.
  function associations(call: Call): Answer {
    const { method, portal: p, segments } = call
    const [, from = '', to = '', word, typeId] = segments
    if (word !== 'labels') {
      return notFound()
    }
    if (method === 'GET' && typeId === undefined) {
      return { status: 200, body: { results: labelsList(p, from, to) } }
    }
    if (method === 'POST' && typeId === undefined) {
      return createLabel(p, from, to, call.body as Record<string, unknown>)
    }
    if (method === 'PUT' && typeId === undefined) {
      return putLabel(p, call.body as Record<string, unknown>)
    }
    if (method === 'DELETE' && typeId !== undefined) {
      return deleteLabel(p, Number(typeId))
    }
    return error(405, 'METHOD_NOT_ALLOWED', 'the simulator has no such association route')
  }

  // One direction's labels list. Observed: the 2026-09 lists give no object type IDs.
  function labelsList(p: SimPortal, from: string, to: string): Record<string, unknown>[] {
    return p.associations
      .filter((a) => samePair(a, from, to))
      .map((a) => {
        const side = a.from === from && a.to === to ? 0 : 1
        const typeId = a.typeIds[side]
        return { category: a.category, typeId, label: a.labels[side], fromObjectTypeId: null, toObjectTypeId: null }
      })
  }

  function samePair(a: SimAssociation, from: string, to: string): boolean {
    return (a.from === from && a.to === to) || (a.from === to && a.to === from)
  }

  function userPair(p: SimPortal, from: string, to: string): SimAssociation[] {
    return p.associations.filter((a) => samePair(a, from, to) && a.category === 'USER_DEFINED')
  }

  function createLabel(p: SimPortal, from: string, to: string, body: Record<string, unknown>): Answer {
    const { name, label, inverseLabel } = body
    if (typeof label !== 'string' || typeof name !== 'string') {
      return error(400, 'VALIDATION_ERROR', 'Invalid input JSON: Some required fields were not set: [label]')
    }
    if (p.associations.some((a) => a.name === name)) {
      return error(400, 'VALIDATION_ERROR', `Association definition named ${name} already exists for portal`)
    }
    const made =
      label === ''
        ? plainCreate(p, from, to, name)
        : labelCreate(p, { from, to, name, label, inverseLabel: (inverseLabel as string | undefined) ?? label })
    if (!Array.isArray(made)) {
      return made
    }
    for (const id of made.flatMap((a) => a.typeIds)) {
      if (p.associationNameLag > 0) {
        p.hiddenNames.set(id, p.associationNameLag)
      }
    }
    // Observed: the answer lists both type IDs of each pair made, with no object type IDs and no name.
    const results = made.flatMap((a) => [
      { category: a.category, typeId: a.typeIds[0], label: a.labels[0], fromObjectTypeId: null, toObjectTypeId: null },
      { category: a.category, typeId: a.typeIds[1], label: a.labels[1], fromObjectTypeId: null, toObjectTypeId: null },
    ])
    return { status: 200, body: { results } }
  }

  // `label: ""`: the plain association alone, refused when the pair has one.
  function plainCreate(p: SimPortal, from: string, to: string, name: string): SimAssociation[] | Answer {
    if (userPair(p, from, to).some((a) => a.labels[0] === null)) {
      const message = `Association definition label "" already exists on ObjectType pair ${from}-${to}`
      return error(400, 'VALIDATION_ERROR', message, 'AssociationValidationError.DUPLICATE_ASSOCIATION_LABEL')
    }
    return [addAssociation(p, { from, to, name, label: null, inverseLabel: null })]
  }

  // A label: refused at the 51st of a pair (437) and for a text the direction shows already; on a pair with a custom
  // object and no plain association it makes one too, under a name of HubSpot's.
  function labelCreate(p: SimPortal, input: SimAssociationInput & { label: string }): SimAssociation[] | Answer {
    const { from, to } = input
    const pair = userPair(p, from, to)
    const labelled = pair.filter((a) => a.labels[0] !== null)
    if (labelled.length >= 50) {
      return error(437, 'VALIDATION_ERROR', `No more than 50 association types are allowed between ${from} and ${to}`)
    }
    const shown = (a: SimAssociation) => (a.from === from ? a.labels[0] : a.labels[1])
    if (labelled.some((a) => shown(a) === input.label)) {
      return error(
        400,
        'VALIDATION_ERROR',
        `Association definition label ${input.label} already exists on ObjectType pair`,
      )
    }
    const made = [addAssociation(p, input)]
    const custom = from.startsWith('2-') || to.startsWith('2-')
    if (custom && !pair.some((a) => a.labels[0] === null)) {
      made.push(addAssociation(p, { from: to, to: from, name: `${to}_to_${from}`, label: null, inverseLabel: null }))
    }
    return made
  }

  function addAssociation(p: SimPortal, input: SimAssociationInput): SimAssociation {
    const made = associationOf(input, nextTypeIds())
    p.associations.push(made)
    return made
  }

  function putLabel(p: SimPortal, body: Record<string, unknown>): Answer {
    const id = Number(body.associationTypeId)
    const found = p.associations.find((a) => a.typeIds.includes(id))
    if (found === undefined || typeof body.label !== 'string') {
      return error(400, 'VALIDATION_ERROR', `Unable to find association type ${id}`)
    }
    const inverse = typeof body.inverseLabel === 'string' ? body.inverseLabel : body.label
    found.labels = found.typeIds[0] === id ? [body.label, inverse] : [inverse, body.label]
    return { status: 204 }
  }

  function deleteLabel(p: SimPortal, id: number): Answer {
    const found = p.associations.find((a) => a.typeIds.includes(id))
    if (found === undefined) {
      return error(400, 'VALIDATION_ERROR', 'Unable to find objectTypeIds')
    }
    const labelled = p.associations.some(
      (a) => a !== found && samePair(a, found.from, found.to) && a.category === 'USER_DEFINED' && a.labels[0] !== null,
    )
    if (found.labels[0] === null && labelled) {
      const message = `Definition with label still exists; Cannot delete unlabeled type with associationTypeId ${id}`
      return error(400, 'VALIDATION_ERROR', message)
    }
    p.associations = p.associations.filter((a) => a !== found)
    return { status: 204 }
  }

  // The associations an object's schema read lists, both directions, with their names, a name a recent create made
  // left out while its lag lasts.
  function associationDefinitions(p: SimPortal, objectType: string): Record<string, unknown>[] {
    return p.associations
      .filter((a) => a.from === objectType || a.to === objectType)
      .flatMap((a) => [
        { id: String(a.typeIds[0]), fromObjectTypeId: a.from, toObjectTypeId: a.to, name: a.name },
        { id: String(a.typeIds[1]), fromObjectTypeId: a.to, toObjectTypeId: a.from, name: a.name },
      ])
      .flatMap((definition) => {
        const id = Number(definition.id)
        const reads = p.hiddenNames.get(id)
        if (reads === undefined) {
          return [definition]
        }
        if (reads <= 1) {
          p.hiddenNames.delete(id)
        } else {
          p.hiddenNames.set(id, reads - 1)
        }
        const { name: _hidden, ...rest } = definition
        return [rest]
      })
  }

  // The 2026-09 pipelines and stages paths, as the live runs of 2026-10-01 and 2026-10-05 observed them.
  function pipelines(call: Call): Answer {
    const { method, portal: p, segments } = call
    const [, objectType = '', pipelineId, stagesWord] = segments
    const held = pipelinesOf(p, objectType)
    if (pipelineId === undefined) {
      if (method === 'GET') {
        return { status: 200, body: { results: held.map(pipelineBody) } }
      }
      return method === 'POST' ? createPipeline(call, objectType) : notFound()
    }
    const found = held.find((pl) => pl.id === pipelineId)
    return stagesWord === undefined ? onePipeline(call, objectType, found) : stageRoute(call, objectType, found)
  }

  // GET, PATCH or DELETE of one pipeline.
  function onePipeline(call: Call, objectType: string, found: SimPipeline | undefined): Answer {
    const { method, portal: p, segments } = call
    if (method === 'GET') {
      // Observed: a missing pipeline answers 404 with an empty body to an Accept: application/json read.
      return found ? { status: 200, body: pipelineBody(found) } : notFound()
    }
    if (method === 'PATCH') {
      return found ? patchPipeline(call, objectType, found) : notFound()
    }
    if (method === 'DELETE') {
      if (!found) {
        return error(404, 'OBJECT_NOT_FOUND', `No pipeline found with id ${segments[2]}`)
      }
      return inUse(p, found.stages) ?? removePipeline(p, objectType, found)
    }
    return notFound()
  }

  // POST of a stage, or PATCH or DELETE of one.
  function stageRoute(call: Call, objectType: string, found: SimPipeline | undefined): Answer {
    const { method, portal: p, segments } = call
    const [, , , , stageId] = segments
    if (method === 'POST' && stageId === undefined) {
      return found ? createStage(call, objectType, found) : notFound()
    }
    const stage = found?.stages.find((st) => st.id === stageId)
    if (method === 'PATCH') {
      return found && stage ? patchStage(call, objectType, found, stage) : notFound()
    }
    if (method === 'DELETE') {
      // Observed: a stage DELETE answers 204 for anything, a stage that does not exist included.
      return found && stage ? removeStage(p, objectType, found, stage) : { status: 204 }
    }
    return notFound()
  }

  function notFound(): Answer {
    return { status: 404 }
  }

  function createPipeline(call: Call, objectType: string): Answer {
    const { portal: p } = call
    const input = (call.body ?? {}) as {
      pipelineId?: string
      label?: string
      displayOrder?: number
      stages?: unknown[]
    }
    const stages = (input.stages ?? []) as StageBody[]
    if (stages.length === 0) {
      return error(400, 'VALIDATION_ERROR', 'Pipeline must have at least one stage')
    }
    const held = pipelinesOf(p, objectType)
    const id = input.pipelineId ?? String(nextId())
    if (held.some((pl) => pl.id === id)) {
      return error(400, 'VALIDATION_ERROR', `There's another pipeline in this portal with pipelineId (${id}).`)
    }
    // Observed: a pipeline ID another object holds, or a stage ID another pipeline of the object holds, is this 409.
    const elsewhere = [...p.pipelines].some(
      ([type, others]) => type !== objectType && others.some((pl) => pl.id === id),
    )
    const taken = stages.some((st) => held.some((pl) => pl.stages.some((other) => other.id === st.stageId)))
    if (elsewhere || taken) {
      const message = "There's another pipeline in this portal with one of the same stages"
      return error(409, 'OBJECT_ALREADY_EXISTS', message, 'PipelineError.STAGE_ID_EXISTS_IN_ANOTHER_PIPELINE')
    }
    const labelled = sameLabel(held, String(input.label))
    if (labelled) {
      return error(400, 'VALIDATION_ERROR', `An active pipeline with label ${input.label} already exists.`)
    }
    const stamp = now().toISOString()
    const made: SimStage[] = []
    for (const st of stages) {
      const refused = stageRefusal(objectType, st, made)
      if (refused) {
        return refused
      }
      made.push(stageOf(objectType, st, stamp))
    }
    if (!keepsClosed(objectType, made)) {
      return missingClosed(objectType, id)
    }
    const pipeline: SimPipeline = {
      id,
      label: String(input.label),
      displayOrder: input.displayOrder ?? 0,
      stages: renumbered(made),
      archived: false,
      createdAt: stamp,
      updatedAt: stamp,
    }
    held.push(pipeline)
    return { status: 201, body: echo(pipeline, stages) }
  }

  function patchPipeline(call: Call, objectType: string, pipeline: SimPipeline): Answer {
    const input = (call.body ?? {}) as { label?: string; displayOrder?: number }
    if (input.label !== undefined && sameLabel(pipelinesOf(call.portal, objectType), input.label, pipeline)) {
      return error(400, 'VALIDATION_ERROR', `An active pipeline with label ${input.label} already exists.`)
    }
    const stamp = now().toISOString()
    Object.assign(pipeline, {
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
      updatedAt: stamp,
    })
    // Observed: a pipeline PATCH moves every stage's updatedAt.
    for (const st of pipeline.stages) {
      st.updatedAt = stamp
    }
    return { status: 200, body: pipelineBody(pipeline) }
  }

  function createStage(call: Call, objectType: string, pipeline: SimPipeline): Answer {
    const input = (call.body ?? {}) as StageBody
    const others = pipelinesOf(call.portal, objectType).filter((pl) => pl !== pipeline)
    if (input.stageId !== undefined && others.some((pl) => pl.stages.some((st) => st.id === input.stageId))) {
      // Observed: no category on this one.
      return {
        status: 400,
        body: {
          status: 'error',
          message: `An existing active stage in another pipeline is already using stage id ${input.stageId}`,
        },
      }
    }
    const refused = stageRefusal(objectType, input, pipeline.stages)
    if (refused) {
      return refused
    }
    const stage = stageOf(objectType, input, now().toISOString())
    pipeline.stages = placed(pipeline.stages, stage, input.displayOrder ?? 0)
    return { status: 201, body: echoStage(stage, input.metadata) }
  }

  function patchStage(call: Call, objectType: string, pipeline: SimPipeline, stage: SimStage): Answer {
    const input = (call.body ?? {}) as StageBody
    if (input.label !== undefined && sameLabel(pipeline.stages, input.label, stage)) {
      return error(
        400,
        'VALIDATION_ERROR',
        `Stage with label ${input.label} already exists`,
        'PipelineError.STAGE_LABEL_EXISTS',
      )
    }
    const previous = { ...stage.metadata }
    const metadata = stored(objectType, { ...stripDerived(stage.metadata), ...(input.metadata ?? {}) })
    const next = { ...stage, metadata, ...(input.label === undefined ? {} : { label: input.label }) }
    const after = pipeline.stages.map((st) => (st === stage ? next : st))
    if (!keepsClosed(objectType, after)) {
      return missingClosed(objectType, pipeline.id)
    }
    Object.assign(stage, next, { updatedAt: now().toISOString() })
    if (input.displayOrder !== undefined) {
      pipeline.stages = placed(
        pipeline.stages.filter((st) => st !== stage),
        stage,
        input.displayOrder,
      )
    }
    // Observed: the write response echoes what was sent over what was stored, a stale isClosed included.
    return { status: 200, body: { ...structuredClone(stage), metadata: { ...previous, ...(input.metadata ?? {}) } } }
  }

  function removeStage(p: SimPortal, objectType: string, pipeline: SimPipeline, stage: SimStage): Answer {
    const rest = pipeline.stages.filter((st) => st !== stage)
    if (rest.length === 0) {
      return { status: 400, body: { status: 'error', message: 'Pipeline must have at least one stage' } }
    }
    if (!keepsClosed(objectType, rest)) {
      return missingClosed(objectType, pipeline.id)
    }
    const used = inUse(p, [stage])
    if (used) {
      return used
    }
    pipeline.stages = rest
    return { status: 204 }
  }

  function removePipeline(p: SimPortal, objectType: string, pipeline: SimPipeline): Answer {
    p.pipelines.set(
      objectType,
      pipelinesOf(p, objectType).filter((pl) => pl !== pipeline),
    )
    return { status: 204 }
  }

  // Observed: a delete that would drop a stage a record sits in.
  function inUse(p: SimPortal, stages: SimStage[]): Answer | undefined {
    const used = stages.filter((st) => p.stagesInUse.has(st.id)).map((st) => st.id)
    if (used.length === 0) {
      return undefined
    }
    return error(
      400,
      'VALIDATION_ERROR',
      `Stage IDs: [${used.join(', ')}] are being referenced by object IDs: [4242]`,
      'PipelineError.STAGE_ID_IN_USE',
      {
        context: { stageIds: [`[${used.join(', ')}]`], objectIds: ['[4242]'] },
      },
    )
  }

  function missingClosed(objectType: string, id: string): Answer {
    return error(
      400,
      'VALIDATION_ERROR',
      `${objectType} pipeline: ${id} must have at least one closed stage`,
      'PipelineError.MISSING_CLOSED_STAGE',
    )
  }

  // What HubSpot refuses in a stage: a label another stage of the pipeline has, a deal stage without a valid
  // probability, a ticketState or state other than OPEN or CLOSED, a negative displayOrder (all observed).
  function stageRefusal(objectType: string, input: StageBody, siblings: SimStage[]): Answer | undefined {
    if (sameLabel(siblings, String(input.label))) {
      return error(
        400,
        'VALIDATION_ERROR',
        `Stage with label ${input.label} already exists`,
        'PipelineError.STAGE_LABEL_EXISTS',
      )
    }
    if (typeof input.displayOrder === 'number' && input.displayOrder < 0) {
      return { status: 400, body: { status: 'error', message: 'Pipeline display order cannot be negative' } }
    }
    const metadata = input.metadata ?? {}
    if (objectType === 'deals') {
      const probability = Number(metadata.probability)
      if (metadata.probability === undefined) {
        return { status: 400, body: { status: 'error', message: 'must specify probability when writing a dealstage' } }
      }
      if (!(probability >= 0 && probability <= 1)) {
        return {
          status: 400,
          body: {
            status: 'error',
            message: 'dealstage probability is not valid, must be between 0.0 and 1.0 (inclusive)',
          },
        }
      }
    }
    const state = objectType === 'tickets' ? metadata.ticketState : metadata.state
    if (state !== undefined && state !== 'OPEN' && state !== 'CLOSED') {
      return error(
        400,
        'VALIDATION_ERROR',
        `Failed to deserialize metadata for object type ${objectType}`,
        'PipelineError.INVALID_PIPELINE_STAGE_METADATA',
      )
    }
    return undefined
  }

  function stageOf(objectType: string, input: StageBody, stamp: string): SimStage {
    return {
      id: input.stageId ?? String(nextId()),
      label: String(input.label),
      displayOrder: input.displayOrder ?? 0,
      metadata: stored(objectType, input.metadata ?? {}),
      archived: false,
      createdAt: stamp,
      updatedAt: stamp,
      writePermissions: 'CRM_PERMISSIONS_ENFORCEMENT',
    }
  }

  function nextId(): number {
    correlation += 1
    return 6_167_465_000 + correlation
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
    if (segments[1] === 'pipelines') {
      return { status: 200, body: p.limits.pipelines ?? pipelineLimits(p) }
    }
    if (segments[1] === 'associations/labels') {
      return { status: 200, body: p.limits.associationLabels ?? labelLimits(p) }
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

  // Observed (2026-10-05): one entry per direction a label was made in, its object types by type ID, only for the pairs
  // that have a label. A plain association does not count.
  function labelLimits(p: SimPortal): unknown {
    const counts = new Map<string, number>()
    for (const a of p.associations.filter((x) => x.category === 'USER_DEFINED' && x.labels[0] !== null)) {
      const key = `${a.from} ${a.to}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const typeId = (object: string) => STANDARD_OBJECT_TYPE_IDS[object] ?? object
    const results = [...counts].map(([key, usage]) => {
      const [from = '', to = ''] = key.split(' ')
      return {
        limit: 50,
        usage,
        percentage: usage * 2,
        fromObjectType: { objectTypeId: typeId(from) },
        toObjectType: { objectTypeId: typeId(to) },
        allLabels: [],
      }
    })
    return { results }
  }

  // The 2026-09 schemas paths, as the live run of 2026-10-05 observed them.
  function schemas(call: Call, lagReads: number): Answer {
    const { method, portal: p, query, segments } = call
    const [, objectType] = segments
    if (objectType === undefined) {
      return method === 'POST' ? createSchema(call) : schemaList(p, query.get('archived') === 'true')
    }
    const found = p.schemas.find((s) => s.objectTypeId === objectType || s.name === objectType)
    if (method === 'PATCH') {
      return found
        ? lagged(found, lagReads, () => patchSchema(call, found))
        : error(400, 'VALIDATION_ERROR', 'Invalid object or event type id')
    }
    if (method === 'DELETE') {
      return query.get('archived') === 'true' ? purgeSchema(p, objectType) : archiveSchema(p, found)
    }
    return oneSchema(p, objectType, found)
  }

  // A single schema read. Observed (2026-10-05): a standard object's answers too, with its associations and their names,
  // and right after a write a custom object's can serve the schema as it was before it.
  function oneSchema(p: SimPortal, objectType: string, found: SimSchema | undefined): Answer {
    if (found === undefined) {
      return STANDARD_OBJECTS.has(objectType)
        ? { status: 200, body: { name: objectType, associations: associationDefinitions(p, objectType) } }
        : error(404, 'OBJECT_NOT_FOUND', `no object schema ${objectType}`)
    }
    const body = schemaBody(p.previousSchemas.get(found.objectTypeId) ?? found, false)
    return { status: 200, body: { ...body, associations: associationDefinitions(p, found.objectTypeId) } }
  }

  // A schema write that, under a lag rule, leaves the schema as it was in the next `reads` list reads (observed
  // 2026-10-05: the list showed a value from before a PATCH for some seconds).
  function lagged(schema: SimSchema, reads: number, write: () => Answer): Answer {
    const before = structuredClone(schema)
    const answer = write()
    if (reads > 0 && answer.status < 300) {
      schemaLags.set(schema.objectTypeId, { before, reads })
    }
    return answer
  }

  // Observed: archived=true lists every schema, the active ones marked archived: false.
  function schemaList(p: SimPortal, archived: boolean): Answer {
    const gone = archived ? p.archivedSchemas.map((s) => schemaBody(s, true)) : []
    const shown = p.schemas.map((s) => {
      const lag = schemaLags.get(s.objectTypeId)
      if (lag === undefined) {
        return s
      }
      lag.reads -= 1
      if (lag.reads <= 0) {
        schemaLags.delete(s.objectTypeId)
      }
      return lag.before
    })
    return { status: 200, body: { results: [...shown.map((s) => schemaBody(s, false)), ...gone] } }
  }

  // Observed: a create needs a name HubSpot takes and a primary display property it holds. An active schema's exact
  // name answers 201 with that schema, its createdAt the request time while the list keeps its own, another case 409,
  // and an archived schema's name purges the archived one. A new schema gets HubSpot's own properties in the group
  // <name>_information, hs_object_id searchable.
  function createSchema(call: Call): Answer {
    const { portal: p } = call
    const input = (call.body ?? {}) as Partial<SimSchema> & { properties?: { name: string }[] }
    const name = String(input.name ?? '')
    const exact = p.schemas.find((s) => s.name === name)
    if (exact) {
      return { status: 201, body: { ...schemaBody(exact, false), createdAt: now().toISOString() } }
    }
    const refused = schemaRefusal(p, input, name)
    if (refused) {
      return refused
    }
    p.archivedSchemas = p.archivedSchemas.filter((s) => s.name.toLowerCase() !== name.toLowerCase())
    schemaCount += 1
    const schema: SimSchema = {
      name,
      objectTypeId: `2-${schemaCount}`,
      labels: input.labels,
      description: input.description ?? null,
      primaryDisplayProperty: input.primaryDisplayProperty,
      secondaryDisplayProperties: [],
      requiredProperties: [],
      searchableProperties: ['hs_object_id'],
      restorable: true,
      allowsSensitiveProperties: input.allowsSensitiveProperties ?? true,
      createdAt: now().toISOString(),
    }
    p.schemas.push(schema)
    const model = objectOf(p, schema.objectTypeId)
    const group = `${name}_information`
    model.groups.set(group, {
      name: group,
      label: `${input.labels?.singular} Information`,
      displayOrder: 0,
      archived: false,
    })
    for (const prop of SCHEMA_PROPERTIES) {
      const created = { name: prop, type: 'string', fieldType: 'text', groupName: group, hubspotDefined: true }
      model.properties.set(prop, propertyOf(created, now))
    }
    return { status: 201, body: schemaBody(schema, false) }
  }

  // Why HubSpot refuses a create (observed): a name it does not take, no primary display property, another schema's
  // name in another case, a primary it does not hold.
  function schemaRefusal(
    p: SimPortal,
    input: Partial<SimSchema> & { properties?: { name: string }[] },
    name: string,
  ): Answer | undefined {
    if (!SCHEMA_NAME.test(name) || name.length > 50) {
      const message = `invalid object type name ${name}`
      return error(400, 'VALIDATION_ERROR', message, 'InboundDbObjectTypeError.OBJECT_TYPE_NAME_FORMAT')
    }
    if (input.primaryDisplayProperty === undefined) {
      const message = 'A primary display property is required'
      return error(400, 'VALIDATION_ERROR', message, 'ObjectSchemaError.PRIMARY_DISPLAY_PROPERTY_REQUIRED')
    }
    if (p.schemas.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      const message = `${name} already exists`
      return error(409, 'OBJECT_ALREADY_EXISTS', message, 'InboundDbObjectTypeError.OBJECT_TYPE_ALREADY_EXIST')
    }
    const own = [...SCHEMA_PROPERTIES, ...(input.properties ?? []).map((prop) => prop.name)]
    if (!own.includes(input.primaryDisplayProperty)) {
      const message = `Invalid primary display property ${input.primaryDisplayProperty}`
      const code = 'ObjectSchemasSandboxesSyncErrorType.INVALID_PRIMARY_DISPLAY_PROPERTY'
      return error(400, 'VALIDATION_ERROR', message, code)
    }
    return undefined
  }

  // Observed: a PATCH builds its result from a copy of the schema that can be minutes old, so a field the body leaves
  // out comes back as that copy held it; the simulator's copy is the schema before its last write. Display, required
  // and searchable fields must name properties HubSpot holds; sensitive properties never turn off; the name is ignored.
  function patchSchema(call: Call, schema: SimSchema): Answer {
    const { portal: p } = call
    const input = (call.body ?? {}) as Partial<SimSchema> & { clearDescription?: boolean }
    const active = [...objectOf(p, schema.objectTypeId).properties.values()].filter((prop) => !prop.archived)
    const holds = (name: string) => active.some((prop) => prop.name === name)
    for (const [field, code] of SCHEMA_REFERENCES) {
      const named = [input[field as keyof SimSchema] ?? []].flat() as string[]
      if (named.some((name) => !holds(name))) {
        return error(400, 'VALIDATION_ERROR', `Invalid ${field}: ${named.join(', ')}`, code)
      }
    }
    if (input.allowsSensitiveProperties === false && schema.allowsSensitiveProperties !== false) {
      const message = 'Sensitive properties support cannot be turned off'
      return error(
        400,
        'VALIDATION_ERROR',
        message,
        'InboundDbObjectTypeError.SENSITIVE_PROPERTIES_SUPPORT_CANNOT_BE_TURNED_OFF',
      )
    }
    const copy = p.previousSchemas.get(schema.objectTypeId) ?? schema
    const next: SimSchema = { ...schema }
    for (const field of SCHEMA_FIELDS) {
      Object.assign(next, { [field]: Object.hasOwn(input, field) ? input[field] : copy[field] })
    }
    next.labels = { ...copy.labels, ...input.labels }
    if (input.clearDescription === true) {
      next.description = null
    }
    p.previousSchemas.set(schema.objectTypeId, { ...schema })
    Object.assign(schema, next)
    return { status: 200, body: schemaBody(schema, false) }
  }

  // Observed: a DELETE archives a schema that holds no record; active properties do not stop it.
  function archiveSchema(p: SimPortal, schema: SimSchema | undefined): Answer {
    if (schema === undefined) {
      return error(400, 'VALIDATION_ERROR', 'Invalid object or event type id')
    }
    if (p.recordsIn.has(schema.objectTypeId)) {
      const message = `Object type ${schema.objectTypeId} cannot be deleted until all object records are deleted`
      return error(400, 'VALIDATION_ERROR', message, 'ObjectSchemaError.EXISTING_OBJECT_RECORDS')
    }
    p.schemas = p.schemas.filter((s) => s !== schema)
    p.archivedSchemas.push(schema)
    return { status: 204 }
  }

  // Observed: archived=true purges an archived schema and is a 400 on an active one. Kalup never sends it.
  function purgeSchema(p: SimPortal, objectType: string): Answer {
    const archived = p.archivedSchemas.find((s) => s.objectTypeId === objectType)
    if (archived === undefined) {
      return error(400, 'VALIDATION_ERROR', "Couldn't find soft-deleted object type(s)")
    }
    p.archivedSchemas = p.archivedSchemas.filter((s) => s !== archived)
    return { status: 204 }
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

  // Observed (2026-10-01): a single read answers 404 for a name it does not hold under the asked sensitivity and
  // archived flag, so a 404 never means gone.
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
    if (!mayCreateSensitive(call, objectType, input.dataSensitivity)) {
      return error(403, 'MISSING_SCOPES', 'Missing required scope for: sensitive-data-property-create')
    }
    // PropertyCreate's options: "This field is required for enumerated properties." An owner property takes none.
    const external = input.externalOptions === true
    const needsOptions = input.type === 'enumeration' && input.options === undefined && !external
    const invalid =
      checkGroup(model, input.groupName) ??
      (needsOptions ? 'an enumeration property needs options' : checkOptions(input.options)) ??
      checkCreated(input)
    if (invalid) {
      return error(400, 'VALIDATION_ERROR', invalid)
    }
    const fields = PROPERTY_CREATES.filter((field) => input[field] !== undefined).map((field) => [field, input[field]])
    const posted = calculation(Object.fromEntries(fields) as SimPropertyInput)
    // Observed (2026-10-01): a create of an archived property's name restores that property as a fresh create would
    // make it, the create defaults for every field the body leaves out (formField seen), a different type accepted,
    // and only the original createdAt kept.
    const created = held ? { ...propertyOf(posted, now), createdAt: held.createdAt } : propertyOf(posted, now)
    model.properties.set(name, created)
    return { status: 201, body: structuredClone(created), headers: { location: `${PROPERTIES}${objectType}/${name}` } }
  }

  function update(call: Call, model: ObjectModel, name: string): Answer {
    const prop = model.properties.get(name)
    if (!prop || prop.archived) {
      return error(404, 'OBJECT_NOT_FOUND', `property ${name} does not exist`)
    }
    const sent = (call.body ?? {}) as Record<string, unknown>
    const refused = Object.keys(sent).filter((field) => !(PROPERTY_UPDATES.has(field) || IGNORED_UPDATES.has(field)))
    if (refused.length > 0) {
      return error(400, 'VALIDATION_ERROR', `fields not in PropertyUpdate: ${refused.join(', ')}`)
    }
    const input = Object.fromEntries(
      Object.entries(sent).filter(([field, value]) => PROPERTY_UPDATES.has(field) && value !== null),
    )
    // PropertyUpdate requires no field, so a PATCH that sends the type without options keeps the options it has.
    const invalid =
      readOnly(prop, input) ??
      checkGroup(model, input.groupName) ??
      checkOptions(input.options) ??
      checkHints(input) ??
      checkCurrency({ ...prop, ...input } as SimPropertyInput)
    if (invalid) {
      return error(400, 'VALIDATION_ERROR', invalid)
    }
    Object.assign(prop, calculation(structuredClone(input) as SimPropertyInput), { updatedAt: now().toISOString() })
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
    // Observed: HubSpot refuses to archive a property an active calculation property's formula uses, and (2026-10-01)
    // one a workflow, list or form uses, with one `errors` entry per use naming its kind and parent.
    const users = [...model.properties.values()].filter(
      (other) => !other.archived && (other.calculationFormula ?? '').split(WORDS).includes(name),
    )
    if (users.length > 0) {
      const typeId = Object.hasOwn(STANDARD_OBJECT_TYPE_IDS, objectType)
        ? STANDARD_OBJECT_TYPE_IDS[objectType]
        : objectType
      return error(
        400,
        'VALIDATION_ERROR',
        `Property: ${name} of object type ${typeId} is currently used in ${users.length} places and cannot be deleted`,
        'PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE',
        {
          context: { usageCount: [String(users.length)] },
          errors: users.map((user) => ({
            subCategory: 'PropertyValidationError.PROPERTY_USAGE',
            context: { parentType: ['CALCULATED_PROPERTY'], parentName: [`${typeId}/${user.name}`] },
          })),
        },
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
      // The token-info body carries the key: the log keeps the variable in its place, as `key` does.
      body: url.pathname === TOKEN_INFO && body !== undefined ? { tokenKey: variable } : body,
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
    // Token introspection is a POST that changes nothing, so it is no write.
    writes: () => log.filter((entry) => entry.method !== 'GET' && entry.path !== TOKEN_INFO),
  }
}

/** A stage as a create or PATCH sends it. */
interface StageBody {
  displayOrder?: number
  label?: string
  metadata?: Record<string, string>
  stageId?: string
}

function pipelinesOf(p: SimPortal, objectType: string): SimPipeline[] {
  let list = p.pipelines.get(objectType)
  if (!list) {
    list = []
    p.pipelines.set(objectType, list)
  }
  return list
}

// What a read shows: the pipeline with its stages in display order.
function pipelineBody(pipeline: SimPipeline): SimPipeline {
  const copy = structuredClone(pipeline)
  copy.stages.sort((a, b) => a.displayOrder - b.displayOrder)
  return copy
}

// Observed: a create's response echoes each stage's metadata as sent, without the isClosed a read adds.
function echo(pipeline: SimPipeline, sent: StageBody[]): SimPipeline {
  const copy = pipelineBody(pipeline)
  copy.stages = copy.stages.map((st, i) => ({ ...st, metadata: sent[i]?.metadata ?? {} }))
  return copy
}

function echoStage(stage: SimStage, sent: Record<string, string> | undefined): SimStage {
  return { ...structuredClone(stage), metadata: sent ?? {} }
}

// Observed: labels are unique within a pipeline (stages, ignoring case and spaces around them) or an object
// (pipelines, ignoring case).
function sameLabel(items: { label: string }[], label: string, self?: { label: string }): boolean {
  const norm = (text: string) => text.trim().toLowerCase()
  return items.some((item) => item !== self && norm(item.label) === norm(label))
}

// The metadata HubSpot keeps for a stage: the object's one field, a deal's probability in its printed form, and the
// isClosed it derives (observed 2026-10-05). Unknown keys are dropped; a ticket or custom stage defaults to OPEN.
function stored(objectType: string, metadata: Record<string, string>): Record<string, string> {
  if (objectType === 'deals') {
    const probability = Number(metadata.probability)
    const printed = Number.isInteger(probability) ? probability.toFixed(1) : String(probability)
    return { isClosed: String(probability === 0 || probability === 1), probability: printed }
  }
  const field = objectType === 'tickets' ? 'ticketState' : 'state'
  const state = metadata[field] === 'CLOSED' ? 'CLOSED' : 'OPEN'
  if (objectType !== 'tickets' && !objectType.startsWith('2-')) {
    return { isClosed: 'false' }
  }
  return { [field]: state, isClosed: String(state === 'CLOSED') }
}

function stripDerived(metadata: Record<string, string>): Record<string, string> {
  const { isClosed: _, ...rest } = metadata
  return rest
}

// Observed: a ticket pipeline keeps at least one CLOSED stage; other objects need none.
function keepsClosed(objectType: string, stages: SimStage[]): boolean {
  return objectType !== 'tickets' || stages.some((st) => st.metadata.ticketState === 'CLOSED')
}

// Observed: HubSpot never stores two stages at one displayOrder. A stage written to a free slot takes it; one written
// to a taken slot goes right after the stage that held it, and the pipeline is renumbered 0..n-1.
function placed(stages: SimStage[], stage: SimStage, displayOrder: number): SimStage[] {
  const ordered = [...stages].sort((a, b) => a.displayOrder - b.displayOrder)
  const holder = ordered.findIndex((st) => st.displayOrder === displayOrder)
  if (holder === -1) {
    stage.displayOrder = displayOrder
    return [...ordered, stage]
  }
  ordered.splice(holder + 1, 0, stage)
  return ordered.map((st, i) => Object.assign(st, { displayOrder: i }))
}

// Stages of one request that share a number are renumbered 0..n-1, the later in the request first (observed: the tie
// went against request order); distinct numbers are kept as sent, gaps included.
function renumbered(stages: SimStage[]): SimStage[] {
  const ordered = stages
    .map((st, i) => ({ st, i }))
    .sort((a, b) => a.st.displayOrder - b.st.displayOrder || b.i - a.i)
    .map(({ st }) => st)
  const tied = new Set(stages.map((st) => st.displayOrder)).size < stages.length
  return tied ? ordered.map((st, displayOrder) => Object.assign(st, { displayOrder })) : ordered
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
    pipelines: new Map(
      Object.entries(input.pipelines ?? {}).map(([type, list]) => [
        type,
        list.map((pl, i) => pipelineOf(type, pl, i, now)),
      ]),
    ),
    stagesInUse: new Set(input.stagesInUse ?? []),
    schemas: input.schemas ?? [],
    archivedSchemas: input.archivedSchemas ?? [],
    associations: (input.associations ?? []).map((a, i) => associationOf(a, [9001 + 2 * i, 9002 + 2 * i])),
    associationNameLag: input.associationNameLag ?? 0,
    hiddenNames: new Map(),
    previousSchemas: new Map(),
    recordsIn: new Set(input.recordsIn ?? []),
    limits: input.limits ?? {},
    archivedCreate: input.archivedCreate ?? 'restore',
    existingCreate: input.existingCreate,
    groupDelete: input.groupDelete ?? 'reject',
    scopes: input.scopes ?? {},
    dailyRemaining: input.dailyRemaining === undefined ? 1_000_000 : input.dailyRemaining,
  }
}

/** An association from its input: USER_DEFINED unless stated, its label on both sides unless an inverse is given. */
function associationOf(input: SimAssociationInput, typeIds: [number, number]): SimAssociation {
  const label = input.label ?? null
  return {
    from: input.from,
    to: input.to,
    name: input.name,
    category: input.category ?? 'USER_DEFINED',
    typeIds: input.typeIds ?? typeIds,
    labels: [label, input.inverseLabel === undefined ? label : input.inverseLabel],
  }
}

// The properties HubSpot gives every custom object it creates (observed 2026-10-05), the few the tests name.
const SCHEMA_PROPERTIES = ['hs_object_id', 'hs_createdate', 'hs_lastmodifieddate', 'hubspot_owner_id']

// The custom object names HubSpot takes (observed 2026-10-05), at most 50 characters.
const SCHEMA_NAME = /^[A-Za-z][A-Za-z0-9_]*$/

// The fields a schema PATCH writes (observed 2026-10-05).
const SCHEMA_FIELDS = [
  'labels',
  'description',
  'primaryDisplayProperty',
  'secondaryDisplayProperties',
  'requiredProperties',
  'searchableProperties',
  'restorable',
] as const

// The fields that name properties, each with the subCategory HubSpot refuses a name it does not hold with (observed).
const SCHEMA_REFERENCES: [string, string][] = [
  ['primaryDisplayProperty', 'ObjectSchemasSandboxesSyncErrorType.INVALID_PRIMARY_DISPLAY_PROPERTY'],
  ['secondaryDisplayProperties', 'ObjectSchemasSandboxesSyncErrorType.INVALID_SECONDARY_DISPLAY_PROPERTY'],
  ['requiredProperties', 'InvalidPropertiesError.INVALID_REQUIRED_PROPERTIES'],
  ['searchableProperties', 'ObjectSchemasSandboxesSyncErrorType.INVALID_SEARCHABLE_PROPERTIES'],
]

// A schema as the schemas paths return it, with HubSpot's defaults for the fields a test leaves out.
function schemaBody(s: SimSchema, archived: boolean): Record<string, unknown> {
  return {
    description: null,
    restorable: true,
    allowsSensitiveProperties: true,
    requiredProperties: [],
    searchableProperties: [],
    secondaryDisplayProperties: [],
    ...structuredClone(s),
    archived,
    id: s.objectTypeId.slice(2),
  }
}

/** A full pipeline from partial input, its stages at their index unless they state a displayOrder. */
function pipelineOf(objectType: string, input: SimPipelineInput, index: number, now: () => Date): SimPipeline {
  const stamp = now().toISOString()
  return {
    id: input.id,
    label: input.label,
    displayOrder: input.displayOrder ?? index,
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    stages: input.stages.map((st, i) => ({
      id: st.id,
      label: st.label,
      displayOrder: st.displayOrder ?? i,
      metadata: stored(objectType, st.metadata ?? {}),
      archived: false,
      createdAt: stamp,
      updatedAt: stamp,
      writePermissions: 'CRM_PERMISSIONS_ENFORCEMENT',
    })),
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

// Observed shape (2026-10-05): usage counts the pipelines beyond the default one.
function pipelineLimits(p: SimPortal): unknown {
  const usage = (type: string) => Math.max(0, (p.pipelines.get(type) ?? []).length - 1)
  const custom = [...p.pipelines].filter(([type]) => type.startsWith('2-')).reduce((n, [, list]) => n + list.length, 0)
  return {
    hubspotDefinedObjectTypes: [
      { objectTypeId: '0-3', limit: 100, usage: usage('deals') },
      { objectTypeId: '0-5', limit: 100, usage: usage('tickets') },
    ],
    customObjectTypes: { overallLimit: 100, overallUsage: custom, byObjectType: [] },
  }
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

// The path under each route prefix: ['account-info'], ['limits', <kind>], ['schemas', <objectType>?], ['pipelines',
// <objectType>, ...] or the segments after /crm/properties/2026-09/. Empty for a path no route holds.
function segmentsOf(path: string): string[] {
  if (path === '/account-info/2026-09/details') {
    return ['account-info']
  }
  if (path === TOKEN_INFO) {
    return ['token-info']
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
  if (path.startsWith(PIPELINES)) {
    return ['pipelines', ...path.slice(PIPELINES.length).split('/').map(decodeURIComponent)]
  }
  if (path.startsWith(ASSOCIATIONS)) {
    return ['associations', ...path.slice(ASSOCIATIONS.length).split('/').map(decodeURIComponent)]
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

// A read-only definition refuses a change to any field but options, and read-only options refuse a change to options
// (a fact by the founder's ruling of 2026-10-01; HubSpot's own properties are the only read-only definitions, and the
// live runs never write those). A field sent with the value it already has changes nothing, so it passes.
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

// What HubSpot refuses in a create beyond the required fields and the options (observed): a boolean without exactly the
// options true and false, external options with options or without a reference type, a hint outside its list, and a
// currency property name without the currency symbol.
function checkCreated(input: Partial<SimProperty>): string | undefined {
  const values = (input.options ?? []).map((o) => o.value).sort()
  if (input.type === 'bool' && input.fieldType === 'booleancheckbox' && values.join() !== 'false,true') {
    return 'Boolean properties must have exactly two options; one with a value of true, the other with a value of false'
  }
  if (input.externalOptions === true && (input.options ?? []).length > 0) {
    return 'a property with external options may not include options'
  }
  if (input.externalOptions === true && input.referencedObjectType === undefined) {
    return 'properties with externalOptions need a referencedObjectType'
  }
  return checkHints(input as Record<string, unknown>) ?? checkCurrency(input)
}

function checkHints(input: Record<string, unknown>): string | undefined {
  const bad = Object.entries(HINTS).find(
    ([field, allowed]) => input[field] !== undefined && !allowed.includes(input[field] as string),
  )
  return bad ? `invalid value for ${bad[0]}: ${String(input[bad[0]])}` : undefined
}

// Observed: ONLY_CURRENCY_PROPERTIES_CAN_SPECIFY_CURRENCY, also when a PATCH turns the symbol off while a name is set.
function checkCurrency(p: Partial<SimProperty>): string | undefined {
  return p.currencyPropertyName !== undefined && p.showCurrencySymbol !== true
    ? `cannot have a currency property name set to '${p.currencyPropertyName}'`
    : undefined
}

// Observed: a formula makes the property a calculation, HubSpot marks it calculated, and it stores the formula with
// runs of whitespace as one space. It also respaces operators, which the simulator does not.
function calculation<T extends Partial<SimProperty>>(input: T): T {
  if (typeof input.calculationFormula !== 'string') {
    return input
  }
  return {
    ...input,
    fieldType: CALCULATION,
    calculated: true,
    calculationFormula: input.calculationFormula.replace(/\s+/g, ' ').trim(),
  }
}

// Observed: a sensitive create needs the object's sensitive write scope. A key the portal names no scopes for holds all.
function mayCreateSensitive(call: Call, objectType: string, sensitivity = 'non_sensitive'): boolean {
  const scopes = call.variable === null ? undefined : call.portal.scopes[call.variable]
  return sensitivity === 'non_sensitive' || !scopes || scopes.includes(`crm.objects.${objectType}.${sensitivity}.write`)
}
