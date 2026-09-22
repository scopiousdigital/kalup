import type { Issue } from '@kalup/core'
import { expect, test } from 'vitest'
import { normalizeProperties, type RawProperty } from '../../../src/lib/pull/normalize.js'

function raw(more: Partial<RawProperty> & { name: string }): RawProperty {
  return { label: more.name, type: 'string', fieldType: 'text', groupName: 'orchard', ...more }
}

test('a managed property with a fieldType no builder accepts is skipped; a reference with one is kept', () => {
  const issues: Issue[] = []
  const out = normalizeProperties(
    'companies',
    [
      raw({ name: 'plot_html', type: 'string', fieldType: 'nope' }),
      raw({ name: 'soil_ph', type: 'number', fieldType: 'calculation_equation', calculated: true }),
    ],
    issues,
  )
  expect(out.map((p) => p.name)).toEqual(['soil_ph'])
  expect(out[0]).toMatchObject({ kind: 'number', reference: true, calculated: true, definition: undefined })
  expect(issues).toEqual([
    {
      code: 'W_UNSUPPORTED_TYPE',
      message: 'property:companies/plot_html has type string and fieldType nope, which no builder carries; skipped',
    },
  ])
})

test('type json and an unknown type are skipped with one warning each', () => {
  const issues: Issue[] = []
  const out = normalizeProperties(
    'companies',
    [
      raw({ name: 'row_blob', type: 'json', fieldType: 'text' }),
      raw({ name: 'plot_shape', type: 'object_coordinates', fieldType: 'text' }),
      raw({ name: 'plot_total', type: 'number', fieldType: 'number' }),
    ],
    issues,
  )
  expect(out.map((p) => p.name)).toEqual(['plot_total'])
  expect(issues.map((i) => i.message)).toEqual([
    'property:companies/row_blob has type json and fieldType text, which no builder carries; skipped',
    'property:companies/plot_shape has type object_coordinates and fieldType text, which no builder carries; skipped',
  ])
})

test('a HubSpot-defined enumeration is an options-only reference with value and label alone', () => {
  const out = normalizeProperties(
    'companies',
    [
      raw({
        name: 'lifecyclestage',
        type: 'enumeration',
        fieldType: 'radio',
        description: 'Stage',
        hubspotDefined: true,
        options: [
          { value: 'lead', label: 'Lead', displayOrder: 1, hidden: true, description: 'A lead' },
          { value: 'subscriber', label: 'Subscriber', displayOrder: 0, hidden: false },
        ],
      }),
    ],
    [],
  )
  expect(out[0]).toEqual({
    name: 'lifecyclestage',
    hubspotDefined: true,
    type: 'enumeration',
    kind: 'enum',
    reference: true,
    calculated: false,
    definition: {
      options: [
        { value: 'subscriber', label: 'Subscriber' },
        { value: 'lead', label: 'Lead' },
      ],
    },
  })
})

test('options follow displayOrder, with -1 and none after every positive value in portal order', () => {
  const out = normalizeProperties(
    'companies',
    [
      raw({
        name: 'yield_tier',
        type: 'enumeration',
        fieldType: 'checkbox',
        options: [
          { value: 'peak', label: 'Peak', displayOrder: -1, hidden: true },
          { value: 'none', label: 'None' },
          { value: 'high', label: 'High', displayOrder: 1 },
          { value: 'low', label: 'Low', displayOrder: 0, description: 'Under a tonne' },
        ],
      }),
    ],
    [],
  )
  expect(out[0]?.kind).toBe('multiEnum')
  expect(out[0]?.definition?.options).toEqual([
    { value: 'low', label: 'Low', description: 'Under a tonne' },
    { value: 'high', label: 'High' },
    { value: 'peak', label: 'Peak', hidden: true },
    { value: 'none', label: 'None' },
  ])
})

test('a managed definition drops empty and default fields, an archived property is skipped', () => {
  const out = normalizeProperties(
    'companies',
    [
      raw({ name: 'plot_total', type: 'number', fieldType: 'number', description: '', formField: false }),
      raw({ name: 'batch_code', hasUniqueValue: true, formField: true, description: 'Unique' }),
      raw({ name: 'old_total', type: 'number', fieldType: 'number', archived: true }),
    ],
    [],
  )
  expect(out.map((p) => p.definition)).toEqual([
    { label: 'plot_total', group: 'orchard', fieldType: 'number' },
    {
      label: 'batch_code',
      group: 'orchard',
      fieldType: 'text',
      description: 'Unique',
      hasUniqueValue: true,
      formField: true,
    },
  ])
})
