// IR resources back into the grammar: the inverse of the loader. A rendered property written and loaded again gives the
// resource back, and an entry the file holds keeps its comments and json validator.

import { expect, test } from 'vitest'
import type { ObjectFile } from '../../../src/grammar/types.js'
import { write } from '../../../src/grammar/write.js'
import type { IRResource } from '../../../src/ir/types.js'
import { toGroup, toProperty } from '../../../src/lib/pull/render.js'
import { loadFiles } from '../../../src/loader/load.js'

const CONFIG = `import { defineConfig } from '@kalup/core'

export default defineConfig({
  objects: {
    deals: {},
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
  },
})
`

const stage: IRResource = {
  type: 'property',
  managed: true,
  definition: {
    label: 'Renewal stage',
    group: { $ref: 'group:deals/renewal' },
    type: 'enumeration',
    fieldType: 'select',
    description: '',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'won', label: 'Won', hidden: false },
    ],
    formField: true,
  },
  binding: { key: 'stage', codec: 'enum', aliases: { won: 'renewed' }, required: true },
  lifecycle: { options: 'exact', removedOptions: ['lost'] },
}

const group: IRResource = { type: 'group', managed: true, definition: { label: 'Renewal' } }

function loaded(file: ObjectFile) {
  return loadFiles({ 'kalup.config.ts': CONFIG, 'hubspot/objects/deals.ts': write('object', file) }).ir.resources
}

function deals(properties: ObjectFile['exports'][number]['properties']): ObjectFile {
  return {
    imports: [],
    exports: [
      {
        name: 'Deal',
        builder: 'defineObject',
        object: 'deals',
        comments: [],
        groups: [toGroup('group:deals/renewal', group)],
        properties,
      },
    ],
  }
}

test('a property renders as its builder and loads back as the same resource', () => {
  const property = toProperty('property:deals/renewal_stage', stage)
  expect(property).toMatchObject({
    key: 'stage',
    kind: 'enum',
    name: 'renewal_stage',
    chain: { required: true, readonly: false, managed: true },
    definition: {
      group: 'renewal',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'won', label: 'Won', as: 'renewed', hidden: false },
      ],
      lifecycle: { options: 'exact', removedOptions: ['lost'] },
    },
  })
  const resources = loaded(deals([property]))
  expect(resources['property:deals/renewal_stage']).toEqual(stage)
  expect(resources['group:deals/renewal']).toEqual(group)
})

test('binding.strict renders as .strict() and loads back', () => {
  const strict: IRResource = { ...stage, binding: { ...stage.binding, strict: true } }
  const property = toProperty('property:deals/renewal_stage', strict)
  expect(property.chain).toEqual({ strict: true, required: true, readonly: false, managed: true })
  expect(write('object', deals([property]))).toContain('.strict()\n      .required(),')
  expect(loaded(deals([property]))['property:deals/renewal_stage']).toEqual(strict)
})

test('with no binding the key is camelCase of the name and the kind comes from the type; the default lifecycle is left out', () => {
  const property = toProperty('property:deals/renewal_date', {
    type: 'property',
    managed: true,
    definition: { label: 'Renewal date', group: { $ref: 'group:deals/renewal' }, type: 'date', fieldType: 'date' },
    lifecycle: { options: 'additive' },
  })
  expect(property).toMatchObject({ key: 'renewalDate', kind: 'date' })
  expect(property.definition).not.toHaveProperty('lifecycle')
})

test('the display, order, formula and sensitivity fields, an owner and a phone number render and load back as the same resources', () => {
  const renewal = { $ref: 'group:deals/renewal' }
  const resources: Record<string, IRResource> = {
    'property:deals/discount_share': {
      type: 'property',
      managed: true,
      definition: {
        label: 'Discount share',
        group: renewal,
        type: 'number',
        fieldType: 'calculation_equation',
        hidden: true,
        displayOrder: 2,
        numberDisplayHint: 'percentage',
        calculationFormula: 'discount / amount',
        dataSensitivity: 'non_sensitive',
      },
      binding: { key: 'discountShare', codec: 'number' },
      lifecycle: { options: 'additive' },
    },
    'property:deals/deal_steward': {
      type: 'property',
      managed: true,
      definition: {
        label: 'Deal steward',
        group: renewal,
        type: 'enumeration',
        fieldType: 'radio',
        externalOptions: true,
        referencedObjectType: 'OWNER',
      },
      binding: { key: 'dealSteward', codec: 'owner' },
      lifecycle: { options: 'additive' },
    },
    'property:deals/renewal_line': {
      type: 'property',
      managed: true,
      definition: {
        label: 'Renewal line',
        group: renewal,
        type: 'phone_number',
        fieldType: 'phonenumber',
        textDisplayHint: 'phone_number',
      },
      binding: { key: 'renewalLine', codec: 'phoneNumber' },
      lifecycle: { options: 'additive' },
    },
  }
  const properties = Object.entries(resources).map(([address, resource]) => toProperty(address, resource))
  expect(properties.map((p) => p.kind)).toEqual(['number', 'owner', 'phoneNumber'])
  const back = loaded(deals(properties))
  for (const [address, resource] of Object.entries(resources)) {
    expect(back[address], address).toEqual(resource)
  }
  // With no binding, the kind comes from the definition: an owner property is p.owner.
  const { binding: _, ...unbound } = resources['property:deals/deal_steward'] as IRResource
  expect(toProperty('property:deals/deal_steward', unbound).kind).toBe('owner')
})

test('the entry the file holds keeps its comments and its json validator', () => {
  const previous = {
    key: 'terms',
    kind: 'json' as const,
    name: 'renewal_terms',
    json: { validatorSource: 'termsSchema' },
    chain: { required: false, readonly: false, managed: true },
    comments: ['// Written by the contract sync.'],
  }
  const property = toProperty(
    'property:deals/renewal_terms',
    {
      type: 'property',
      managed: true,
      definition: { label: 'Terms', group: { $ref: 'group:deals/renewal' }, type: 'string', fieldType: 'textarea' },
      binding: { key: 'terms', codec: 'json' },
    },
    previous,
  )
  expect(property).toMatchObject({
    kind: 'json',
    json: { validatorSource: 'termsSchema' },
    comments: ['// Written by the contract sync.'],
  })
  const kept = toGroup('group:deals/renewal', group, { name: 'renewal', label: 'Old', comments: ['// Kept.'] })
  expect(kept).toEqual({ name: 'renewal', label: 'Renewal', comments: ['// Kept.'] })
})

test('a lifecycle the file states stays, a stated default and an empty one included', () => {
  const date: IRResource = {
    type: 'property',
    managed: true,
    definition: { label: 'Renewal date', group: { $ref: 'group:deals/renewal' }, type: 'date', fieldType: 'date' },
    binding: { key: 'renewalDate', codec: 'date' },
    lifecycle: { options: 'additive' },
  }
  const previous = (lifecycle: object) => ({
    key: 'renewalDate',
    kind: 'date' as const,
    name: 'renewal_date',
    definition: { label: 'Renewal date', group: 'renewal', fieldType: 'date', lifecycle },
    chain: { required: false, readonly: false, managed: true },
    comments: [],
  })
  const address = 'property:deals/renewal_date'
  expect(toProperty(address, date, previous({ preventDestroy: false })).definition?.lifecycle).toEqual({
    preventDestroy: false,
  })
  expect(toProperty(address, date, previous({})).definition?.lifecycle).toEqual({})
  expect(toProperty(address, date).definition).not.toHaveProperty('lifecycle')
  // A merge that turned preventDestroy off writes false where the file stated true.
  expect(toProperty(address, date, previous({ preventDestroy: true })).definition?.lifecycle).toEqual({
    preventDestroy: false,
  })
})
