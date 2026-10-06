// An association's identity is its name, never the direction its address is written in: an entry rewritten from the
// other side is the same HubSpot label. State follows the new address, plan neither adopts it nor calls the old address
// an orphan, a tombstone on the old address is refused while config holds the name, and apply refuses a delete config
// still holds under the other direction.
import { expect, test } from 'vitest'
import { executePlan } from '../../src/engine/apply.js'
import { checkDeletes } from '../../src/engine/apply-check.js'
import type { TargetState } from '../../src/ir/state.js'
import { liveAssociation } from '../../src/lib/pull/associations.js'
import type { SimAssociationInput } from '../support/portal-sim.js'
import {
  type Edit,
  files,
  harness,
  loadProject,
  orchardGroup,
  planOn,
  portalId,
  request,
  simPortal,
  soilPhProperty,
} from './apply-harness.js'

const ASSOCIATIONS = 'hubspot/associations.ts'
const REMOVED = 'hubspot/removed.ts'
const withContacts: Edit = [files.config, 'companies: {},', 'companies: {},\n    contacts: {},']
const allow: Edit = [
  files.config,
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      allowDestroy: true,",
]

function associationsFile(...entries: string[]): string {
  return [
    "import { defineAssociations } from '@kalup/core'",
    '',
    'export const Associations = defineAssociations({',
    ...entries.map((e) => `  ${e},`),
    '})',
    '',
  ].join('\n')
}

function removedFile(...addresses: string[]): string {
  const lines = addresses.map((a) => `  '${a}': { action: 'destroy' },`).join('\n')
  return ["import { defineRemoved } from '@kalup/core'", '', `export default defineRemoved({\n${lines}\n})`, ''].join(
    '\n',
  )
}

const forward = 'association:companies/contacts/orchard_grower'
const flipped = 'association:contacts/companies/orchard_grower'
const forwardEntry =
  "grower: { from: 'companies', to: 'contacts', name: 'orchard_grower', label: 'Grower', inverseLabel: 'Grows for' }"
// The same label, written from the other side.
const flippedEntry =
  "grower: { from: 'contacts', to: 'companies', name: 'orchard_grower', label: 'Grows for', inverseLabel: 'Grower' }"

const live: SimAssociationInput = {
  from: 'companies',
  to: 'contacts',
  name: 'orchard_grower',
  label: 'Grower',
  inverseLabel: 'Grows for',
  typeIds: [9001, 9002],
}

function portal() {
  return simPortal({ groups: [orchardGroup], properties: [soilPhProperty] }, { associations: [live] })
}

function state(resources: TargetState['resources']): TargetState {
  return {
    format: 'kalup.state/1',
    lineage: '0a1b2c3d4e5f6071',
    serial: 3,
    portalId,
    resources: {
      'group:companies/orchard': { origin: 'created', id: 'orchard', normVersion: 1, base: { label: 'Orchard' } },
      'property:companies/soil_ph': {
        origin: 'created',
        id: 'soil_ph',
        normVersion: 1,
        base: { fieldType: 'number', group: { $ref: 'group:companies/orchard' }, label: 'Soil pH', type: 'number' },
      },
      ...resources,
    },
  }
}

const ownedForward = state({
  [forward]: {
    origin: 'created',
    id: 'orchard_grower',
    normVersion: 1,
    base: { inverseLabel: 'Grows for', label: 'Grower' },
    typeIds: [9001, 9002],
  },
})
const ownedFlipped = state({
  [flipped]: {
    origin: 'created',
    id: 'orchard_grower',
    normVersion: 1,
    base: { inverseLabel: 'Grower', label: 'Grows for' },
    typeIds: [9002, 9001],
  },
})

test.each([
  ['flipped', ownedForward, flippedEntry],
  ['forward', ownedFlipped, forwardEntry],
])('an entry rewritten to the %s direction is the same label: no step, no orphan', async (_, owned, entry) => {
  const plan = await planOn(portal(), loadProject([withContacts], { [ASSOCIATIONS]: associationsFile(entry) }), owned)
  expect(plan.steps).toEqual([])
  expect(plan.orphans).toEqual([])
  expect(plan.missing).toEqual([])
})

test('an apply after the rewrite moves the state entry to the new address, its labels and type IDs swapped', async () => {
  const sim = portal()
  const h = await harness(sim)
  h.deps.store.write(ownedForward, null)
  const relabelled = associationsFile(flippedEntry.replace("label: 'Grows for'", "label: 'Grows fruit for'"))
  const plan = await planOn(sim, loadProject([withContacts], { [ASSOCIATIONS]: relabelled }), ownedForward)
  expect(plan.steps).toMatchObject([{ address: flipped, action: 'update', changes: [{ unit: 'label' }] }])
  expect((await executePlan(request(plan), h.deps)).exitCode).toBe(0)
  const saved = h.deps.store.read(portalId) as TargetState
  expect(Object.keys(saved.resources).filter((a) => a.startsWith('association:'))).toEqual([flipped])
  expect(saved.resources[flipped]).toEqual({
    origin: 'created',
    id: 'orchard_grower',
    normVersion: 1,
    base: { inverseLabel: 'Grower', label: 'Grows fruit for' },
    typeIds: [9002, 9001],
  })
})

test('a tombstone on the other direction of an association config holds is E_TOMBSTONE_CONFLICT', () => {
  const both = { [ASSOCIATIONS]: associationsFile(flippedEntry), [REMOVED]: removedFile(forward) }
  expect(() => loadProject([withContacts, allow], both)).toThrow(
    `E_TOMBSTONE_CONFLICT: ${forward} is in hubspot/removed.ts, and config holds orchard_grower as ${flipped}`,
  )
})

test('apply refuses a delete of a label config holds under the other direction', async () => {
  const removing = loadProject([withContacts, allow], { [REMOVED]: removedFile(forward) })
  const plan = await planOn(portal(), removing, ownedForward)
  expect(plan.steps.map((s) => [s.address, s.action])).toEqual([[forward, 'delete']])
  const holding = loadProject([withContacts, allow], { [ASSOCIATIONS]: associationsFile(flippedEntry) })
  expect(() => checkDeletes(plan, holding)).toThrow(`which config still holds as ${flipped}`)
})

test('a tombstone never decides the direction of an association config holds', () => {
  const found = { a: 'companies', b: 'contacts', name: 'orchard_grower', labels: ['Grower', 'Grows for'] as const }
  const ir = {
    resources: { [flipped]: { type: 'association', managed: true } },
    tombstones: { [forward]: { action: 'destroy' as const } },
  }
  expect(liveAssociation(ir, { ...found, labels: ['Grower', 'Grows for'], typeIds: [9001, 9002] }).address).toBe(
    flipped,
  )
})
