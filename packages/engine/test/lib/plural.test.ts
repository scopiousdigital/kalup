import { expect, test } from 'vitest'
import { plural } from '../../src/lib/plural.js'

test('one takes the singular, any other count the plural', () => {
  expect(plural(1, 'write')).toBe('1 write')
  expect(plural(0, 'write')).toBe('0 writes')
  expect(plural(2, 'property', 'properties')).toBe('2 properties')
  expect(plural(1, 'property', 'properties')).toBe('1 property')
})
