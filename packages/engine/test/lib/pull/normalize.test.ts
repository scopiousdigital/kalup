import { expect, test } from 'vitest'
import type { Issue } from '../../../src/ir/types.js'
import {
  normalizeGroups,
  normalizeProperties,
  normalizeSchema,
  propertyMeta,
  type RawProperty,
  type RawSchema,
} from '../../../src/lib/pull/normalize.js'
import { fixture } from '../../support/testing.js'

function raw(more: Partial<RawProperty> & { name: string }): RawProperty {
  return { label: more.name, type: 'string', fieldType: 'text', groupName: 'orchard', ...more }
}

test('a managed property with a fieldType no builder accepts is skipped; a reference with one is kept', () => {
  const issues: Issue[] = []
  const out = normalizeProperties(
    'companies',
    [
      raw({ name: 'plot_html', type: 'string', fieldType: 'nope' }),
      raw({ name: 'soil_ph', type: 'number', fieldType: 'calculation_rollup', calculated: true }),
    ],
    issues,
  )
  expect(out.properties.map((p) => p.name)).toEqual(['soil_ph'])
  expect(out.properties[0]).toMatchObject({ kind: 'number', reference: true, calculated: true, definition: undefined })
  expect(issues).toEqual([
    {
      code: 'W_UNSUPPORTED_TYPE',
      message: expect.stringContaining('property:companies/plot_html has type string and fieldType nope'),
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
  expect(out.properties.map((p) => p.name)).toEqual(['plot_total'])
  expect(issues.map((i) => i.code)).toEqual(['W_UNSUPPORTED_TYPE', 'W_UNSUPPORTED_TYPE'])
  expect(issues.map((i) => i.message)).toEqual([
    expect.stringContaining('property:companies/row_blob has type json and fieldType text'),
    expect.stringContaining('property:companies/plot_shape has type object_coordinates and fieldType text'),
  ])
})

test('every skipped property is listed as unsupported, with the fields a comparison needs', () => {
  const out = normalizeProperties(
    'companies',
    [
      raw({ name: 'plot_shape', type: 'object_coordinates', fieldType: 'text', description: '' }),
      raw({ name: 'hs_geo', type: 'object_coordinates', fieldType: 'text', hubspotDefined: true, description: 'Geo' }),
      raw({ name: 'plot_html', type: 'string', fieldType: 'html_block' }),
      raw({ name: 'old_shape', type: 'object_coordinates', fieldType: 'text', archived: true }),
      raw({ name: 'plot_total', type: 'number', fieldType: 'number' }),
      raw({
        name: 'plot_zone',
        type: 'enumeration',
        fieldType: 'text',
        options: [
          { value: 'b', label: 'B', displayOrder: 1, hidden: false, description: '' },
          { value: 'a', label: 'A', displayOrder: 0, hidden: true, description: 'First' },
        ],
      }),
    ],
    [],
  )
  expect(out.properties.map((p) => p.name)).toEqual(['plot_total'])
  expect(out.unsupported).toEqual([
    {
      name: 'plot_shape',
      label: 'plot_shape',
      group: 'orchard',
      type: 'object_coordinates',
      fieldType: 'text',
      hubspotDefined: false,
    },
    {
      name: 'hs_geo',
      label: 'hs_geo',
      group: 'orchard',
      description: 'Geo',
      type: 'object_coordinates',
      fieldType: 'text',
      hubspotDefined: true,
    },
    {
      name: 'plot_html',
      label: 'plot_html',
      group: 'orchard',
      type: 'string',
      fieldType: 'html_block',
      hubspotDefined: false,
    },
    {
      name: 'plot_zone',
      label: 'plot_zone',
      group: 'orchard',
      type: 'enumeration',
      fieldType: 'text',
      options: [
        { value: 'a', label: 'A', hidden: true, description: 'First' },
        { value: 'b', label: 'B' },
      ],
      hubspotDefined: false,
    },
  ])
})

test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
  'a portal type named like an Object.prototype key (%s) is unsupported, not a crash',
  (type) => {
    const issues: Issue[] = []
    const out = normalizeProperties('companies', [raw({ name: 'plot_odd', type, fieldType: 'text' })], issues)
    expect(out.properties).toEqual([])
    expect(out.unsupported).toEqual([
      { name: 'plot_odd', label: 'plot_odd', group: 'orchard', type, fieldType: 'text', hubspotDefined: false },
    ])
    expect(issues.map((i) => i.code)).toEqual(['W_UNSUPPORTED_TYPE'])
  },
)

test('a HubSpot-defined enumeration is an options-only reference that keeps hidden and description', () => {
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
  expect(out.properties[0]).toEqual({
    name: 'lifecyclestage',
    hubspotDefined: true,
    type: 'enumeration',
    fieldType: 'radio',
    kind: 'enum',
    reference: true,
    calculated: false,
    definition: {
      options: [
        { value: 'subscriber', label: 'Subscriber' },
        { value: 'lead', label: 'Lead', hidden: true, description: 'A lead' },
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
  expect(out.properties[0]?.kind).toBe('multiEnum')
  expect(out.properties[0]?.definition?.options).toEqual([
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
  expect(out.properties.map((p) => p.definition)).toEqual([
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

function schema(more: Partial<RawSchema> = {}): RawSchema {
  return {
    name: 'harvest',
    objectTypeId: '2-4242001',
    labels: { singular: 'Harvest', plural: 'Harvests' },
    primaryDisplayProperty: 'batch_code',
    requiredProperties: ['batch_code'],
    searchableProperties: [],
    secondaryDisplayProperties: [],
    ...more,
  }
}

test('a schema keeps its three property lists as returned, empty ones included', () => {
  expect(normalizeSchema(schema())).toEqual({
    labels: { singular: 'Harvest', plural: 'Harvests' },
    primaryDisplayProperty: 'batch_code',
    requiredProperties: ['batch_code'],
    searchableProperties: [],
    secondaryDisplayProperties: [],
  })
})

test('a schema missing a label, or its labels, keeps what it has instead of failing', () => {
  expect(normalizeSchema(schema({ labels: { plural: 'Harvests' } })).labels).toEqual({ plural: 'Harvests' })
  expect(normalizeSchema(schema({ labels: undefined })).labels).toEqual({})
})

test('groups: the unarchived ones by name with their labels', () => {
  const out = normalizeGroups([
    { name: 'orchard', label: 'Orchard' },
    { name: 'old_ledger', label: 'Old ledger', archived: true },
    { name: 'Attic', label: 'Attic', archived: true },
    { name: 'plots', label: 'Plots', archived: false },
  ])
  expect([...out.groups]).toEqual([
    ['orchard', 'Orchard'],
    ['plots', 'Plots'],
  ])
})

test('propertyMeta keeps the documented fields with their documented types, for unarchived properties only', () => {
  const meta = propertyMeta([
    {
      ...raw({ name: 'yield_tier', type: 'enumeration', fieldType: 'select' }),
      sensitivity: 'sensitive',
      createdAt: '2026-03-02T10:00:00.000Z',
      updatedAt: '2026-09-14T09:12:41.118Z',
      hubspotDefined: false,
      modificationMetadata: { archivable: true, readOnlyDefinition: false, readOnlyOptions: false },
      options: [
        { value: 'low', label: 'Low', displayOrder: 2 },
        { value: 'peak', label: 'Peak' },
      ],
    },
    {
      ...raw({ name: 'plot_odd' }),
      sensitivity: 'non_sensitive',
      createdAt: 1_757_000_000 as unknown as string,
      hubspotDefined: 'yes' as unknown as boolean,
      modificationMetadata: { archivable: 'yes' as unknown as boolean },
      options: [],
    },
    { ...raw({ name: 'old_yield', archived: true }), sensitivity: 'non_sensitive' },
  ])
  expect([...meta.keys()]).toEqual(['yield_tier', 'plot_odd'])
  expect(meta.get('yield_tier')).toEqual({
    sensitivity: 'sensitive',
    hubspotDefined: false,
    modificationMetadata: { archivable: true, readOnlyDefinition: false, readOnlyOptions: false },
    createdAt: '2026-03-02T10:00:00.000Z',
    updatedAt: '2026-09-14T09:12:41.118Z',
    options: [{ value: 'low', displayOrder: 2 }, { value: 'peak' }],
  })
  expect(meta.get('plot_odd')).toEqual({ sensitivity: 'non_sensitive', modificationMetadata: {} })
})

test('an owner property is p.owner, rich text p.string, a phone number p.phoneNumber; other external options are unsupported', () => {
  const issues: Issue[] = []
  const { results } = fixture('api/orchard/companies.unwritable.json') as unknown as { results: RawProperty[] }
  const out = normalizeProperties('companies', results, issues)
  expect(out.properties.map((p) => [p.name, p.kind, p.reference, p.external === true])).toEqual([
    ['hubspot_owner_id', 'owner', true, true],
    ['grove_manager', 'owner', false, true],
    ['grove_notes', 'string', false, false],
    ['grower_phone', 'phoneNumber', false, false],
  ])
  expect(out.properties.find((p) => p.name === 'grove_manager')?.definition).toEqual({
    label: 'Grove manager',
    group: 'orchard',
    fieldType: 'select',
    formField: true,
  })
  expect(out.unsupported.map((u) => [u.name, u.type, u.fieldType, u.externalOptions, u.referencedObjectType])).toEqual([
    ['grove_crew', 'enumeration', 'checkbox', true, undefined],
    ['grove_stewards', 'enumeration', 'checkbox', true, 'OWNER'],
  ])
  expect(issues.every((i) => i.code === 'W_UNSUPPORTED_TYPE')).toBe(true)
  expect(issues.map((i) => i.message)).toMatchInlineSnapshot(`
    [
      "property:companies/grove_crew takes its options from HubSpot (externalOptions), which Kalup does not write; read as a p.string reference",
      "property:companies/grove_stewards is a HubSpot user property with fieldType checkbox, which Kalup does not write; read as a p.string reference",
    ]
  `)
})

test('the display, order, formula and sensitivity fields are captured on the types that show them, defaults left out', () => {
  const out = normalizeProperties(
    'companies',
    [
      raw({
        name: 'pick_share',
        type: 'number',
        fieldType: 'calculation_equation',
        calculated: true,
        calculationFormula: 'picked / planted',
        numberDisplayHint: 'percentage',
        showCurrencySymbol: false,
        displayOrder: 4,
        hidden: true,
        textDisplayHint: 'email',
        dataSensitivity: 'non_sensitive',
      }),
      raw({ name: 'grove_site', numberDisplayHint: 'formatted', textDisplayHint: 'domain_name', displayOrder: -1 }),
      raw({
        name: 'grove_value',
        type: 'number',
        fieldType: 'number',
        numberDisplayHint: 'formatted',
        showCurrencySymbol: true,
        currencyPropertyName: 'grove_currency',
        dataSensitivity: 'sensitive',
      }),
      raw({ name: 'planted_on', type: 'date', fieldType: 'date', dateDisplayHint: 'time_since' }),
    ],
    [],
  )
  expect(Object.fromEntries(out.properties.map((p) => [p.name, p.definition]))).toEqual({
    pick_share: {
      label: 'pick_share',
      group: 'orchard',
      fieldType: 'calculation_equation',
      hidden: true,
      displayOrder: 4,
      numberDisplayHint: 'percentage',
      calculationFormula: 'picked / planted',
    },
    grove_site: { label: 'grove_site', group: 'orchard', fieldType: 'text', textDisplayHint: 'domain_name' },
    grove_value: {
      label: 'grove_value',
      group: 'orchard',
      fieldType: 'number',
      showCurrencySymbol: true,
      currencyPropertyName: 'grove_currency',
      dataSensitivity: 'sensitive',
    },
    planted_on: { label: 'planted_on', group: 'orchard', fieldType: 'date' },
  })
  expect(out.properties.find((p) => p.name === 'pick_share')).toMatchObject({ reference: false, calculated: true })
})

test('propertyMeta keeps readOnlyValue, which pull turns into .readonly()', () => {
  const { results } = fixture('api/orchard/companies.unwritable.json') as unknown as { results: RawProperty[] }
  const meta = propertyMeta(results.map((p) => ({ ...p, sensitivity: 'non_sensitive' as const })))
  expect(meta.get('grove_crew')?.modificationMetadata).toEqual({
    archivable: true,
    readOnlyDefinition: false,
    readOnlyValue: true,
  })
})
