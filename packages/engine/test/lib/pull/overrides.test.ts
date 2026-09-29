import type { Definition, Override } from '@kalup/core'
import { expect, test } from 'vitest'
import type { ObjectExport, Property } from '../../../src/grammar/types.js'
import { mergeObject } from '../../../src/lib/pull/merge.js'
import type { LiveObject, LiveProperty } from '../../../src/lib/pull/normalize.js'
import { asTarget, fromTarget, targetOnly } from '../../../src/lib/pull/overrides.js'
import { addressMatcher, scopeOf } from '../../../src/lib/pull/scope.js'

const tier = 'property:companies/yield_tier'
const orchard = 'group:companies/orchard'

const shared: Definition = {
  label: 'Yield tier',
  group: 'orchard',
  fieldType: 'select',
  description: 'Set by the yield sync',
  options: [
    { value: 'low', label: 'Low' },
    { value: 'HIGH', label: 'High', as: 'high' },
  ],
  lifecycle: { ignoreChanges: ['description'] },
}

const property = (definition: Definition): Property => ({
  key: 'yieldTier',
  kind: 'enum',
  name: 'yield_tier',
  definition,
  chain: { required: false, readonly: false, managed: true },
  comments: [],
})

const file: ObjectExport = {
  name: 'Company',
  builder: 'defineObject',
  object: 'companies',
  comments: [],
  groups: [
    { name: 'orchard', label: 'Orchard', comments: [] },
    { name: 'plots', label: 'Plots', comments: [] },
  ],
  properties: [property(shared)],
}

const overrides: Record<string, Override> = {
  [tier]: {
    definition: {
      label: 'Yield band',
      description: '',
      options: [
        { value: 'peak', label: 'Peak' },
        { value: 'low', label: 'Low' },
      ],
    },
  },
  [orchard]: { definition: { label: 'Orchard (EU)' } },
}

function live(definition: Definition, groups: Record<string, string> = { orchard: 'Orchard (EU)', plots: 'Plots' }) {
  const p: LiveProperty = {
    name: 'yield_tier',
    kind: 'enum',
    type: 'enumeration',
    fieldType: definition.fieldType ?? 'select',
    hubspotDefined: false,
    calculated: false,
    reference: false,
    definition,
  }
  const object: LiveObject = {
    object: 'companies',
    archivedGroups: [],
    groups: new Map(Object.entries(groups)),
    meta: new Map(),
    members: new Map(),
    properties: [p],
    unsupported: [],
  }
  return object
}

// A pull of the target: the merge of the target's view, split back into the file and the target's overrides.
function pull(portal: LiveObject, local: ObjectExport = file, targetOverrides = overrides) {
  const merged = mergeObject({
    live: portal,
    scope: scopeOf({}),
    local: asTarget(local, targetOverrides),
    fresh: { name: 'Company', builder: 'defineObject' },
    only: addressMatcher(undefined),
    excluded: new Set(),
    targetOnly: targetOnly(local, targetOverrides),
  })
  return { merged, ...fromTarget(merged.export, local, targetOverrides) }
}

test('asTarget: the fields an override states replace the file ones; a group override its label', () => {
  const view = asTarget(file, overrides)
  expect(view.properties[0]?.definition).toEqual({
    ...shared,
    label: 'Yield band',
    description: '',
    options: [
      { value: 'peak', label: 'Peak' },
      { value: 'low', label: 'Low' },
    ],
  })
  expect(view.groups.map((g) => g.label)).toEqual(['Orchard (EU)', 'Plots'])
  // A skip wins, and a target with no overrides sees the file.
  expect(asTarget(file, { [tier]: { skip: true, definition: { label: 'Yield band' } } })).toEqual(file)
  expect(asTarget(file, {})).toEqual(file)
})

test('a portal equal to the override, its empty description left out as HubSpot does, changes nothing', () => {
  const portal = live({
    label: 'Yield band',
    group: 'orchard',
    fieldType: 'select',
    options: [
      { value: 'peak', label: 'Peak' },
      { value: 'low', label: 'Low' },
    ],
  })
  const { merged, export: next, overrides: changed } = pull(portal)
  expect(changed).toEqual({})
  expect(next).toEqual(file)
  expect(merged.changes.filter((c) => c.kind === 'changed')).toEqual([])
})

test('an overridden field takes the portal value into the override; the file keeps its own, others follow the portal', () => {
  const portal = live({
    label: 'Yield grade',
    group: 'plots',
    fieldType: 'select',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'mid', label: 'Mid' },
      { value: 'peak', label: 'Peak' },
    ],
  })
  const { merged, export: next, overrides: changed } = pull(portal)
  // label and options are the override's: the portal's go there, options in portal order and no alias added.
  expect(changed).toEqual({
    [tier]: {
      definition: {
        label: 'Yield grade',
        description: '',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'mid', label: 'Mid' },
          { value: 'peak', label: 'Peak' },
        ],
      },
    },
  })
  // group is not overridden: the shared file takes the portal's. The rest of the file stays as written.
  expect(next.properties[0]?.definition).toEqual({ ...shared, group: 'plots' })
  expect(next.groups.map((g) => [g.name, g.label])).toEqual([
    ['orchard', 'Orchard'],
    ['plots', 'Plots'],
  ])
  expect(merged.changes.filter((c) => c.kind === 'changed' || c.kind === 'added').map((c) => c.field)).toEqual([
    'label',
    'group',
    'options[mid]',
  ])
})

test('an owned empty description, an empty option list and a group label stay in the override', () => {
  const emptied: Record<string, Override> = {
    [tier]: { definition: { description: '', options: [] } },
    [orchard]: { definition: { label: 'Orchard (EU)' } },
  }
  const portal = live(
    { label: 'Yield tier', group: 'orchard', fieldType: 'select' },
    { orchard: 'Grove', plots: 'Plots' },
  )
  const { export: next, overrides: changed } = pull(portal, file, emptied)
  expect(changed).toEqual({ [orchard]: { definition: { label: 'Grove' } } })
  expect(next.groups.find((g) => g.name === 'orchard')?.label).toBe('Orchard')
  // The file's description and options stay: the override states them.
  expect(next.properties[0]?.definition).toEqual(shared)
})

test('a field the file leaves to the portal stays left out when the override states it', () => {
  const bare: Definition = { label: 'Yield tier', group: 'orchard', fieldType: 'select' }
  const local = { ...file, properties: [property(bare)] }
  const only: Record<string, Override> = { [tier]: { definition: { description: '' } } }
  const portal = live({ ...bare, description: 'Written in HubSpot' })
  const { export: next, overrides: changed } = pull(portal, local, only)
  expect(changed).toEqual({ [tier]: { definition: { description: 'Written in HubSpot' } } })
  expect(next.properties[0]?.definition).toEqual(bare)
})

test('an override with other keys keeps them, and another address is untouched', () => {
  const named: Record<string, Override> = { [tier]: { name: 'yield_tier', definition: { label: 'Yield band' } } }
  const portal = live({ label: 'Yield grade', group: 'orchard', fieldType: 'select' })
  expect(pull(portal, file, named).overrides).toEqual({
    [tier]: { name: 'yield_tier', definition: { label: 'Yield grade' } },
  })
})

// The portal side of the file's yield_tier, as HubSpot holds it: no alias, the given group.
function portalTier(group: string): Definition {
  return {
    label: 'Yield tier',
    group,
    fieldType: 'select',
    description: 'Set by the yield sync',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'HIGH', label: 'High' },
    ],
  }
}

test('targetOnly: whether the override states the group, and the fields only its own lifecycle ignores', () => {
  const only = targetOnly(file, {
    [tier]: {
      definition: {
        label: 'Yield band',
        group: 'plots',
        lifecycle: { ignoreChanges: ['label', 'description', 'options'] },
      },
    },
  })
  // label is stated in the override, description ignored by the shared lifecycle too: options alone is left.
  expect(only(tier)).toEqual({ group: true, ignored: ['options'] })
  expect(only('property:companies/yield_band')).toBeUndefined()
  expect(targetOnly(file, { [tier]: { skip: true, definition: { group: 'plots' } } })(tier)).toBeUndefined()
  expect(targetOnly(file, { [tier]: { definition: { label: 'Yield band' } } })(tier)).toEqual({
    group: false,
    ignored: [],
  })
})

test('a field only the target lifecycle ignores keeps the file value, noted once, whatever the portal holds', () => {
  const ignoring: Record<string, Override> = {
    [tier]: { definition: { lifecycle: { ignoreChanges: ['label', 'options'] } } },
  }
  const portal = live(
    {
      ...portalTier('orchard'),
      label: 'Yield grade',
      options: [
        { value: 'low', label: 'Lower' },
        { value: 'mid', label: 'Mid' },
      ],
    },
    { orchard: 'Orchard', plots: 'Plots' },
  )
  const { merged, export: next, overrides: changed } = pull(portal, file, ignoring)
  expect(changed).toEqual({})
  expect(next).toEqual(file)
  expect(merged.changes).toEqual([
    { kind: 'ignored', address: tier, field: 'label' },
    { kind: 'ignored', address: tier, field: 'options' },
  ])
  expect(merged.counts).toEqual({ added: 0, changed: 0, unchanged: 3, missing: 0 })
})

test('a property whose group the override states keeps it when HubSpot moves it into a group the file lacks', () => {
  const grouped: Record<string, Override> = { [tier]: { definition: { group: 'plots' } } }
  const groups = { orchard: 'Orchard', plots: 'Plots', yard: 'Yard' }
  const moved = pull(live(portalTier('yard'), groups), file, grouped)
  // No shared group is added for one target: the override and the file stay, and the note is a difference.
  expect(moved.overrides).toEqual({})
  expect(moved.export).toEqual(file)
  expect(moved.merged.changes).toEqual([
    { kind: 'override-group', address: tier, field: 'group', before: 'plots', after: 'yard' },
  ])
  // A group the file has goes into the override as usual.
  const kept = pull(live(portalTier('orchard'), groups), file, grouped)
  expect(kept.overrides).toEqual({ [tier]: { definition: { group: 'orchard' } } })
  expect(kept.export).toEqual(file)
})
