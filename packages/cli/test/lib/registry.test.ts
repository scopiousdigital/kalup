import { expect, test } from 'vitest'
import { fillPath, registry } from '../../src/lib/registry.js'

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

test('fillPath fills objectType and name and refuses a missing placeholder', () => {
  expect(fillPath(registry.property.paths.read.path, { objectType: 'companies', name: 'billing_status' })).toBe(
    '/crm/properties/2026-09/companies/billing_status',
  )
  expect(fillPath(registry.limits.paths.read.path, { limitKey: 'customObjects' })).toBe(
    '/crm/limits/2026-09/customObjects',
  )
  expect(() => fillPath(registry.property.paths.read.path, { objectType: 'companies' })).toThrow('{name}')
})
