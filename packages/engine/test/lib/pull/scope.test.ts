import { expect, test } from 'vitest'
import { STANDARD_OBJECT_TYPE_IDS, STANDARD_OBJECTS } from '../../../src/lib/pull/scope.js'

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
