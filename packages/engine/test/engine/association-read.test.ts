// What a read may and may not conclude about association labels: a schema read names a type ID by its direction, since
// HubSpot numbers its own types like user ones; a type no name reaches is unknown, never absent, so never a create, a
// release or a delete; a refused labels list leaves only its own pair unread; a skip on either object excludes the
// association; a pair with no user-defined type needs no schema read; and a create answered with types the pair held
// already is uncertain.
import { expect, test } from 'vitest'
import { executePlan } from '../../src/engine/apply.js'
import { parsePlan, stepTitle } from '../../src/engine/apply-check.js'
import { namesOf } from '../../src/engine/apply-observe.js'
import { writesHash } from '../../src/engine/digest.js'
import { observeTarget, statusOf } from '../../src/engine/observe.js'
import { stableStringify } from '../../src/ir/serialize.js'
import { associationIds, type TargetState } from '../../src/ir/state.js'
import { createHttp } from '../../src/lib/http.js'
import type { Plan, PlanStep } from '../../src/plan/types.js'
import { fault, type SimAssociationInput, type SimPortalInput } from '../support/portal-sim.js'
import {
  type Edit,
  files,
  harness,
  key,
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
const objects: Edit = [
  files.config,
  'companies: {},',
  'companies: {},\n    contacts: {},\n    deals: {},\n    orchard_visit: {},',
]
const allow: Edit = [
  files.config,
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      allowDestroy: true,",
]
const visitType = '2-4242501'
const visitFile = [
  "import { defineCustomObject } from '@kalup/core'",
  '',
  "export const OrchardVisit = defineCustomObject('orchard_visit', {",
  "  labels: { singular: 'Orchard visit', plural: 'Orchard visits' },",
  "  primaryDisplayProperty: 'hs_object_id',",
  '})',
  '',
].join('\n')

function associationsFile(...entries: string[]): string {
  const body = entries.map((e) => `  ${e},`)
  return [
    "import { defineAssociations } from '@kalup/core'",
    '',
    'export const Associations = defineAssociations({',
    ...body,
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

function project(entries: string[], more: Record<string, string> = {}, edits: Edit[] = []) {
  const extra: Record<string, string> = entries.length > 0 ? { [ASSOCIATIONS]: associationsFile(...entries) } : {}
  return loadProject([objects, ...edits], { [VISIT]: visitFile, ...extra, ...more })
}

const grower = 'association:companies/contacts/orchard_grower'
const visited = 'association:orchard_visit/companies/visited_orchard'
const fresh = 'association:orchard_visit/companies/fresh_label'
const growerEntry =
  "grower: { from: 'companies', to: 'contacts', name: 'orchard_grower', label: 'Grower', inverseLabel: 'Grows for' }"
const visitedEntry = "visited: { from: 'orchard_visit', to: 'companies', name: 'visited_orchard' }"
const freshEntry = "fresh: { from: 'orchard_visit', to: 'companies', name: 'fresh_label', label: 'Fresh' }"
const liveGrower: SimAssociationInput = {
  from: 'companies',
  to: 'contacts',
  name: 'orchard_grower',
  label: 'Grower',
  inverseLabel: 'Grows for',
  typeIds: [9001, 9002],
}

function portal(associations: SimAssociationInput[], extra: Partial<SimPortalInput> = {}) {
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

// A plan edited by hand, with the digest and ID its new content gives, as a hand-edited file would carry.
function rehashed(plan: Plan): Plan {
  const hash = writesHash(plan)
  const text = stableStringify({ ...plan, writesHash: hash, planId: `pl_${hash.slice(7, 19)}` })
  return parsePlan(text, 'plan.json', '0.0.0-test')
}

async function observe(sim: ReturnType<typeof portal>, loaded: ReturnType<typeof project>, owned = state()) {
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  return (await observeTarget(http, loaded, 'sandbox', { associationIds: associationIds(owned) })).observation
}

// A type of HubSpot's own between companies and deals that HubSpot numbered as the label's types (live runs,
// 2026-10-05: one test account held a user-defined 279 and a HubSpot-defined 279).
const sameNumbers: SimAssociationInput = {
  from: 'companies',
  to: 'deals',
  name: 'COMPANY_TO_DEAL_ORCHARD',
  category: 'HUBSPOT_DEFINED',
  typeIds: [9001, 9002],
}

test('a schema read names a type ID by its direction: a type of HubSpot numbered like a label hides nothing', async () => {
  const sim = portal([liveGrower, sameNumbers])
  const adopt = await planOn(sim, project([growerEntry]), state())
  expect(adopt.steps.map((s) => [s.address, s.action])).toEqual([[grower, 'adopt']])
  const removing = project([], { [REMOVED]: removedFile(grower) }, [allow])
  const owned = state({
    [grower]: {
      origin: 'created',
      id: 'orchard_grower',
      normVersion: 1,
      base: { label: 'Grower', inverseLabel: 'Grows for' },
    },
  })
  expect((await planOn(sim, removing, owned)).steps.map((s) => [s.address, s.action])).toEqual([[grower, 'delete']])
})

test('a type no name reaches is unknown, never absent: no create, no release, no delete beside it', async () => {
  const sim = portal([{ from: visitType, to: 'companies', name: 'fresh_label', label: 'Fresh', typeIds: [9101, 9102] }])
  sim.portal(portalId).hiddenNames.set(9101, 50)
  sim.portal(portalId).hiddenNames.set(9102, 50)
  const config = project([freshEntry])
  const observation = await observe(sim, config)
  expect(statusOf(observation, fresh)).toBe('unreadable')
  // Unknown on that pair, so the read is incomplete, and it says why: HubSpot has not named the type yet.
  expect(observation.coverage?.complete).toBe(false)
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  const { issues } = await observeTarget(http, config, 'sandbox', { associationIds: associationIds(state()) })
  expect(issues.map((i) => i.code)).toContain('W_SETTLING')
  const created = await planOn(sim, config, state())
  expect(created.steps).toMatchObject([
    {
      address: fresh,
      action: 'unknown',
      risk: 'blocked',
      blocked: {
        reason: 'settling',
        detail:
          'HubSpot lists 2 association types between orchard_visit and companies that its schema read does not name yet, and this association may be one of them',
      },
    },
  ])
  // A destroy tombstone on an entry state holds without its type IDs: never a release while the type may be it.
  const owned = state({ [fresh]: { origin: 'created', id: 'fresh_label', normVersion: 1, base: { label: 'Fresh' } } })
  const releasing = await planOn(sim, project([], { [REMOVED]: removedFile(fresh) }, [allow]), owned)
  expect(releasing.steps.map((s) => [s.address, s.action, s.risk])).toEqual([[fresh, 'unknown', 'blocked']])
})

test('a label HubSpot does not name yet keeps the plain association of its pair from a delete', async () => {
  const sim = portal([{ from: visitType, to: 'companies', name: 'visited_orchard', typeIds: [9001, 9002] }])
  const owned = state({
    [visited]: { origin: 'created', id: 'visited_orchard', normVersion: 1, typeIds: [9001, 9002] },
  })
  sim.portal(portalId).associations.push({
    category: 'USER_DEFINED',
    from: visitType,
    to: 'companies',
    name: 'fresh_label',
    labels: ['Fresh', 'Fresh'],
    typeIds: [9101, 9102],
  })
  sim.portal(portalId).hiddenNames.set(9101, 50)
  sim.portal(portalId).hiddenNames.set(9102, 50)
  const planned = await planOn(sim, project([], { [REMOVED]: removedFile(visited) }, [allow]), owned)
  expect(planned.steps).toMatchObject([
    {
      address: visited,
      risk: 'blocked',
      blocked: {
        reason: 'unsupported',
        detail:
          'HubSpot keeps the plain association while a label of its pair remains: 2 labels HubSpot does not name yet (type 9101, 9102)',
      },
    },
  ])
})

test('a labels list HubSpot refuses otherwise than with 403 leaves only its own pair unread', async () => {
  const sim = portal([liveGrower])
  sim.fault({ path: `/crm/associations/2026-09/${visitType}/companies/labels`, action: fault.status(400) })
  const config = project([growerEntry, visitedEntry])
  const observation = await observe(sim, config)
  expect(observation.coverage?.objects.orchard_visit?.associations?.with.companies).toEqual({
    status: 'unreadable',
    issue: 'E_HTTP',
  })
  expect(observation.coverage?.complete).toBe(false)
  expect(statusOf(observation, grower)).toBe('present')
  expect(statusOf(observation, visited)).toBe('unreadable')
  const plan = await planOn(sim, config, state())
  expect(plan.steps).toMatchObject([
    { address: grower, action: 'adopt' },
    {
      address: visited,
      action: 'unknown',
      risk: 'blocked',
      blocked: {
        detail:
          'HubSpot refused the labels list of orchard_visit and companies (E_HTTP), so what it holds there is unknown',
      },
    },
  ])
})

test('a 403 on one pair leaves the associations of the pairs that were read as read', async () => {
  const sim = portal([liveGrower])
  sim.fault({ path: `/crm/associations/2026-09/${visitType}/companies/labels`, action: fault.status(403) })
  const observation = await observe(sim, project([growerEntry, visitedEntry]))
  expect(statusOf(observation, grower)).toBe('present')
  expect(statusOf(observation, visited)).toBe('unreadable')
})

test('a skip override on either object of a pair excludes its associations', async () => {
  const skip: Edit = [
    files.config,
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: { 'object:orchard_visit': { skip: true } },",
  ]
  const sim = portal([])
  const observation = await observe(sim, project([growerEntry, visitedEntry], {}, [skip]))
  expect(statusOf(observation, visited)).toBe('excluded')
  const reversed = 'association:companies/orchard_visit/visited_orchard'
  expect(statusOf(observation, reversed)).toBe('excluded')
})

test('a pair whose lists hold no user-defined type is read without a schema read', async () => {
  const sim = portal([])
  const from = sim.log.length
  await observe(sim, project([growerEntry]))
  expect(sim.log.slice(from).filter((r) => r.path.startsWith('/crm-object-schemas/2026-09/schemas/'))).toEqual([])
})

test('a create HubSpot answers with types its pair held before is uncertain, and nothing is recorded', async () => {
  const sim = portal([])
  // Suppose HubSpot answers a plain create on a pair that holds one with the types it holds (unobserved; the simulator
  // answers 400).
  const fetch: typeof sim.fetch = (url, init) => {
    if (init?.method === 'POST' && String(url).includes('/labels') && String(init.body).includes('"label":""')) {
      const results = [9001, 9002].map((typeId) => ({ category: 'USER_DEFINED', typeId, label: null }))
      return Promise.resolve(
        new Response(JSON.stringify({ results }), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    }
    return sim.fetch(url, init)
  }
  const wrapped = { ...sim, fetch }
  const h = await harness(wrapped)
  h.deps.store.write(state(), null)
  const plan = await planOn(wrapped, project([visitedEntry]), state())
  expect(plan.steps.map((s) => [s.address, s.action])).toEqual([[visited, 'create']])
  // After the review, another writer makes the pair's plain association: its name is not in the schema read yet.
  sim.portal(portalId).associations.push({
    category: 'USER_DEFINED',
    from: visitType,
    to: 'companies',
    name: 'someone_elses_plain',
    labels: [null, null],
    typeIds: [9001, 9002],
  })
  sim.portal(portalId).hiddenNames.set(9001, 100)
  sim.portal(portalId).hiddenNames.set(9002, 100)
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['uncertain'])
  expect((h.deps.store.read(portalId) as TargetState).resources[visited]).toBeUndefined()
})

test('a rebuild keeps the type IDs of each association it adopts', async () => {
  const { rebuild } = await import('../../src/engine/rebuild.js')
  const sim = portal([liveGrower])
  const config = project([growerEntry])
  const owned = state({
    [grower]: {
      origin: 'created',
      id: 'orchard_grower',
      normVersion: 1,
      base: { inverseLabel: 'Grows for', label: 'Grower' },
      typeIds: [9001, 9002],
    },
  })
  const rebuilt = rebuild({
    loaded: config,
    observation: await observe(sim, config, owned),
    state: owned,
    target: 'sandbox',
  })
  expect(rebuilt.resources[grower]).toEqual({
    origin: 'adopted',
    id: 'orchard_grower',
    normVersion: 1,
    base: { inverseLabel: 'Grows for', label: 'Grower' },
    typeIds: [9001, 9002],
  })
})

test('a plain association config gives a label is blocked, and apply refuses a plan that writes one', async () => {
  const sim = portal([{ from: visitType, to: 'companies', name: 'visited_orchard', typeIds: [9001, 9002] }])
  const owned = state({
    [visited]: { origin: 'created', id: 'visited_orchard', normVersion: 1, typeIds: [9001, 9002] },
  })
  const labelled = "visited: { from: 'orchard_visit', to: 'companies', name: 'visited_orchard', label: 'Visited' }"
  const config = project([labelled])
  {
    const plan = await planOn(sim, config, owned)
    expect(plan.steps).toMatchObject([
      {
        address: visited,
        action: 'update',
        risk: 'blocked',
        blocked: {
          reason: 'unsupported',
          detail: expect.stringContaining('config gives a label to what HubSpot holds'),
        },
      },
    ])
  }
  // A plan made while HubSpot held the association as a label, applied once it holds it plain.
  const was = portal([
    { from: visitType, to: 'companies', name: 'visited_orchard', label: 'Old', typeIds: [9001, 9002] },
  ])
  const base = { label: 'Old', inverseLabel: 'Old' }
  const before = state({
    [visited]: { origin: 'created', id: 'visited_orchard', normVersion: 1, base, typeIds: [9001, 9002] },
  })
  const made = await planOn(was, config, before)
  const step = made.steps[0] as PlanStep
  expect(step).toMatchObject({ address: visited, action: 'update' })
  const edited = rehashed({ ...made, steps: [{ ...step, expect: { exists: true } }] })
  const h = await harness(sim)
  h.deps.store.write(before, null)
  await expect(executePlan(request(edited), h.deps)).rejects.toThrow('a plain association')
  expect(sim.log.filter((r) => r.method === 'PUT')).toEqual([])
})

test('a label config holds as a plain association is blocked: HubSpot has no update that takes a label away', async () => {
  const sim = portal([
    { from: visitType, to: 'companies', name: 'visited_orchard', label: 'Visited', typeIds: [9001, 9002] },
  ])
  const plan = await planOn(sim, project([visitedEntry]), state())
  expect(plan.steps).toMatchObject([
    {
      address: visited,
      action: 'adopt',
      risk: 'blocked',
      blocked: { reason: 'unsupported', detail: expect.stringContaining('config holds as a plain association') },
    },
  ])
})

test('a create whose label the pair shows already, from the same object, is blocked', async () => {
  const sim = portal([liveGrower])
  const other = "other: { from: 'contacts', to: 'companies', name: 'orchard_other', label: 'grows FOR' }"
  const plan = await planOn(sim, project([other]), state())
  expect(plan.steps.find((s) => s.address === 'association:contacts/companies/orchard_other')).toMatchObject({
    action: 'create',
    risk: 'blocked',
    blocked: {
      detail: `HubSpot shows 'grows FOR' from contacts on the pair already, as ${grower}, and refuses a second`,
      fix: `give this entry another label, or remove ${grower} first`,
    },
  })
})

test('a plain create on a pair that holds a plain association under another name is blocked, naming it', async () => {
  const sim = portal([{ from: visitType, to: 'companies', name: 'theirs', typeIds: [9001, 9002] }])
  const plan = await planOn(sim, project([visitedEntry]), state())
  expect(plan.steps).toMatchObject([
    {
      address: visited,
      action: 'create',
      risk: 'blocked',
      blocked: {
        detail:
          'HubSpot holds the plain association between orchard_visit and companies already, as association:companies/orchard_visit/theirs, and a pair has one',
      },
    },
  ])
})

test('a create that clashes with a label this plan deletes says to apply the delete first: deletes run last', async () => {
  const old = 'association:companies/contacts/orchard_old'
  const sim = portal([
    { from: 'companies', to: 'contacts', name: 'orchard_old', label: 'Grower', typeIds: [9001, 9002] },
  ])
  const owned = state({
    [old]: { origin: 'created', id: 'orchard_old', normVersion: 1, base: { label: 'Grower', inverseLabel: 'Grower' } },
  })
  const plan = await planOn(sim, project([growerEntry], { [REMOVED]: removedFile(old) }, [allow]), owned)
  expect(plan.steps.find((s) => s.address === grower)).toMatchObject({
    risk: 'blocked',
    blocked: { fix: `this plan deletes ${old}, and deletes run last: apply it, then plan again` },
  })
})

test('label creates that fit the cap of 50 only after this plan deletes a label are blocked until it has', async () => {
  const full = Array.from(
    { length: 50 },
    (_, i): SimAssociationInput => ({ from: 'companies', to: 'contacts', name: `orchard_l${i}`, label: `L${i}` }),
  )
  const sim = portal(full)
  const gone = 'association:companies/contacts/orchard_l0'
  const owned = state({
    [gone]: { origin: 'created', id: 'orchard_l0', normVersion: 1, base: { label: 'L0', inverseLabel: 'L0' } },
  })
  const plan = await planOn(sim, project([growerEntry], { [REMOVED]: removedFile(gone) }, [allow]), owned)
  expect(plan.steps.find((s) => s.address === grower)).toMatchObject({
    risk: 'blocked',
    blocked: { detail: expect.stringContaining('fit only once its deletes on the pair have run') },
  })
  // Without the delete the plan only warns, as HubSpot counts a deleted label for a while: apply reports its 437.
  const warned = await planOn(sim, project([growerEntry]), state())
  expect(warned.steps.find((s) => s.address === grower)).toMatchObject({ risk: 'safe' })
})

test('a label whose base holds no label text is deleted, titled and confirmed as a label, with its live labels expected', async () => {
  const sim = portal([liveGrower])
  // Adopted while config and the portal disagreed on both texts: the base holds neither.
  const owned = state({ [grower]: { origin: 'adopted', id: 'orchard_grower', normVersion: 1, typeIds: [9001, 9002] } })
  const planned = await planOn(sim, project([], { [REMOVED]: removedFile(grower) }, [allow]), owned)
  const step = planned.steps[0] as PlanStep
  expect(step.expect).toEqual({ exists: true, values: { label: 'Grower', inverseLabel: 'Grows for' } })
  const title =
    'Delete association label "Grower" (orchard_grower) between companies and contacts; it cannot be restored, and records lose that label'
  expect(step.title).toBe(title)
  expect(stepTitle(step, namesOf(planned), true)).toBe(title)
  // A hand-edited plan that drops the labels from its expect is refused before anything is sent.
  const h = await harness(sim)
  h.deps.store.write(owned, null)
  const bare = rehashed({ ...planned, steps: [{ ...step, expect: { exists: true } }] })
  await expect(executePlan(request(bare, 'terminal'), h.deps)).rejects.toThrow(
    'its expect leaves out label, inverseLabel',
  )
  expect(sim.portal(portalId).associations.map((a) => a.name)).toEqual(['orchard_grower'])
})

test('a plain association delete says records lose every association between the two objects', async () => {
  const sim = portal([{ from: visitType, to: 'companies', name: 'visited_orchard', typeIds: [9001, 9002] }])
  const owned = state({
    [visited]: { origin: 'created', id: 'visited_orchard', normVersion: 1, typeIds: [9001, 9002] },
  })
  const planned = await planOn(sim, project([], { [REMOVED]: removedFile(visited) }, [allow]), owned)
  expect(planned.steps.map((s) => s.title)).toEqual([
    'Delete plain association (visited_orchard) between orchard_visit and companies; it cannot be restored, and records lose every association between them',
  ])
})
