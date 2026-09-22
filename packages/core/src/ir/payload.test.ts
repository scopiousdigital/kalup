import { expect, test } from 'vitest'
import { fixture } from './fixture.js'
import { toCreatePayload } from './payload.js'
import type { IR, IRResource } from './types.js'

const ir = fixture<IR>('acme.ir.json')
const bodies = fixture<Record<string, unknown>>('acme.create-bodies.json')

function resource(address: string): IRResource {
  const found = ir.resources[address]
  if (!found) throw new Error(`${address} is not in the fixture`)
  return found
}

test('create-payload completeness: every managed property and group equals its fixture body', () => {
  const covered = new Set<string>()
  for (const [address, entry] of Object.entries(ir.resources)) {
    if (!entry.managed || (entry.type !== 'property' && entry.type !== 'group')) continue
    expect(toCreatePayload(address, entry), address).toEqual(bodies[address])
    covered.add(address)
  }
  expect([...covered].sort()).toEqual(Object.keys(bodies).sort())
})

test('enum aliases never reach HubSpot', () => {
  const address = 'property:companies/billing_status'
  const text = JSON.stringify(toCreatePayload(address, resource(address)))
  expect(text).not.toContain('past_due')
  expect(text).not.toContain('aliases')
})

test('an object resource waits for milestone 4', () => {
  expect(() => toCreatePayload('object:subscription', resource('object:subscription'))).toThrow(
    'object:subscription: the create payload for an object waits for milestone 4',
  )
})

test('an unmanaged resource is never created: a reference, an options-only reference, a .managed(false) property', () => {
  const unmanaged = ['property:companies/name', 'property:companies/lead_source', 'property:companies/legacy_tier']
  for (const address of unmanaged) {
    expect(() => toCreatePayload(address, resource(address))).toThrow(`${address} is not managed and is never created`)
  }
})

test('a managed resource with no definition or no group $ref is refused with a named error', () => {
  expect(() => toCreatePayload('group:companies/billing', { type: 'group', managed: true })).toThrow(
    'group:companies/billing has no definition to create from',
  )
  const noGroup: IRResource = {
    type: 'property',
    managed: true,
    definition: { label: 'Seats', type: 'number', fieldType: 'number' },
  }
  expect(() => toCreatePayload('property:subscription/seats', noGroup)).toThrow(
    'property:subscription/seats: definition.group is not a $ref',
  )
})
