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
// The property and group write paths were checked on 2026-09-24 against the 2026-09 reference; behaviour not verified
// live (docs/hubspot.md, the properties and groups sections):
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
// The custom object schema write paths are not checked: no version sends them.

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
  expires: string
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
      update: { method: 'PATCH', path: '/crm-object-schemas/2026-09/schemas/{name}', tag: 'write' },
      delete: { method: 'DELETE', path: '/crm-object-schemas/2026-09/schemas/{name}', tag: 'write' },
    },
  },
  accountInfo: {
    family: 'account-info',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    paths: { read: { method: 'GET', path: '/account-info/2026-09/details', tag: 'read' } },
  },
  limits: {
    family: 'crm.limits',
    version: '2026-09',
    status: 'ga',
    expires: '2028-03',
    paths: {
      customProperties: { method: 'GET', path: '/crm/limits/2026-09/custom-properties', tag: 'read' },
      customObjectTypes: { method: 'GET', path: '/crm/limits/2026-09/custom-object-types', tag: 'read' },
    },
  },
} as const satisfies Record<string, RegistryRow>

export type Registry = typeof registry
export type RegistryType = keyof Registry

/**
 * The version of each planned type's normalizer. A plan records them and apply refuses a plan made under others; a
 * base written under another version counts as absent. Raise one when its normalizer changes what it produces.
 */
export const NORM_VERSIONS = { property: 1, group: 1, object: 1 } as const satisfies Record<string, number>

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
 * The write counterpart of each read exception. Unverified: the scope list of HubSpot's 2026-09 create-property
 * reference names crm.schemas.commercepayments.write, e-commerce and crm.objects.users.write, and none of the others,
 * so they mirror the read exceptions until a live write checks them.
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
 * with crm.schemas scopes only on a developer test account (2026-09-29); whether one crm.objects read scope is enough
 * is not yet confirmed live.
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
