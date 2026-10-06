// Association labels through plan and the executor against the simulator: a label create and the type IDs state
// records for it, a name HubSpot's schema read does not list yet, the plain association created before the labels of its
// pair, the update that sends both labels, the deletes and their order, and HubSpot's cap of 50 labels per pair.

import { expect, test } from 'vitest'
import { executePlan } from '../../src/engine/apply.js'
import type { TargetState } from '../../src/ir/state.js'
import type { SimAssociationInput, SimPortalInput } from '../support/portal-sim.js'
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
const VISIT = 'hubspot/objects/orchard_visit.ts'
const labels = '/crm/associations/2026-09/companies/contacts/labels'
const grower = 'association:companies/contacts/orchard_grower'
const visited = 'association:orchard_visit/companies/visited_orchard'
const host = 'association:orchard_visit/companies/orchard_host'

const withContacts: Edit = [files.config, 'companies: {},', 'companies: {},\n    contacts: {},\n    orchard_visit: {},']

// The associations config holds, one entry per line.
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

const growerEntry =
  "grower: { from: 'companies', to: 'contacts', name: 'orchard_grower', label: 'Grower', inverseLabel: 'Grows for' }"
const visitedEntry = "visited: { from: 'orchard_visit', to: 'companies', name: 'visited_orchard' }"
const hostEntry = "host: { from: 'orchard_visit', to: 'companies', name: 'orchard_host', label: 'Host' }"

// A custom object with nothing but its labels and the display property HubSpot gives it.
const visitFile = [
  "import { defineCustomObject } from '@kalup/core'",
  '',
  "export const OrchardVisit = defineCustomObject('orchard_visit', {",
  "  labels: { singular: 'Orchard visit', plural: 'Orchard visits' },",
  "  primaryDisplayProperty: 'hs_object_id',",
  '})',
  '',
].join('\n')

function project(text = associationsFile(growerEntry), more: Record<string, string> = {}) {
  return loadProject([withContacts], { [VISIT]: visitFile, [ASSOCIATIONS]: text, ...more })
}

const visitType = '2-4242501'

// The sandbox portal holding the fixture's company group and property and the visit object, plus `associations`.
function portal(associations: SimAssociationInput[] = [], extra: Partial<SimPortalInput> = {}) {
  return simPortal(
    { groups: [orchardGroup], properties: [soilPhProperty] },
    {
      schemas: [
        {
          name: 'orchard_visit',
          objectTypeId: visitType,
          labels: { singular: 'Orchard visit', plural: 'Orchard visits' },
          primaryDisplayProperty: 'hs_object_id',
          requiredProperties: [],
          searchableProperties: [],
          secondaryDisplayProperties: [],
        },
      ],
      objects: {
        [visitType]: {
          groups: [{ name: 'orchard_visit_information', label: 'Orchard visit information' }],
          properties: [
            {
              name: 'hs_object_id',
              type: 'number',
              fieldType: 'number',
              groupName: 'orchard_visit_information',
              hubspotDefined: true,
            },
          ],
        },
      },
      associations,
      ...extra,
    },
  )
}

// State that owns the fixture's company resources and the visit object, agreeing with `portal`, and `resources`.
function state(resources: TargetState['resources'] = {}): TargetState {
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
      'object:orchard_visit': {
        origin: 'created',
        id: 'orchard_visit',
        normVersion: 1,
        base: {
          labels: { plural: 'Orchard visits', singular: 'Orchard visit' },
          primaryDisplayProperty: 'hs_object_id',
        },
      },
      ...resources,
    },
  }
}

// The grower label as HubSpot holds it once applied.
const liveGrower: SimAssociationInput = {
  from: 'companies',
  to: 'contacts',
  name: 'orchard_grower',
  label: 'Grower',
  inverseLabel: 'Grows for',
  typeIds: [9001, 9002],
}

const ownedGrower: TargetState['resources'] = {
  [grower]: {
    origin: 'created',
    id: 'orchard_grower',
    normVersion: 1,
    base: { inverseLabel: 'Grows for', label: 'Grower' },
    typeIds: [9001, 9002],
  },
}

function writes(sim: ReturnType<typeof portal>, from = 0): [string, string, unknown][] {
  return sim.log
    .slice(from)
    .filter((r) => r.method !== 'GET')
    .map((r) => [r.method, r.path, r.body])
}

test('a label create sends its name and both labels, and state records its type IDs', async () => {
  const sim = portal()
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(), state())
  expect(plan.steps).toMatchObject([
    {
      address: grower,
      action: 'create',
      risk: 'safe',
      desired: { label: 'Grower', inverseLabel: 'Grows for' },
      expect: { exists: false },
    },
  ])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['done'])
  expect(writes(sim)).toEqual([
    ['POST', labels, { name: 'orchard_grower', label: 'Grower', inverseLabel: 'Grows for' }],
  ])
  const saved = h.deps.store.read(portalId) as TargetState
  const [typeId] = sim.portal(portalId).associations.find((a) => a.name === 'orchard_grower')?.typeIds ?? []
  expect(saved.resources[grower]).toEqual({
    origin: 'created',
    id: 'orchard_grower',
    normVersion: 1,
    base: { inverseLabel: 'Grows for', label: 'Grower' },
    typeIds: [typeId, (typeId ?? 0) + 1],
  })
  expect((await planOn(sim, project(), saved)).steps).toEqual([])
})

test('a label whose name the schema read does not list yet is found by the type IDs the create answered with', async () => {
  // Observed 2026-10-05: the schema read lists a new name only minutes after the create.
  const sim = portal([], { associationNameLag: 100 })
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const applied = await executePlan(request(await planOn(sim, project(), state())), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['done'])
  const saved = h.deps.store.read(portalId) as TargetState
  expect(saved.resources[grower]?.typeIds).toHaveLength(2)
  // The next plan names the label by the type IDs state records, while the schema read still leaves its name out.
  expect((await planOn(sim, project(), saved)).steps).toEqual([])
})

test('a label update sends both labels on the type of its direction', async () => {
  const sim = portal([liveGrower])
  const h = await harness(sim)
  h.deps.store.write(state(ownedGrower), null)
  const text = associationsFile(growerEntry.replace("label: 'Grower'", "label: 'Orchard grower'"))
  const plan = await planOn(sim, project(text), state(ownedGrower))
  expect(plan.steps).toMatchObject([
    {
      address: grower,
      action: 'update',
      changes: [{ unit: 'label', before: 'Grower', after: 'Orchard grower' }],
      expect: { exists: true, values: { label: 'Grower' } },
    },
  ])
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['done'])
  expect(writes(sim, from)).toEqual([
    ['PUT', labels, { associationTypeId: 9001, label: 'Orchard grower', inverseLabel: 'Grows for' }],
  ])
  const saved = h.deps.store.read(portalId) as TargetState
  expect(saved.resources[grower]).toEqual({
    ...ownedGrower[grower],
    base: { inverseLabel: 'Grows for', label: 'Orchard grower' },
  })
})

test('a plain association is created before the labels of its pair, so HubSpot makes no plain one of its own', async () => {
  const sim = portal()
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const text = associationsFile(hostEntry, visitedEntry)
  const plan = await planOn(sim, project(text), state())
  expect(plan.steps.map((s) => [s.address, s.action])).toEqual([
    [host, 'create'],
    [visited, 'create'],
  ])
  expect(plan.steps.flatMap((s) => s.notes ?? [])).toEqual([])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => [s.address, s.outcome])).toEqual([
    [host, 'done'],
    [visited, 'done'],
  ])
  const path = `/crm/associations/2026-09/${visitType}/companies/labels`
  expect(writes(sim)).toEqual([
    ['POST', path, { name: 'visited_orchard', label: '' }],
    ['POST', path, { name: 'orchard_host', label: 'Host', inverseLabel: 'Host' }],
  ])
  expect(sim.portal(portalId).associations.map((a) => a.name)).toEqual(['visited_orchard', 'orchard_host'])
})

test('a label on a custom pair with no plain association notes the one HubSpot makes, and records only its own types', async () => {
  const sim = portal()
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(associationsFile(hostEntry)), state())
  expect(plan.steps.flatMap((s) => (s.notes ?? []).map((n) => n.note))).toEqual([
    'HubSpot also makes the plain association between orchard_visit and companies, under a name of its own, which pull writes when either object sets associations: true',
  ])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['done'])
  const made = sim.portal(portalId).associations
  expect(made.map((a) => [a.name, a.labels])).toEqual([
    ['orchard_host', ['Host', 'Host']],
    [`companies_to_${visitType}`, [null, null]],
  ])
  const saved = h.deps.store.read(portalId) as TargetState
  expect(saved.resources[host]?.typeIds).toEqual(made[0]?.typeIds)
})

// The project with `addresses` destroyed in removed.ts on a target that allows deletes, and `entries` in config.
function destroying(addresses: string[], ...entries: string[]) {
  const removed = [
    "import { defineRemoved } from '@kalup/core'",
    '',
    `export default defineRemoved({\n${addresses.map((a) => `  '${a}': { action: 'destroy' },`).join('\n')}\n})`,
    '',
  ].join('\n')
  const destroy: Edit = [
    files.config,
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      allowDestroy: true,",
  ]
  const more: Record<string, string> = { [VISIT]: visitFile, [REMOVED]: removed }
  if (entries.length > 0) {
    more[ASSOCIATIONS] = associationsFile(...entries)
  }
  return loadProject([withContacts, destroy], more)
}

test('a label tombstone deletes the label by the type of its direction, and state drops it', async () => {
  const sim = portal([liveGrower])
  const h = await harness(sim)
  const owned = state(ownedGrower)
  h.deps.store.write(owned, null)
  const plan = await planOn(sim, destroying([grower]), owned)
  expect(plan.steps).toMatchObject([
    { address: grower, action: 'delete', risk: 'destructive', expect: { exists: true, values: { label: 'Grower' } } },
  ])
  const from = sim.log.length
  const applied = await executePlan(request(plan, 'terminal'), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['done'])
  expect(writes(sim, from)).toEqual([['DELETE', `${labels}/9001`, undefined]])
  expect(sim.portal(portalId).associations).toEqual([])
  expect((h.deps.store.read(portalId) as TargetState).resources[grower]).toBeUndefined()
})

// The visit object's plain association with companies and its host label, as HubSpot holds them, and owned.
const livePair: SimAssociationInput[] = [
  { from: visitType, to: 'companies', name: 'visited_orchard', typeIds: [9001, 9002] },
  { from: visitType, to: 'companies', name: 'orchard_host', label: 'Host', typeIds: [9003, 9004] },
]
const ownedPair: TargetState['resources'] = {
  [visited]: { origin: 'created', id: 'visited_orchard', normVersion: 1, typeIds: [9001, 9002] },
  [host]: {
    origin: 'created',
    id: 'orchard_host',
    normVersion: 1,
    base: { inverseLabel: 'Host', label: 'Host' },
    typeIds: [9003, 9004],
  },
}

test('a plain association delete is blocked while a label of its pair remains', async () => {
  const plan = await planOn(portal(livePair), destroying([visited], hostEntry), state(ownedPair))
  expect(plan.steps).toMatchObject([
    {
      address: visited,
      action: 'delete',
      risk: 'blocked',
      blocked: {
        reason: 'unsupported',
        detail: `HubSpot keeps the plain association while a label of its pair remains: ${host}`,
      },
    },
  ])
})

test('the labels of a pair are deleted before its plain association', async () => {
  const sim = portal(livePair)
  const h = await harness(sim)
  h.deps.store.write(state(ownedPair), null)
  const plan = await planOn(sim, destroying([visited, host]), state(ownedPair))
  expect(plan.steps.map((s) => [s.address, s.action, s.risk])).toEqual([
    [host, 'delete', 'destructive'],
    [visited, 'delete', 'destructive'],
  ])
  const from = sim.log.length
  const applied = await executePlan(request(plan, 'terminal'), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['done', 'done'])
  const path = `/crm/associations/2026-09/${visitType}/companies/labels`
  expect(writes(sim, from)).toEqual([
    ['DELETE', `${path}/9003`, undefined],
    ['DELETE', `${path}/9001`, undefined],
  ])
  const saved = h.deps.store.read(portalId) as TargetState
  expect([saved.resources[visited], saved.resources[host]]).toEqual([undefined, undefined])
})

test('a label create past HubSpot cap of 50 labels per pair is refused, and state records nothing', async () => {
  const full = Array.from(
    { length: 50 },
    (_, i): SimAssociationInput => ({ from: 'companies', to: 'contacts', name: `orchard_l${i}`, label: `L${i}` }),
  )
  const sim = portal(full)
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(), state())
  // The reading only warns, as HubSpot counts a deleted label for up to 40 s: the create stays in the plan.
  expect(plan.preflight.limits).toEqual([
    { key: 'association-labels/companies/contacts', status: 'read', limit: 50, usage: 50 },
  ])
  expect(plan.steps).toMatchObject([{ address: grower, action: 'create', risk: 'safe' }])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['rejected'])
  expect(applied.issues).toEqual([
    {
      code: 'E_HTTP',
      message:
        's1 Create association label "Grower" (orchard_grower) between companies and contacts was refused (VALIDATION_ERROR): HubSpot holds at most 50 labels between companies and contacts, and the pair has 50',
      fix: 'delete a label of the pair that nothing uses, then run kalup plan --target sandbox',
    },
  ])
  expect((h.deps.store.read(portalId) as TargetState).resources[grower]).toBeUndefined()
})

test('an adopted label records its type IDs, and the run reads the schema names of its object once', async () => {
  const sim = portal([liveGrower])
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(), state())
  expect(plan.steps).toMatchObject([{ address: grower, action: 'adopt' }])
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['done'])
  const schemaReads = sim.log.slice(from).filter((r) => r.path === '/crm-object-schemas/2026-09/schemas/companies')
  expect(schemaReads).toHaveLength(1)
  expect((h.deps.store.read(portalId) as TargetState).resources[grower]).toEqual({
    ...ownedGrower[grower],
    origin: 'adopted',
  })
})
