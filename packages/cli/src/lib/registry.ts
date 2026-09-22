// The endpoint registry: one row per resource type, as data. Paths are date-versioned and tagged read or write.
// The group sub-paths, the schema detail path, the limits path and the limitKey names are from the research
// census and are not confirmed against the 2026-09 reference pages yet.

export type Tag = 'read' | 'write'
export type Hub = 'sales' | 'marketing' | 'service' | 'ops'

export interface Endpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  tag: Tag
}

export interface RegistryRow {
  family: string
  version: string
  status: 'ga' | 'beta' | 'legacy'
  expires: string
  identity?: 'natural' | 'bound' | 'lookup'
  auth?: 'account' | 'user'
  delete?: 'archive-restorable' | 'guarded' | 'permanent' | 'none'
  scopes?: { read: readonly string[]; write: readonly string[] }
  tier?: 'any' | Partial<Record<Hub, 'starter' | 'pro' | 'enterprise'>>
  limitKey?: string
  paths: Record<string, Endpoint>
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
    limitKey: 'customProperties',
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
    limitKey: 'customObjects',
    paths: {
      list: { method: 'GET', path: '/crm-object-schemas/2026-09/schemas', tag: 'read' },
      read: { method: 'GET', path: '/crm-object-schemas/2026-09/schemas/{name}', tag: 'read' },
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
    paths: { read: { method: 'GET', path: '/crm/limits/2026-09/{limitKey}', tag: 'read' } },
  },
} as const satisfies Record<string, RegistryRow>

export type Registry = typeof registry
export type RegistryType = keyof Registry

/** Fills every `{placeholder}` in a path template, for example `{objectType}` and `{name}`. */
export function fillPath(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) throw new Error(`Path ${template} needs {${key}}`)
    return encodeURIComponent(value)
  })
}
