// The endpoint registry: one row per resource type, as data. Paths are date-versioned and tagged read or write.
// The read paths were checked on 2026-09-23 against the 2026-09 reference pages, which HubSpot serves under /latest/:
// - GET /crm/properties/2026-09/{objectType}: no pagination, archived defaults to false, and dataSensitivity defaults
//   to non_sensitive with one value per request, so every property takes three lists. One property by name as well.
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/get-properties
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/sensitive-data
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/get-property
// - GET /crm/properties/2026-09/{objectType}/groups: no pagination and no archived parameter; groups carry archived.
//   The one account tested live (2026-09-29) removed an archived group from the list.
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/property-groups/get-properties
// - GET /crm-object-schemas/2026-09/schemas: no pagination. One schema by {objectType}, an objectTypeId or a
//   fullyQualifiedName.
//   https://developers.hubspot.com/docs/api-reference/latest/crm/objects/schemas/get-schemas
//   https://developers.hubspot.com/docs/api-reference/latest/crm/objects/schemas/get-schema
// - GET /account-info/2026-09/details: portalId, accountType, uiDomain and timeZone; no tier.
//   https://developers.hubspot.com/docs/api-reference/latest/account/account-information/get-account-details
// - GET /crm/limits/2026-09/custom-properties and /custom-object-types: limit and usage, no pagination, no tier.
//   https://developers.hubspot.com/docs/api-reference/latest/crm/limits-tracking/get-custom-properties
//   https://developers.hubspot.com/docs/api-reference/latest/crm/limits-tracking/get-custom-object-types
// The property and group write paths were checked on 2026-09-24 against the 2026-09 reference, and their behaviour on
// one developer test account by live runs 89b45da9 and fb6155db on 2026-09-29 (docs/hubspot.md):
// - POST /crm/properties/2026-09/{objectType} creates a property (201), PATCH and DELETE on .../{objectType}/{name}
//   update (200) and archive (204) one.
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/create-property
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/update-property
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/delete-property
// - POST /crm/properties/2026-09/{objectType}/groups creates a group (201), PATCH and DELETE on .../groups/{name}
//   update (200, label and displayOrder only) and archive (204) one.
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/property-groups/create-property
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/property-groups/update-property
//   https://developers.hubspot.com/docs/api-reference/latest/crm/properties/property-groups/delete-property
// The custom object schema write paths were checked against the 2026-09 schemas reference on 2026-10-05, and their
// behaviour on the developer test account by the live run of 2026-10-05 (docs/hubspot.md): POST creates a schema
// (201), PATCH and DELETE on .../schemas/{objectType} take the objectTypeId; a DELETE archives, and Kalup never purges.
//   https://developers.hubspot.com/docs/api-reference/latest/crm/objects/schemas/guide
// The pipeline and stage paths were checked against the 2026-09 pipelines guide on 2026-10-05, and their behaviour on
// the developer test account by live runs on 2026-10-01 and 2026-10-05 (docs/hubspot.md):
//   https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide

export type Tag = 'read' | 'write'
export type Hub = 'sales' | 'marketing' | 'service' | 'ops'

export interface Endpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  tag: Tag
}

export interface RegistryRow {
  auth?: 'account' | 'user'
  delete?: 'archive-restorable' | 'guarded' | 'permanent' | 'none'
  /** The month the date-versioned pin expires. Absent on a path HubSpot states no sunset for. */
  expires?: string
  family: string
  identity?: 'natural' | 'bound' | 'lookup'
  limitKey?: string
  paths: Record<string, Endpoint>
  scopes?: { read: readonly string[]; write: readonly string[] }
  status: 'ga' | 'beta' | 'legacy'
  tier?: 'any' | Partial<Record<Hub, 'starter' | 'pro' | 'enterprise'>>
  version: string
}

export const registry = {
  property: {
    family: 'crm.properties',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    identity: 'natural',
    auth: 'account',
    delete: 'archive-restorable',
    scopes: { read: ['crm.schemas.{object}.read'], write: ['crm.schemas.{object}.write'] },
    tier: 'any',
    limitKey: 'custom-properties',
    paths: {
      list: { method: 'GET', path: '/crm/properties/2026-09/{objectType}', tag: 'read' },
      read: { method: 'GET', path: '/crm/properties/2026-09/{objectType}/{name}', tag: 'read' },
      create: { method: 'POST', path: '/crm/properties/2026-09/{objectType}', tag: 'write' },
      update: { method: 'PATCH', path: '/crm/properties/2026-09/{objectType}/{name}', tag: 'write' },
      delete: { method: 'DELETE', path: '/crm/properties/2026-09/{objectType}/{name}', tag: 'write' },
    },
  },
  group: {
    family: 'crm.properties',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    identity: 'natural',
    auth: 'account',
    delete: 'archive-restorable',
    scopes: { read: ['crm.schemas.{object}.read'], write: ['crm.schemas.{object}.write'] },
    tier: 'any',
    paths: {
      list: { method: 'GET', path: '/crm/properties/2026-09/{objectType}/groups', tag: 'read' },
      create: { method: 'POST', path: '/crm/properties/2026-09/{objectType}/groups', tag: 'write' },
      update: { method: 'PATCH', path: '/crm/properties/2026-09/{objectType}/groups/{name}', tag: 'write' },
      delete: { method: 'DELETE', path: '/crm/properties/2026-09/{objectType}/groups/{name}', tag: 'write' },
    },
  },
  object: {
    family: 'crm-object-schemas',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    identity: 'natural',
    auth: 'account',
    delete: 'guarded',
    scopes: { read: ['crm.schemas.custom.read'], write: ['crm.schemas.custom.write'] },
    tier: { sales: 'enterprise', marketing: 'enterprise', service: 'enterprise', ops: 'enterprise' },
    limitKey: 'custom-object-types',
    paths: {
      list: { method: 'GET', path: '/crm-object-schemas/2026-09/schemas', tag: 'read' },
      read: { method: 'GET', path: '/crm-object-schemas/2026-09/schemas/{objectType}', tag: 'read' },
      create: { method: 'POST', path: '/crm-object-schemas/2026-09/schemas', tag: 'write' },
      update: { method: 'PATCH', path: '/crm-object-schemas/2026-09/schemas/{objectType}', tag: 'write' },
      delete: { method: 'DELETE', path: '/crm-object-schemas/2026-09/schemas/{objectType}', tag: 'write' },
    },
  },
  // A key holding crm.schemas.<object>.* read and wrote deals, tickets and custom object pipelines, and leads asked for
  // crm.objects.leads.read (live runs, 2026-10-05), so pipelines take the properties' scopes and exceptions. HubSpot's
  // scope list is "one of" these, so the minimum per object is not isolated. Delete is a purge with no restore.
  pipeline: {
    family: 'crm.pipelines',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    identity: 'natural',
    auth: 'account',
    delete: 'permanent',
    scopes: { read: ['crm.schemas.{object}.read'], write: ['crm.schemas.{object}.write'] },
    tier: 'any',
    limitKey: 'pipelines',
    paths: {
      list: { method: 'GET', path: '/crm/pipelines/2026-09/{objectType}', tag: 'read' },
      read: { method: 'GET', path: '/crm/pipelines/2026-09/{objectType}/{pipelineId}', tag: 'read' },
      create: { method: 'POST', path: '/crm/pipelines/2026-09/{objectType}', tag: 'write' },
      update: { method: 'PATCH', path: '/crm/pipelines/2026-09/{objectType}/{pipelineId}', tag: 'write' },
      delete: { method: 'DELETE', path: '/crm/pipelines/2026-09/{objectType}/{pipelineId}', tag: 'write' },
    },
  },
  // A stage is read through its pipeline, whose single read and list carry every stage. Never a stage PUT: PATCH
  // merges metadata as PUT does, and needs no label or displayOrder (live runs, 2026-10-05).
  stage: {
    family: 'crm.pipelines',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    identity: 'natural',
    auth: 'account',
    delete: 'permanent',
    scopes: { read: ['crm.schemas.{object}.read'], write: ['crm.schemas.{object}.write'] },
    tier: 'any',
    paths: {
      create: { method: 'POST', path: '/crm/pipelines/2026-09/{objectType}/{pipelineId}/stages', tag: 'write' },
      update: {
        method: 'PATCH',
        path: '/crm/pipelines/2026-09/{objectType}/{pipelineId}/stages/{stageId}',
        tag: 'write',
      },
      delete: {
        method: 'DELETE',
        path: '/crm/pipelines/2026-09/{objectType}/{pipelineId}/stages/{stageId}',
        tag: 'write',
      },
    },
  },
  // Association labels, the plain association of a custom object pair included, on the 2026-09 labels path (live runs
  // 2026-10-01 and 2026-10-05, docs/hubspot.md). A label is a pair of type IDs, one per direction; the labels list of a
  // direction gives each type's category, ID and label, and the schema read of an object gives each type's internal
  // name, which the labels lists never do. A create answers the new type IDs, a PUT changes both labels of a pair, and
  // a DELETE of either type ID removes the pair: no archive, no restore. A create with `label: ""` makes the plain
  // association alone. The schema associations paths, which make it too, are undocumented in every version, so they
  // stay out. A key holding crm.schemas.<object>.* read and wrote labels; the minimum per object is not isolated.
  //   https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associations-schema/guide
  association: {
    family: 'crm.associations',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    identity: 'natural',
    auth: 'account',
    delete: 'permanent',
    scopes: { read: ['crm.schemas.{object}.read'], write: ['crm.schemas.{object}.write'] },
    tier: 'any',
    limitKey: 'association-labels',
    paths: {
      list: { method: 'GET', path: '/crm/associations/2026-09/{fromObjectType}/{toObjectType}/labels', tag: 'read' },
      names: { method: 'GET', path: '/crm-object-schemas/2026-09/schemas/{objectType}', tag: 'read' },
      create: {
        method: 'POST',
        path: '/crm/associations/2026-09/{fromObjectType}/{toObjectType}/labels',
        tag: 'write',
      },
      update: { method: 'PUT', path: '/crm/associations/2026-09/{fromObjectType}/{toObjectType}/labels', tag: 'write' },
      delete: {
        method: 'DELETE',
        path: '/crm/associations/2026-09/{fromObjectType}/{toObjectType}/labels/{typeId}',
        tag: 'write',
      },
    },
  },
  accountInfo: {
    family: 'account-info',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    paths: { read: { method: 'GET', path: '/account-info/2026-09/details', tag: 'read' } },
  },
  // Token introspection: the scopes a service key holds, with the key in the JSON body as HubSpot requires, to the
  // host the Authorization header already reaches. A read: it changes nothing. Not date-versioned, no stated sunset.
  // Observed 2026-10-01: answers a service key with userId, hubId, appId, scopes (sensitive scopes suffixed .v2) and
  // isUserToken; every service key carries `oauth`.
  //   https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview
  tokenInfo: {
    family: 'oauth.private-apps',
    version: 'v2',
    status: 'ga',
    paths: { read: { method: 'POST', path: '/oauth/v2/private-apps/get/access-token-info', tag: 'read' } },
  },
  limits: {
    family: 'crm.limits',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    paths: {
      customProperties: { method: 'GET', path: '/crm/limits/2026-09/custom-properties', tag: 'read' },
      customObjectTypes: { method: 'GET', path: '/crm/limits/2026-09/custom-object-types', tag: 'read' },
      // Per object, limit and usage of pipelines: deals 100, tickets 100, orders 50, custom objects an overallLimit of
      // 100 on the test account (2026-10-05).
      pipelines: { method: 'GET', path: '/crm/limits/2026-09/pipelines', tag: 'read' },
      // Per object pair and direction, the labels and their count against a limit of 50 (live runs, 2026-10-05). It
      // counts a deleted label for up to 40 s.
      associationLabels: { method: 'GET', path: '/crm/limits/2026-09/associations/labels', tag: 'read' },
    },
  },
} as const satisfies Record<string, RegistryRow>

export type Registry = typeof registry
export type RegistryType = keyof Registry

/**
 * The version of each planned type's normalizer. A plan records them and apply refuses a plan made under others; a
 * base written under another version counts as absent. Raise one when its normalizer changes what it produces.
 */
export const NORM_VERSIONS = {
  property: 1,
  group: 1,
  object: 1,
  pipeline: 1,
  stage: 1,
  association: 1,
} as const satisfies Record<string, number>

/**
 * Standard objects whose properties and groups read under a scope other than `crm.schemas.<object>.read`, checked
 * against HubSpot's scopes reference and the scope lists of the 2026-09 properties and property groups list paths.
 * Commerce payments drop the underscore. Products have no read scope on those lists but the legacy e-commerce, which
 * the scopes reference marks deprecated. Communications and postal mail read under the contacts scope, as their API
 * guides say.
 */
const scopeExceptions: Record<string, string> = {
  commerce_payments: 'crm.schemas.commercepayments.read',
  communications: 'crm.objects.contacts.read',
  feedback_submissions: 'crm.objects.feedback_submissions.read',
  goals: 'crm.objects.goals.read',
  leads: 'crm.objects.leads.read',
  marketing_events: 'crm.objects.marketing_events.read',
  postal_mail: 'crm.objects.contacts.read',
  products: 'e-commerce',
  users: 'crm.objects.users.read',
}

/**
 * The write counterpart of each read exception. The scope list of HubSpot's 2026-09 create-property reference names
 * crm.schemas.commercepayments.write, e-commerce and crm.objects.users.write, and none of the others, so they mirror
 * the read exceptions until a live write checks them. A key with crm.schemas.companies.write alone creates, updates
 * and archives company properties and reads nothing (live runs, 2026-10-01).
 */
const writeScopeExceptions: Record<string, string> = {
  commerce_payments: 'crm.schemas.commercepayments.write',
  communications: 'crm.objects.contacts.write',
  feedback_submissions: 'crm.objects.feedback_submissions.write',
  goals: 'crm.objects.goals.write',
  leads: 'crm.objects.leads.write',
  marketing_events: 'crm.objects.marketing_events.write',
  postal_mail: 'crm.objects.contacts.write',
  products: 'e-commerce',
  users: 'crm.objects.users.write',
}

const standardName = /^[a-z_]+$/

/**
 * The read scope a row needs for `objectType`: the row's template with `{object}` filled, or HubSpot's exception to
 * it. `objectType` is a standard object name; anything else (a custom object's type ID) reads under `custom`. A
 * template with no `{object}` is the scope as is, and a row with no scopes (account info, limits) needs none.
 */
export function readScope(row: RegistryRow & Required<Pick<RegistryRow, 'scopes'>>, objectType?: string): string
export function readScope(row: RegistryRow, objectType?: string): string | undefined
export function readScope(row: RegistryRow, objectType = ''): string | undefined {
  return scopeFor(row.scopes?.read[0], scopeExceptions, objectType)
}

/** The write scope a row needs for `objectType`, as `readScope` finds the read scope. */
export function writeScope(row: RegistryRow & Required<Pick<RegistryRow, 'scopes'>>, objectType?: string): string
export function writeScope(row: RegistryRow, objectType?: string): string | undefined
export function writeScope(row: RegistryRow, objectType = ''): string | undefined {
  return scopeFor(row.scopes?.write[0], writeScopeExceptions, objectType)
}

// The objects whose crm.objects.<object>.read HubSpot's Limits Tracking custom-properties reference names. Others are
// left out: HubSpot publishes no such scope for calls, notes or tasks, and the reference names the legacy `tickets`
// scope for tickets.
const LIMIT_OBJECTS: ReadonlySet<string> = new Set(['companies', 'contacts', 'deals'])

/**
 * The crm.objects read scope Kalup recommends so plan can read the property limit: on the first of `objects` that is
 * companies, contacts or deals, else on companies. HubSpot's Limits Tracking custom-properties answered 403 to a key
 * with crm.schemas scopes only, and 200 once crm.objects.companies.read was added, on a developer test account (runs
 * 89b45da9 and fb6155db, 2026-09-29).
 */
export function limitScope(objects: string[]): string {
  return `crm.objects.${objects.find((o) => LIMIT_OBJECTS.has(o)) ?? 'companies'}.read`
}

function scopeFor(template: string | undefined, exceptions: Record<string, string>, objectType: string) {
  if (!template?.includes('{object}')) {
    return template
  }
  const object = standardName.test(objectType) ? objectType : 'custom'
  // An own key only: an object type such as 'constructor' must not find Object.prototype.
  if (Object.hasOwn(exceptions, object)) {
    return exceptions[object]
  }
  return template.replace('{object}', object)
}

/** Fills every `{placeholder}` in a path template, for example `{objectType}` and `{name}`. */
export function fillPath(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) {
      throw new Error(`Path ${template} needs {${key}}`)
    }
    return encodeURIComponent(value)
  })
}
