import { expect, test } from 'vitest'
import { effectiveResources } from '../../src/loader/effective.js'
import { loadFiles } from '../../src/loader/load.js'

const OBJECTS = `import { defineCustomObject, defineObject, type InferProperties, p } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: {
    billing: { label: 'Billing' },
    billing_eu: { label: 'Billing (EU)' },
  },
  properties: {
    billingStatus: p.enum('billing_status', {
      label: 'Billing status',
      group: 'billing',
      fieldType: 'select',
      description: 'Where the account stands',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'PAST DUE', label: 'Past due', as: 'past_due' },
      ],
      lifecycle: { removedOptions: ['legacy'], ignoreChanges: ['description'] },
    }),
    depotCode: p.string('depot_code', { label: 'Depot code', group: 'billing', fieldType: 'text' }),
    name: p.string('name'),
    sealed: p.string('sealed', { label: 'Sealed', group: 'billing', fieldType: 'text' }).managed(false),
    tier: p.enum('tier', { options: [{ value: 'gold', label: 'Gold' }] }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }

export const Crate = defineCustomObject('crate', {
  labels: { singular: 'Crate', plural: 'Crates' },
  primaryDisplayProperty: 'crate_code',
  properties: {},
})

export type CrateData = InferProperties<typeof Crate.properties> & { id: string }
`

const STATUS = 'property:companies/billing_status'
const DEPOT = 'property:companies/depot_code'

function load(overrides: string) {
  const config = `import { defineConfig } from 'kalup'

export default defineConfig({
  targets: {
    'acme-eu': {
      portalId: 4141414,
      overrides: {
${overrides}
      },
    },
    'acme-us': { portalId: 5151515 },
  },
})
`
  return loadFiles({ 'kalup.config.ts': config, 'kalup/objects/companies.ts': OBJECTS })
}

test('each stated field replaces the shared one; the fields an override leaves out stay shared', () => {
  const { ir } = load(
    "        'property:companies/billing_status': { definition: { label: 'Account state', fieldType: 'radio', formField: true } },",
  )
  expect(effectiveResources(ir, 'acme-eu')[STATUS]?.definition).toEqual({
    label: 'Account state',
    group: { $ref: 'group:companies/billing' },
    type: 'enumeration',
    fieldType: 'radio',
    description: 'Where the account stands',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'PAST DUE', label: 'Past due' },
    ],
    formField: true,
  })
})

test('the result is in IR form: the group a $ref, options without as, in the order definitionToIR writes', () => {
  const { ir } = load(
    "        'property:companies/billing_status': { definition: { options: [{ value: 'paused', label: 'Paused', hidden: true, description: 'On hold' }, { value: 'active', label: 'Live', as: 'live' }], group: 'billing_eu' } },",
  )
  const definition = effectiveResources(ir, 'acme-eu')[STATUS]?.definition ?? {}
  expect(definition.group).toEqual({ $ref: 'group:companies/billing_eu' })
  expect(definition.options).toEqual([
    { value: 'paused', label: 'Paused', hidden: true, description: 'On hold' },
    { value: 'active', label: 'Live' },
  ])
  expect(Object.keys(definition)).toEqual(['label', 'group', 'type', 'fieldType', 'description', 'options'])
  // The app's aliases come from the shared file alone.
  expect(effectiveResources(ir, 'acme-eu')[STATUS]?.binding?.aliases).toEqual({ 'PAST DUE': 'past_due' })
})

test('options replace the shared list whole, in the override order, with no merge by value', () => {
  const { ir } = load(
    "        'property:companies/billing_status': { definition: { options: [{ value: 'PAST DUE', label: 'Overdue' }] } },",
  )
  expect(effectiveResources(ir, 'acme-eu')[STATUS]?.definition?.options).toEqual([
    { value: 'PAST DUE', label: 'Overdue' },
  ])
})

test('an explicit empty value is data: an empty description, an empty option list and formField false are owned', () => {
  const { ir } = load(
    [
      "        'property:companies/billing_status': { definition: { description: '', options: [], formField: false } },",
      "        'property:companies/depot_code': { definition: { description: '' } },",
    ].join('\n'),
  )
  const effective = effectiveResources(ir, 'acme-eu')
  expect(effective[STATUS]?.definition).toMatchObject({ description: '', options: [], formField: false })
  // A field the shared definition leaves to the portal is owned on the target that states it.
  expect(ir.resources[DEPOT]?.definition).not.toHaveProperty('description')
  expect(effective[DEPOT]?.definition).toHaveProperty('description', '')
})

test('lifecycle is overridden field by field', () => {
  const { ir } = load(
    "        'property:companies/billing_status': { definition: { lifecycle: { options: 'exact', removedOptions: [] } } },",
  )
  expect(ir.resources[STATUS]?.lifecycle).toEqual({
    options: 'additive',
    removedOptions: ['legacy'],
    ignoreChanges: ['description'],
  })
  expect(effectiveResources(ir, 'acme-eu')[STATUS]?.lifecycle).toEqual({
    options: 'exact',
    removedOptions: [],
    ignoreChanges: ['description'],
  })
})

test('a group override replaces its label', () => {
  const { ir } = load("        'group:companies/billing': { definition: { label: 'Invoicing' } },")
  expect(effectiveResources(ir, 'acme-eu')['group:companies/billing']).toEqual({
    type: 'group',
    managed: true,
    definition: { label: 'Invoicing' },
  })
})

test('a skip wins: a skipped address keeps its shared definition', () => {
  const { ir } = load(
    "        'property:companies/billing_status': { skip: true, definition: { label: 'Account state' } },",
  )
  expect(effectiveResources(ir, 'acme-eu')[STATUS]).toEqual(ir.resources[STATUS])
})

test('a target without overrides, and one that is not declared, see the shared resources', () => {
  const { ir } = load("        'property:companies/billing_status': { definition: { label: 'Account state' } },")
  expect(effectiveResources(ir, 'acme-us')).toEqual(ir.resources)
  expect(effectiveResources(ir, 'staging')).toEqual(ir.resources)
  expect(effectiveResources(ir, 'constructor')).toEqual(ir.resources)
})

test('the shared IR is unchanged: the function copies, never mutates', () => {
  const { ir } = load(
    "        'property:companies/billing_status': { definition: { label: 'Account state', options: [], lifecycle: { options: 'exact' } } },\n        'group:companies/billing': { definition: { label: 'Invoicing' } },",
  )
  const before = structuredClone(ir)
  const effective = effectiveResources(ir, 'acme-eu')
  expect(effective[STATUS]?.definition?.label).toBe('Account state')
  expect(ir).toEqual(before)
  expect(ir.targets['acme-eu']).toHaveProperty(['overrides', STATUS, 'definition'], {
    label: 'Account state',
    options: [],
    lifecycle: { options: 'exact' },
  })
})

test('a reference, a .managed(false) property and a custom object schema take no definition override', () => {
  const { ir } = load(
    [
      "        'property:companies/name': { definition: { label: 'Company' } },",
      "        'property:companies/tier': { definition: { label: 'Tier' } },",
      "        'property:companies/sealed': { definition: { label: 'Open' } },",
      "        'object:crate': { definition: { label: 'Box' } },",
    ].join('\n'),
  )
  const effective = effectiveResources(ir, 'acme-eu')
  for (const address of [
    'property:companies/name',
    'property:companies/tier',
    'property:companies/sealed',
    'object:crate',
  ]) {
    expect(effective[address], address).toEqual(ir.resources[address])
  }
})
