import { expect, test } from 'vitest'
import { toCreatePayload } from '../../src/ir/payload.js'
import type { IR, IRResource } from '../../src/ir/types.js'
import { fixture } from './fixture.js'

const ir = fixture<IR>('acme.ir.json')
const bodies = fixture<Record<string, unknown>>('acme.create-bodies.json')

function resource(address: string): IRResource {
  const found = ir.resources[address]
  if (!found) {
    throw new Error(`${address} is not in the fixture`)
  }
  return found
}

test('create-payload completeness: every managed property and group equals its fixture body', () => {
  const covered = new Set<string>()
  for (const [address, entry] of Object.entries(ir.resources)) {
    if (!entry.managed || (entry.type !== 'property' && entry.type !== 'group')) {
      continue
    }
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

test('an object resource has no create payload yet', () => {
  expect(() => toCreatePayload('object:subscription', resource('object:subscription'))).toThrow(
    'object:subscription: the create payload for an object',
  )
})

test('an unmanaged resource is never created: a reference, an options-only reference, a .managed(false) property', () => {
  const unmanaged = ['property:companies/name', 'property:companies/lead_source', 'property:companies/legacy_tier']
  for (const address of unmanaged) {
    expect(() => toCreatePayload(address, resource(address))).toThrow(`${address} is not managed`)
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

test('a create sends every field the definition states: display, order, formula and sensitivity', () => {
  const share: IRResource = {
    type: 'property',
    managed: true,
    definition: {
      label: 'Pick share',
      group: { $ref: 'group:companies/orchard' },
      type: 'number',
      fieldType: 'calculation_equation',
      hidden: false,
      displayOrder: 3,
      numberDisplayHint: 'percentage',
      showCurrencySymbol: false,
      calculationFormula: 'picked / planted',
      dataSensitivity: 'non_sensitive',
    },
  }
  expect(toCreatePayload('property:companies/pick_share', share)).toEqual({
    name: 'pick_share',
    label: 'Pick share',
    type: 'number',
    fieldType: 'calculation_equation',
    groupName: 'orchard',
    hidden: false,
    displayOrder: 3,
    numberDisplayHint: 'percentage',
    showCurrencySymbol: false,
    calculationFormula: 'picked / planted',
    dataSensitivity: 'non_sensitive',
  })
})

test('a boolean checkbox is created with the two options HubSpot requires, an owner with its external options', () => {
  const group = { $ref: 'group:companies/orchard' }
  const organic: IRResource = {
    type: 'property',
    managed: true,
    definition: { label: 'Organic', group, type: 'bool', fieldType: 'booleancheckbox' },
  }
  const steward: IRResource = {
    type: 'property',
    managed: true,
    definition: {
      label: 'Steward',
      group,
      type: 'enumeration',
      fieldType: 'select',
      externalOptions: true,
      referencedObjectType: 'OWNER',
    },
  }
  expect(toCreatePayload('property:companies/organic', organic).options).toEqual([
    { label: 'Yes', value: 'true', displayOrder: 0, hidden: false },
    { label: 'No', value: 'false', displayOrder: 1, hidden: false },
  ])
  expect(toCreatePayload('property:companies/steward', steward)).toEqual({
    name: 'steward',
    label: 'Steward',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'orchard',
    externalOptions: true,
    referencedObjectType: 'OWNER',
  })
})
