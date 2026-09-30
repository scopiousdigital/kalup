import { expect, test } from 'vitest'
import { definedOn, inScope, STANDARD_OBJECT_TYPE_IDS, STANDARD_OBJECTS, scopeOf } from '../../../src/lib/pull/scope.js'

const STANDARD_ID = /^0-\d+$/

test('every standard object has one type ID of the form 0-<n>, and no two share one', () => {
  expect(Object.keys(STANDARD_OBJECT_TYPE_IDS).sort()).toEqual([...STANDARD_OBJECTS].sort())
  const ids = Object.values(STANDARD_OBJECT_TYPE_IDS)
  for (const id of ids) {
    expect(id).toMatch(STANDARD_ID)
  }
  expect(new Set(ids).size).toBe(ids.length)
})

test('contacts, companies, deals and tickets have the IDs HubSpot documents', () => {
  expect(STANDARD_OBJECT_TYPE_IDS).toMatchObject({ contacts: '0-1', companies: '0-2', deals: '0-3', tickets: '0-5' })
})

test('a property the files define is in scope whatever custom, include and exclude say', () => {
  const scope = scopeOf({ custom: false, exclude: ['plot_*'] }, ['plot_count', 'domain'])
  expect(inScope(scope, { name: 'plot_count', hubspotDefined: false })).toBe(true)
  expect(inScope(scope, { name: 'domain', hubspotDefined: true })).toBe(true)
  expect(inScope(scope, { name: 'plot_size', hubspotDefined: false })).toBe(false)
  expect(inScope(scope, { name: 'name', hubspotDefined: true })).toBe(false)
  // Without the files' names, the settings alone decide.
  expect(inScope(scopeOf({ custom: false }), { name: 'plot_count', hubspotDefined: false })).toBe(false)
})

test("definedOn lists one object's property names from the IR, and nothing else", () => {
  const resources = {
    'object:harvest': { type: 'object' as const, managed: true },
    'group:companies/orchard': { type: 'group' as const, managed: true },
    'property:companies/plot_count': { type: 'property' as const, managed: true },
    'property:companies/name': { type: 'property' as const, managed: false },
    'property:harvest/batch_code': { type: 'property' as const, managed: true },
  }
  expect(definedOn({ resources }, 'companies')).toEqual(['plot_count', 'name'])
  expect(definedOn({ resources }, 'deals')).toEqual([])
})
