// The re-pull merge of the associations file: the portal's labels over the file's, the keys and comments the file
// holds, a base that keeps a config change, what pull adds and what it leaves, and a target's label override.
import type { Override } from '@kalup/core'
import { expect, test } from 'vitest'
import type { AssociationEntry } from '../../../src/grammar/types.js'
import {
  type AssociationMergeInput,
  type LiveAssociation,
  mergeAssociations,
} from '../../../src/lib/pull/associations.js'
import { associationAsTarget, associationFromTarget } from '../../../src/lib/pull/overrides.js'

const grower = 'association:companies/contacts/orchard_grower'

const entry: AssociationEntry = {
  key: 'grower',
  from: 'companies',
  to: 'contacts',
  name: 'orchard_grower',
  label: 'Grower',
  comments: ['// The grower who supplies the orchard.'],
}

// The grower label as HubSpot holds it, pair order companies before contacts.
function live(labels: [string | null, string | null], name = 'orchard_grower'): LiveAssociation {
  return { a: 'companies', b: 'contacts', name, labels, typeIds: [9001, 9002] }
}

function input(over: Partial<AssociationMergeInput>): AssociationMergeInput {
  return {
    adds: () => false,
    excluded: new Set(),
    found: [],
    ir: { resources: { [grower]: { type: 'association', managed: true } }, tombstones: {} },
    // As pull passes them: the target's view, the inverse label filled in.
    local: [associationAsTarget(entry, {})],
    only: () => true,
    pairs: [{ a: 'companies', b: 'contacts', status: 'read' }],
    ...over,
  }
}

test('the portal labels replace the file labels, and the key and comments stay', () => {
  const merged = mergeAssociations(input({ found: [live(['Orchard grower', 'Grows for'])] }))
  expect(merged.entries).toEqual([{ ...entry, label: 'Orchard grower', inverseLabel: 'Grows for' }])
  expect(merged.reports.get('companies')).toEqual({
    counts: { added: 0, changed: 1, unchanged: 0, missing: 0 },
    changes: [
      { kind: 'changed', address: grower, field: 'label', before: 'Grower', after: 'Orchard grower' },
      { kind: 'changed', address: grower, field: 'inverseLabel', before: 'Grower', after: 'Grows for' },
    ],
  })
})

test('a file label that agrees is unchanged', () => {
  const merged = mergeAssociations(input({ found: [live(['Grower', 'Grower'])] }))
  expect(merged.reports.get('companies')?.counts).toEqual({ added: 0, changed: 0, unchanged: 1, missing: 0 })
  expect(merged.entries).toEqual([{ ...entry, inverseLabel: 'Grower' }])
})

test('a base that holds a config change keeps the file label unless --accept takes the portal one', () => {
  const units = [{ unit: 'label', class: 'config-change' as const, desired: 'Grower', observed: 'Old grower' }]
  const kept = mergeAssociations(
    input({ found: [live(['Old grower', 'Grower'])], resolve: () => ({ units, accept: () => false }) }),
  )
  expect(kept.entries[0]?.label).toBe('Grower')
  expect(kept.reports.get('companies')?.changes).toEqual([
    { kind: 'kept', address: grower, field: 'label', before: 'Grower', after: 'Old grower' },
  ])
  const taken = mergeAssociations(
    input({ found: [live(['Old grower', 'Grower'])], resolve: () => ({ units, accept: () => true }) }),
  )
  expect(taken.entries[0]?.label).toBe('Old grower')
})

test('an entry HubSpot no longer holds stays, reported missing; one on an unread pair stays unreported', () => {
  const missing = mergeAssociations(input({}))
  expect(missing.entries).toEqual([{ ...entry, inverseLabel: 'Grower' }])
  expect(missing.reports.get('companies')?.changes).toEqual([{ kind: 'missing', address: grower }])
  const unread = mergeAssociations(input({ pairs: [{ a: 'companies', b: 'contacts', status: 'unreadable' }] }))
  expect(unread.entries).toEqual([{ ...entry, inverseLabel: 'Grower' }])
  expect(unread.reports.size).toBe(0)
})

test('a portal-only association is added in pair order only when an object of the pair sets associations', () => {
  const crew = live(['Crew', 'Crew'], 'orchard_crew')
  const plain = live([null, null], 'companies_to_contacts')
  expect(mergeAssociations(input({ found: [crew] })).entries).toHaveLength(1)
  const merged = mergeAssociations(input({ adds: () => true, found: [crew, plain] }))
  expect(merged.entries).toEqual([
    { ...entry, inverseLabel: 'Grower' },
    { key: 'companiesToContacts', from: 'companies', to: 'contacts', name: 'companies_to_contacts', comments: [] },
    {
      key: 'orchardCrew',
      from: 'companies',
      to: 'contacts',
      name: 'orchard_crew',
      label: 'Crew',
      inverseLabel: 'Crew',
      comments: [],
    },
  ])
  expect(merged.reports.get('companies')?.counts.added).toBe(2)
})

test('a portal-only association removed.ts names, or on an object it names, is not written back', () => {
  const crew = live(['Crew', 'Crew'], 'orchard_crew')
  const tombstoned = mergeAssociations(
    input({ adds: () => true, found: [crew], removed: new Set(['association:companies/contacts/orchard_crew']) }),
  )
  expect(tombstoned.entries).toHaveLength(1)
  expect(tombstoned.reports.get('companies')?.changes).toContainEqual({
    kind: 'removed',
    address: 'association:companies/contacts/orchard_crew',
  })
  const objectGone = mergeAssociations(
    input({ adds: () => true, local: [], found: [crew], removed: new Set(['object:contacts']) }),
  )
  expect(objectGone.entries).toEqual([])
})

test('a label config names from the other side is merged in that direction', () => {
  const back: AssociationEntry = {
    ...entry,
    from: 'contacts',
    to: 'companies',
    label: 'Supplies',
    inverseLabel: 'Grower',
  }
  const address = 'association:contacts/companies/orchard_grower'
  const merged = mergeAssociations(
    input({
      ir: { resources: { [address]: { type: 'association', managed: true } }, tombstones: {} },
      local: [back],
      found: [live(['Grower', 'Supplies'])],
    }),
  )
  expect(merged.entries).toEqual([back])
  expect(merged.reports.get('contacts')?.counts.unchanged).toBe(1)
})

test('a label the target overrides is merged into the override, and the file keeps its own', () => {
  const overrides: Record<string, Override> = { [grower]: { definition: { label: 'Producer' } } }
  const seen = associationAsTarget(entry, overrides)
  expect(seen).toEqual({ ...entry, label: 'Producer', inverseLabel: 'Grower' })
  const merged = mergeAssociations(input({ local: [seen], found: [live(['Fruit producer', 'Grower'])] }))
  const split = associationFromTarget(merged.entries[0] as AssociationEntry, entry, overrides)
  expect(split.entry).toEqual({ ...entry, inverseLabel: 'Grower' })
  expect(split.overrides).toEqual({ [grower]: { definition: { label: 'Fruit producer' } } })
})
