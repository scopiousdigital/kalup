import { expect, test } from 'vitest'
import { address, parseAddress } from './address.js'

const examples: [string, string][] = [
  ['property', 'companies/billing_status'],
  ['group', 'companies/billing'],
  ['object', 'subscription'],
  ['stage', 'deals/renewals/won'],
  ['association', 'companies/contacts/primary_contact'],
  ['owner', 'dana@example.com'],
]

test('address builds and parses the spec examples', () => {
  for (const [type, path] of examples) {
    expect(address(type, path)).toBe(`${type}:${path}`)
    expect(parseAddress(`${type}:${path}`)).toEqual({ type, path })
  }
})

test('parseAddress splits at the first colon only', () => {
  expect(parseAddress('list:a:b')).toEqual({ type: 'list', path: 'a:b' })
})

test('malformed addresses throw', () => {
  for (const bad of ['billing', 'Property:x', 'property:', 'property:a b', ':x']) {
    expect(() => parseAddress(bad)).toThrow(`not an address: "${bad}"`)
  }
  expect(() => address('property', '')).toThrow('not an address')
})
