import { expect, test } from 'vitest'
import { bin, disclaimer } from '../src/brand.js'

test('the brand: the command name and the disclaimer', () => {
  expect(bin).toBe('kalup')
  expect(disclaimer).toContain('HubSpot is a registered trademark of HubSpot, Inc.')
})
