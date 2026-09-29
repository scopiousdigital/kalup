// The upgrade merge on one resource: base (the stored original), local (config) and remote (the new version), unit by
// unit, options by value.

import { expect, test } from 'vitest'
import type { BlueprintResource } from '../../../src/blueprint/types.js'
import type { IROption, IRResource } from '../../../src/ir/types.js'
import { mergeResource, toIR, unitsOf } from '../../../src/lib/blueprint/merge.js'

const option = (value: string, label: string): IROption => ({ value, label })

function stage(label: string, options: IROption[], aliases: Record<string, string> = {}): BlueprintResource {
  return {
    type: 'property',
    definition: { label, group: { $ref: 'group:deals/renewal' }, type: 'enumeration', fieldType: 'select', options },
    binding: { key: 'renewalStage', codec: 'enum', ...(Object.keys(aliases).length > 0 ? { aliases } : {}) },
  }
}

const base = stage('Renewal stage', [option('open', 'Open'), option('won', 'Won'), option('lost', 'Lost')], {
  won: 'renewed',
})

function merge(local: BlueprintResource, remote: BlueprintResource, take: string[] = [], held: string[] = []) {
  return mergeResource({
    local: toIR(local),
    base: unitsOf(base),
    remote: unitsOf(remote),
    held: new Set(held),
    take: (unit) => take.includes(unit),
  })
}

const definition = (r: IRResource) => r.definition as { label: string; options: IROption[] }

test('local equal to base takes remote; remote equal to base keeps local; both alike converge', () => {
  const remote = stage('Stage', base.definition.options as IROption[], { won: 'renewed' })
  const upstream = merge(base, remote)
  expect(upstream).toMatchObject({ updated: ['label'], kept: [], conflicts: [] })
  expect(definition(upstream.resource).label).toBe('Stage')
  const local = merge(remote, base)
  expect(local).toMatchObject({ updated: [], kept: ['label'], conflicts: [] })
  expect(local.resource).toEqual(toIR(remote))
  expect(merge(remote, remote)).toMatchObject({ updated: [], kept: [], converged: ['label'] })
})

test('both changed differently is a conflict that keeps local, unless taken; a held unit stays a conflict', () => {
  const local = stage('Phase', base.definition.options as IROption[], { won: 'renewed' })
  const remote = stage('Stage', base.definition.options as IROption[], { won: 'renewed' })
  const conflict = merge(local, remote)
  expect(conflict.conflicts).toEqual([{ unit: 'label', local: 'Phase', remote: 'Stage' }])
  expect(definition(conflict.resource).label).toBe('Phase')
  const taken = merge(local, remote, ['label'])
  expect(taken).toMatchObject({ conflicts: [], updated: ['label'] })
  expect(definition(taken.resource).label).toBe('Stage')
  // At the same version base equals remote: a held unit is a conflict until taken, not a local change.
  const again = mergeResource({
    local: toIR(local),
    base: unitsOf(remote),
    remote: unitsOf(remote),
    held: new Set(['label']),
    take: () => false,
  })
  expect(again.conflicts).toEqual([{ unit: 'label', local: 'Phase', remote: 'Stage' }])
})

test('options: added upstream is added, removed upstream is kept with a note, removed by the client stays removed', () => {
  const remote = stage('Renewal stage', [option('open', 'Open'), option('won', 'Won'), option('paused', 'Paused')], {
    won: 'renewed',
  })
  const local = stage('Renewal stage', [option('won', 'Won'), option('lost', 'Lost'), option('churned', 'Churned')], {
    won: 'renewed',
  })
  const merged = merge(local, remote)
  expect(merged.notes).toEqual([expect.stringContaining('upstream removed option lost')])
  expect(merged.updated).toEqual(['options[paused]'])
  expect(merged.kept).toEqual(['options[churned]', 'options[open]'])
  expect(definition(merged.resource).options.map((o) => o.value)).toEqual(['won', 'paused', 'lost', 'churned'])
  expect(merged.resource.binding?.aliases).toEqual({ won: 'renewed' })
})

test('an option upstream removed keeps its alias, so the value the app uses stays the same', () => {
  const remote = stage('Renewal stage', [option('open', 'Open'), option('lost', 'Lost')])
  const merged = merge(base, remote)
  expect(merged.notes).toEqual([expect.stringContaining('upstream removed option won')])
  expect(merged.updated).toEqual([])
  expect(merged.conflicts).toEqual([])
  expect(merged.resource.binding?.aliases).toEqual({ won: 'renewed' })
  // With another unit taken from upstream the resource is rebuilt, and the alias config holds is still there.
  const relabelled = merge(
    stage('Renewal stage', base.definition.options as IROption[], { won: 'closed' }),
    stage('Stage', [option('open', 'Open'), option('lost', 'Lost')]),
  )
  expect(relabelled.updated).toEqual(['label'])
  expect(relabelled.conflicts).toEqual([])
  expect(definition(relabelled.resource).options.map((o) => o.value)).toEqual(['open', 'won', 'lost'])
  expect(relabelled.resource.binding?.aliases).toEqual({ won: 'closed' })
})

test("an option's fields merge one by one, and an alias goes with the option config keeps", () => {
  const remote = stage('Renewal stage', [option('open', 'Open'), option('won', 'Renewed'), option('lost', 'Lost')], {
    won: 'renewed',
  })
  const local = stage(
    'Renewal stage',
    [option('open', 'Open'), { value: 'won', label: 'Won', hidden: true }, option('lost', 'Lost')],
    { won: 'renewed' },
  )
  const merged = merge(local, remote)
  expect(merged.updated).toEqual(['options[won].label'])
  expect(merged.kept).toEqual(['options[won].hidden'])
  expect(definition(merged.resource).options[1]).toEqual({ value: 'won', label: 'Renewed', hidden: true })
})

test('with no base, every unit the two sides hold differently is a conflict', () => {
  const local = stage('Renewal stage', [option('open', 'Open')])
  const merged = mergeResource({ local: toIR(local), remote: unitsOf(base), held: new Set(), take: () => false })
  // The alias names an option config does not keep, so it has nothing to differ on.
  expect(merged.conflicts.map((c) => c.unit)).toEqual(['options[won]', 'options[lost]'])
  expect(merged.resource).toEqual(toIR(local))
})

test('a group has one unit, its label', () => {
  const group = (label: string): BlueprintResource => ({ type: 'group', definition: { label } })
  const merged = mergeResource({
    local: toIR(group('Renewal')),
    base: unitsOf(group('Renewal')),
    remote: unitsOf(group('Renewals')),
    held: new Set(),
    take: () => false,
  })
  expect(merged.updated).toEqual(['label'])
  expect(merged.resource).toEqual({ type: 'group', managed: true, definition: { label: 'Renewals' } })
})
