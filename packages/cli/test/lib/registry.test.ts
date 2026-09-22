import { expect, test } from 'vitest'
import { STANDARD_OBJECTS } from '../../src/lib/pull/index.js'
import { fillPath, readScope, registry } from '../../src/lib/registry.js'

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
      expect(endpoint.method).toMatch(/^(GET|POST|PATCH|PUT|DELETE)$/)
      expect(endpoint.path).toContain(row.version)
    }
  }
})

test('every row is pinned to a date version and carries an expiry', () => {
  for (const row of Object.values(registry)) {
    expect(row.version).toMatch(/^\d{4}-\d{2}$/)
    expect(row.expires).toMatch(/^\d{4}-\d{2}$/)
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

test('fillPath fills objectType and name and refuses a missing placeholder', () => {
  expect(fillPath(registry.property.paths.read.path, { objectType: 'companies', name: 'billing_status' })).toBe(
    '/crm/properties/2026-09/companies/billing_status',
  )
  expect(fillPath(registry.limits.paths.read.path, { limitKey: 'customObjects' })).toBe(
    '/crm/limits/2026-09/customObjects',
  )
  expect(() => fillPath(registry.property.paths.read.path, { objectType: 'companies' })).toThrow('{name}')
})
