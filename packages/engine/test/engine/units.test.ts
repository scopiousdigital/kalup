import { expect, test } from 'vitest'
import {
  CAPTURED,
  capturedSpec,
  keptNote,
  nameOf,
  objectOf,
  observedSpec,
  ownedFields,
  propertyCaptured,
  pullCommand,
  shellWord,
  specOf,
  takeCommand,
  targetFlag,
} from '../../src/engine/units.js'
import type { IRResource } from '../../src/ir/types.js'

test('an address names the object it is on and its own name; an object names itself', () => {
  expect([objectOf('object:harvest'), nameOf('object:harvest')]).toEqual(['harvest', 'harvest'])
  expect([objectOf('group:companies/orchard'), nameOf('group:companies/orchard')]).toEqual(['companies', 'orchard'])
  expect([objectOf('property:harvest/batch_code'), nameOf('property:harvest/batch_code')]).toEqual([
    'harvest',
    'batch_code',
  ])
})

test('an observation owns every field it captures: one it left out holds its default, or null', () => {
  expect(observedSpec(CAPTURED.property, { label: 'Plot tags', group: { $ref: 'group:companies/orchard' } })).toEqual({
    fields: {
      label: 'Plot tags',
      group: { $ref: 'group:companies/orchard' },
      type: null,
      fieldType: null,
      description: '',
      hasUniqueValue: false,
      formField: false,
      hidden: false,
      displayOrder: -1,
      numberDisplayHint: 'formatted',
      showCurrencySymbol: false,
      currencyPropertyName: null,
      textDisplayHint: null,
      calculationFormula: null,
      dataSensitivity: 'non_sensitive',
      externalOptions: null,
      referencedObjectType: null,
    },
  })
  // A property captures the display fields of its own type alone: a number no text hint, a string no number ones.
  expect(propertyCaptured('number')).toContain('numberDisplayHint')
  expect(propertyCaptured('number')).not.toContain('textDisplayHint')
  expect(propertyCaptured('phone_number')).toContain('textDisplayHint')
  expect(propertyCaptured('string')).not.toContain('showCurrencySymbol')
  // An inherited key is not a captured value.
  expect(observedSpec(['constructor'], {}).fields).toEqual({ constructor: null })
})

test('a captured property owns its options, none when it has none; a reference owns only its options', () => {
  const low = { value: 'low', label: 'Low' }
  const group: IRResource = { type: 'group', managed: true, definition: { label: 'Orchard' } }
  const property: IRResource = { type: 'property', managed: true, definition: { label: 'Row meta' } }
  const reference: IRResource = { type: 'property', managed: false, definition: { options: [low] } }
  expect(capturedSpec(group)).toEqual({ fields: { label: 'Orchard' } })
  expect(capturedSpec(property).options).toEqual([])
  expect(capturedSpec(reference)).toEqual({ fields: {}, options: [low] })
  expect(capturedSpec({ type: 'property', managed: false })).toEqual({ fields: {}, options: [] })
})

test('config owns the fields it states, less those ignoreChanges released; a spec holds the options apart', () => {
  const low = { value: 'low', label: 'Low' }
  const resource: IRResource = {
    type: 'property',
    managed: true,
    definition: { label: 'Yield tier', description: 'From the sync', options: [low] },
    lifecycle: { options: 'additive', ignoreChanges: ['description'] },
  }
  expect(ownedFields(resource)).toEqual({ label: 'Yield tier', options: [low] })
  expect(specOf(ownedFields(resource))).toEqual({ fields: { label: 'Yield tier' }, options: [low] })
  const released = { ...resource, lifecycle: { options: 'additive' as const, ignoreChanges: ['options'] } }
  expect(specOf(ownedFields(released))).toEqual({ fields: { label: 'Yield tier', description: 'From the sync' } })
})

test('the pull command copies one address from a target into config, and the note on a kept option names it', () => {
  expect(pullCommand('sandbox', 'property:companies/yield_tier')).toBe(
    'kalup pull --target sandbox --only property:companies/yield_tier',
  )
  expect(keptNote('sandbox', 'property:companies/yield_tier')).toContain(
    pullCommand('sandbox', 'property:companies/yield_tier'),
  )
})

test('a printed --target quotes a name that is not a plain shell word, so the command pastes as it reads', () => {
  expect(targetFlag('acme-eu')).toBe('--target acme-eu')
  expect(targetFlag('client_b.2')).toBe('--target client_b.2')
  expect(targetFlag('Staging 2')).toBe("--target 'Staging 2'")
  expect(targetFlag("Bob's portal")).toBe("--target 'Bob'\\''s portal'")
  expect(targetFlag('a;b')).toBe("--target 'a;b'")
  expect(pullCommand('Staging 2', 'property:companies/yield_tier')).toBe(
    "kalup pull --target 'Staging 2' --only property:companies/yield_tier",
  )
})

test('a printed argument is quoted when zsh would read it: a # anywhere, or an = first', () => {
  expect(shellWord('property:companies/soil_ph')).toBe('property:companies/soil_ph')
  expect(shellWord('plan.json')).toBe('plan.json')
  expect(shellWord('property:companies/soil_ph#label')).toBe("'property:companies/soil_ph#label'")
  expect(shellWord('property:companies/soil_ph#options[acid]')).toBe("'property:companies/soil_ph#options[acid]'")
  expect(shellWord('=plan.json')).toBe("'=plan.json'")
  expect(shellWord("it's")).toBe("'it'\\''s'")
  expect(takeCommand('sandbox', 'property:companies/soil_ph', 'label')).toBe(
    "kalup plan --target sandbox --take config 'property:companies/soil_ph#label'",
  )
})

test('a property whose type or fieldType no builder carries is captured as an unsupported one is', () => {
  const resource: IRResource = {
    type: 'property',
    managed: true,
    definition: {
      label: 'Margin',
      group: { $ref: 'group:companies/billing' },
      type: 'number',
      fieldType: 'calculation_rollup',
      description: '',
      hasUniqueValue: false,
      formField: true,
    },
  }
  expect(Object.keys(capturedSpec(resource).fields).sort()).toEqual([...CAPTURED.unsupported].sort())
  const known = { ...resource, definition: { ...resource.definition, fieldType: 'number' } }
  expect(Object.keys(capturedSpec(known).fields)).toContain('hasUniqueValue')
})
