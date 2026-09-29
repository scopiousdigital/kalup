import { expect, test } from 'vitest'
import { STANDARD_OBJECTS } from '../../src/lib/pull/scope.js'
import { fillPath, limitScope, readScope, registry, writeScope } from '../../src/lib/registry.js'

const method = /^(GET|POST|PATCH|PUT|DELETE)$/
const yearMonth = /^\d{4}-\d{2}$/
const readSuffix = /\.read$/

// The read scope per standard object, each on the scope list of HubSpot's 2026-09 properties and property groups list
// references (GET /crm/properties/2026-09/{objectType} and .../groups), sensitive-data variants left out. The
// crm.schemas one wherever those lists have it. communications and postal_mail have none; their API guides name
// crm.objects.contacts.read. line_items has crm.schemas.line_items.read on both lists and on the scopes reference.
const readScopes: Record<string, string> = {
  appointments: 'crm.schemas.appointments.read',
  calls: 'crm.schemas.calls.read',
  carts: 'crm.schemas.carts.read',
  commerce_payments: 'crm.schemas.commercepayments.read',
  communications: 'crm.objects.contacts.read',
  companies: 'crm.schemas.companies.read',
  contacts: 'crm.schemas.contacts.read',
  courses: 'crm.schemas.courses.read',
  deals: 'crm.schemas.deals.read',
  emails: 'crm.schemas.emails.read',
  feedback_submissions: 'crm.objects.feedback_submissions.read',
  goals: 'crm.objects.goals.read',
  invoices: 'crm.schemas.invoices.read',
  leads: 'crm.objects.leads.read',
  line_items: 'crm.schemas.line_items.read',
  listings: 'crm.schemas.listings.read',
  marketing_events: 'crm.objects.marketing_events.read',
  meetings: 'crm.schemas.meetings.read',
  notes: 'crm.schemas.notes.read',
  orders: 'crm.schemas.orders.read',
  postal_mail: 'crm.objects.contacts.read',
  products: 'e-commerce',
  projects: 'crm.schemas.projects.read',
  quotes: 'crm.schemas.quotes.read',
  services: 'crm.schemas.services.read',
  subscriptions: 'crm.schemas.subscriptions.read',
  tasks: 'crm.schemas.tasks.read',
  tickets: 'crm.schemas.tickets.read',
  users: 'crm.objects.users.read',
}

test('every path in the registry carries a read or write tag and a method', () => {
  for (const row of Object.values(registry)) {
    expect(Object.keys(row.paths).length).toBeGreaterThan(0)
    for (const endpoint of Object.values(row.paths)) {
      expect(['read', 'write']).toContain(endpoint.tag)
      expect(endpoint.method).toMatch(method)
      expect(endpoint.path).toContain(row.version)
    }
  }
})

test('every row is pinned to a date version and carries an expiry', () => {
  for (const row of Object.values(registry)) {
    expect(row.version).toMatch(yearMonth)
    expect(row.expires).toMatch(yearMonth)
  }
})

test('the milestone 1 rows exist and the resource rows carry scopes', () => {
  expect(Object.keys(registry).sort()).toEqual(['accountInfo', 'group', 'limits', 'object', 'property'])
  expect(registry.property.scopes.read).toEqual(['crm.schemas.{object}.read'])
  expect(registry.object.scopes.read).toEqual(['crm.schemas.custom.read'])
})

test.each([...STANDARD_OBJECTS])('%s properties and groups read under the scope HubSpot lists', (object) => {
  expect(readScope(registry.property, object)).toBe(readScopes[object])
  expect(readScope(registry.group, object)).toBe(readScopes[object])
})

test('the scope table covers every standard object and nothing else', () => {
  expect(Object.keys(readScopes).sort()).toEqual([...STANDARD_OBJECTS].sort())
})

test('a custom object type ID reads under crm.schemas.custom.read, and a row with no scopes needs none', () => {
  expect(readScope(registry.property, '2-4242001')).toBe('crm.schemas.custom.read')
  expect(readScope(registry.group, '2-4242001')).toBe('crm.schemas.custom.read')
  expect(readScope(registry.object)).toBe('crm.schemas.custom.read')
  expect(readScope(registry.accountInfo)).toBeUndefined()
  // The exceptions are for a template that names the object: a fixed scope, or none, stays as it is.
  expect(readScope(registry.object, 'products')).toBe('crm.schemas.custom.read')
  expect(readScope(registry.accountInfo, 'products')).toBeUndefined()
})

test.each([
  ['constructor', 'crm.schemas.constructor.read'],
  ['__proto__', 'crm.schemas.__proto__.read'],
  ['toString', 'crm.schemas.custom.read'],
])('an object type named like an Object.prototype key (%s) reads under %s, not an inherited value', (type, scope) => {
  expect(readScope(registry.property, type)).toBe(scope)
})

test('fillPath fills objectType and name and refuses a missing placeholder', () => {
  expect(fillPath(registry.property.paths.read.path, { objectType: 'companies', name: 'billing_status' })).toBe(
    '/crm/properties/2026-09/companies/billing_status',
  )
  expect(fillPath(registry.object.paths.read.path, { objectType: '2-4242001' })).toBe(
    '/crm-object-schemas/2026-09/schemas/2-4242001',
  )
  expect(() => fillPath(registry.property.paths.read.path, { objectType: 'companies' })).toThrow('{name}')
})

test('the Limits Tracking row reads each limit on its own path, and the resource rows name theirs', () => {
  expect(registry.limits.paths).toEqual({
    customProperties: { method: 'GET', path: '/crm/limits/2026-09/custom-properties', tag: 'read' },
    customObjectTypes: { method: 'GET', path: '/crm/limits/2026-09/custom-object-types', tag: 'read' },
  })
  expect(registry.property.limitKey).toBe('custom-properties')
  expect(registry.object.limitKey).toBe('custom-object-types')
  const limitPaths = Object.values(registry.limits.paths).map((endpoint) => endpoint.path)
  for (const key of [registry.property.limitKey, registry.object.limitKey]) {
    expect(limitPaths).toContain(`/crm/limits/2026-09/${key}`)
  }
})

test('the property and group write paths match the 2026-09 reference', () => {
  const writes = (row: typeof registry.property | typeof registry.group) =>
    Object.fromEntries(Object.entries(row.paths).filter(([, endpoint]) => endpoint.tag === 'write'))
  expect(writes(registry.property)).toEqual({
    create: { method: 'POST', path: '/crm/properties/2026-09/{objectType}', tag: 'write' },
    update: { method: 'PATCH', path: '/crm/properties/2026-09/{objectType}/{name}', tag: 'write' },
    delete: { method: 'DELETE', path: '/crm/properties/2026-09/{objectType}/{name}', tag: 'write' },
  })
  expect(writes(registry.group)).toEqual({
    create: { method: 'POST', path: '/crm/properties/2026-09/{objectType}/groups', tag: 'write' },
    update: { method: 'PATCH', path: '/crm/properties/2026-09/{objectType}/groups/{name}', tag: 'write' },
    delete: { method: 'DELETE', path: '/crm/properties/2026-09/{objectType}/groups/{name}', tag: 'write' },
  })
})

test.each([...STANDARD_OBJECTS])('%s properties and groups write under the write twin of the read scope', (object) => {
  const scope = (readScopes[object] ?? '').replace(readSuffix, '.write')
  expect(writeScope(registry.property, object)).toBe(scope)
  expect(writeScope(registry.group, object)).toBe(scope)
})

test('the write scopes HubSpot lists for creating a property, and the custom and fixed ones', () => {
  expect(writeScope(registry.property, 'companies')).toBe('crm.schemas.companies.write')
  expect(writeScope(registry.property, 'commerce_payments')).toBe('crm.schemas.commercepayments.write')
  expect(writeScope(registry.property, 'products')).toBe('e-commerce')
  expect(writeScope(registry.property, 'users')).toBe('crm.objects.users.write')
  expect(writeScope(registry.property, '2-4242001')).toBe('crm.schemas.custom.write')
  expect(writeScope(registry.group, '2-4242001')).toBe('crm.schemas.custom.write')
  expect(writeScope(registry.object)).toBe('crm.schemas.custom.write')
  expect(writeScope(registry.object, 'products')).toBe('crm.schemas.custom.write')
  expect(writeScope(registry.accountInfo)).toBeUndefined()
  expect(writeScope(registry.property, 'constructor')).toBe('crm.schemas.constructor.write')
  expect(writeScope(registry.property, 'toString')).toBe('crm.schemas.custom.write')
})

test('the recommended crm.objects read scope is on the first of companies, contacts or deals in scope, else companies', () => {
  expect(limitScope(['harvest', 'deals', 'companies'])).toBe('crm.objects.deals.read')
  expect(limitScope(['tickets', 'contacts'])).toBe('crm.objects.contacts.read')
  // HubSpot publishes no crm.objects read scope for calls or notes, and Limits Tracking names `tickets` for tickets.
  expect(limitScope(['calls', 'companies'])).toBe('crm.objects.companies.read')
  expect(limitScope(['notes'])).toBe('crm.objects.companies.read')
  expect(limitScope(['tickets'])).toBe('crm.objects.companies.read')
  expect(limitScope(['tickets', 'companies'])).toBe('crm.objects.companies.read')
  // products read under e-commerce, leads under their own crm.objects scope, harvest is custom: companies instead.
  expect(limitScope(['products', 'leads', 'harvest'])).toBe('crm.objects.companies.read')
  expect(limitScope([])).toBe('crm.objects.companies.read')
})
