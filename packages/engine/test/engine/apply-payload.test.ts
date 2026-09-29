// The bodies apply sends, built from the read made right before each write.

import { expect, test } from 'vitest'
import { createBody, groupPatch, memberOf, optionsPatch, propertyPatch } from '../../src/engine/apply-payload.js'
import type { RawOption } from '../../src/lib/pull/normalize.js'
import type { PlanChange, PlanStep } from '../../src/plan/types.js'

const live: RawOption[] = [
  { value: 'low', label: 'Low', displayOrder: 0, hidden: false, description: 'Under a tonne' },
  { value: 'high', label: 'High', displayOrder: 1, hidden: false },
  { value: 'legacy', label: 'Legacy', displayOrder: 7, hidden: true },
]

function change(unit: string, op: PlanChange['op'], after: unknown, before: unknown = null): PlanChange {
  return { unit, op, after, before, class: op === 'set' ? 'config-change' : op }
}

test('a property create is core payload under its portal names, with every option complete', () => {
  const step = {
    address: 'property:companies/yield_tier',
    desired: {
      label: 'Yield tier',
      group: { $ref: 'group:companies/orchard' },
      type: 'enumeration',
      fieldType: 'select',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High', hidden: true, description: 'Top band' },
      ],
    },
  } as Pick<PlanStep, 'address' | 'desired'>
  expect(createBody(step, { name: 'legacy_tier', group: 'orchard_details' })).toEqual({
    name: 'legacy_tier',
    label: 'Yield tier',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'orchard_details',
    options: [
      { value: 'low', label: 'Low', displayOrder: 0, hidden: false },
      { value: 'high', label: 'High', hidden: true, description: 'Top band', displayOrder: 1 },
    ],
  })
})

test('a group create is its portal name and label', () => {
  const step = { address: 'group:companies/orchard', desired: { label: 'Orchard' } }
  expect(createBody(step, { name: 'orchard' })).toEqual({ name: 'orchard', label: 'Orchard' })
})

test('a property PATCH carries exactly the approved units, the group by portal name, and the live type and fieldType', () => {
  const step = {
    changes: [change('label', 'set', 'Plot total'), change('group', 'set', { $ref: 'group:companies/orchard' })],
    desired: { label: 'Plot total', group: { $ref: 'group:companies/orchard' }, type: 'number', fieldType: 'number' },
  }
  const body = propertyPatch(step, { type: 'number', fieldType: 'number', options: [] }, () => 'orchard_details')
  expect(body).toEqual({ label: 'Plot total', groupName: 'orchard_details', type: 'number', fieldType: 'number' })
})

test('an approved fieldType is sent instead of the live one', () => {
  const step = { changes: [change('fieldType', 'set', 'radio')], desired: { fieldType: 'radio' } }
  const body = propertyPatch(step, { type: 'enumeration', fieldType: 'select', options: live }, (ref) => ref)
  expect(body).toEqual({ fieldType: 'radio', type: 'enumeration' })
})

test('an option change sends every live option unchanged, then the approved adds after the highest displayOrder', () => {
  const desired = [
    { value: 'low', label: 'Low' },
    { value: 'trial', label: 'Trial' },
    { value: 'high', label: 'High' },
    { value: 'peak', label: 'Peak' },
  ]
  const changes = [change('options[peak]', 'add', desired[3]), change('options[trial]', 'add', desired[1])]
  expect(optionsPatch(changes, live, desired)).toEqual([
    { value: 'low', label: 'Low', displayOrder: 0, hidden: false, description: 'Under a tonne' },
    { value: 'high', label: 'High', displayOrder: 1, hidden: false },
    { value: 'legacy', label: 'Legacy', displayOrder: 7, hidden: true },
    { value: 'trial', label: 'Trial', displayOrder: 8, hidden: false },
    { value: 'peak', label: 'Peak', displayOrder: 9, hidden: false },
  ])
})

test('removes and member edits change only what was approved', () => {
  const changes = [
    change('options[legacy]', 'remove', null, live[2]),
    change('options[low].label', 'set', 'Lowest', 'Low'),
    change('options[high].hidden', 'set', true, false),
    change('options[high].description', 'set', 'Top band', ''),
  ]
  expect(optionsPatch(changes, live)).toEqual([
    { value: 'low', label: 'Lowest', displayOrder: 0, hidden: false, description: 'Under a tonne' },
    { value: 'high', label: 'High', displayOrder: 1, hidden: true, description: 'Top band' },
  ])
})

test('displayOrder is renumbered only for an approved options.order, its values first', () => {
  const changes = [change('options.order', 'set', ['high', 'low'], ['low', 'high'])]
  expect(optionsPatch(changes, live).map((o) => [o.value, o.displayOrder])).toEqual([
    ['high', 0],
    ['low', 1],
    ['legacy', 2],
  ])
})

test('a property PATCH with an option change carries the full option list', () => {
  const step = { changes: [change('options[legacy]', 'remove', null)], desired: { options: [] } }
  const body = propertyPatch(step, { type: 'enumeration', fieldType: 'select', options: live }, (ref) => ref)
  expect(body).toEqual({
    type: 'enumeration',
    fieldType: 'select',
    options: [
      { value: 'low', label: 'Low', displayOrder: 0, hidden: false, description: 'Under a tonne' },
      { value: 'high', label: 'High', displayOrder: 1, hidden: false },
    ],
  })
})

test('a group PATCH carries its label and nothing else', () => {
  expect(groupPatch([change('label', 'set', 'Orchard details')])).toEqual({ label: 'Orchard details' })
})

test.each([
  ['options[low]', { value: 'low' }],
  ['options[low].label', { value: 'low', field: 'label' }],
  ['options[a]b].hidden', { value: 'a]b', field: 'hidden' }],
  ['options.order', undefined],
  ['label', undefined],
])('memberOf(%j)', (unit, expected) => {
  expect(memberOf(unit)).toEqual(expected)
})
