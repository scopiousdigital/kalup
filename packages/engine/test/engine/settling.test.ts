// Reads that settle after a write: what apply wrote minutes ago and a read shows otherwise is unknown, never drift,
// absence or a create, until the window ends; a difference on a unit apply did not write is drift as ever.
import { expect, test } from 'vitest'
import { executePlan } from '../../src/engine/apply.js'
import { observeTarget, statusOf } from '../../src/engine/observe.js'
import { SETTLE_MS, settlingOf, writtenAfter } from '../../src/engine/settling.js'
import type { ResourceState, TargetState } from '../../src/ir/state.js'
import type { IRResource } from '../../src/ir/types.js'
import { createHttp } from '../../src/lib/http.js'
import type { PortalSim } from '../support/portal-sim.js'
import {
  type Edit,
  files,
  type Harness,
  harness,
  key,
  loadProject,
  orchardGroup,
  planOn,
  portalId,
  request,
  simPortal,
  soilPh,
  soilPhProperty,
} from './apply-harness.js'

const described: Edit = [
  files.companies,
  "fieldType: 'number',",
  "fieldType: 'number',\n      description: 'Soil acidity',",
]
const relabelled: Edit = [files.companies, "label: 'Soil pH',", "label: 'Soil acidity pH',"]
const MINUTE = 60_000

// A portal where apply created the orchard group and soil_ph, then, after the first window ended, relabelled soil_ph
// at the harness clock.
async function relabelledPortal(): Promise<{ at: number; h: Harness; sim: PortalSim; state: TargetState }> {
  const sim = simPortal()
  const h = await harness(sim)
  const first = await executePlan(request(await planOn(sim, loadProject([described]))), h.deps)
  h.clock.t += SETTLE_MS + MINUTE
  const created = h.deps.store.read(portalId) as TargetState
  const update = await planOn(sim, loadProject([described, relabelled]), created, [], new Date(h.clock.t))
  const second = await executePlan(request(update), h.deps)
  if (first.exitCode !== 0 || second.exitCode !== 0) {
    throw new Error(`an apply failed: exit ${first.exitCode}, then ${second.exitCode}`)
  }
  return { at: h.clock.t, h, sim, state: h.deps.store.read(portalId) as TargetState }
}

// What HubSpot serves of soil_ph now, as if a replica still held another copy or a person edited it.
function serve(sim: PortalSim, fields: { description?: string; label?: string }): void {
  const live = sim.object(portalId, 'companies').properties.get('soil_ph')
  if (live === undefined) {
    throw new Error('soil_ph is not in the simulator')
  }
  Object.assign(live, fields)
}

test('a value apply wrote that the read shows otherwise within 5 minutes is settling: a blocked step, nothing held', async () => {
  const { at, sim, state } = await relabelledPortal()
  // The entry records that write, of label alone, and when: the create's window has ended.
  expect(state.resources[soilPh]?.written).toEqual({ label: new Date(at).toISOString() })
  serve(sim, { label: 'Soil pH' })
  const now = new Date(at + MINUTE)
  const until = new Date(at + SETTLE_MS).toISOString()
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  const read = await observeTarget(http, loadProject([described, relabelled]), 'sandbox', { settle: { state, now } })
  expect(statusOf(read.observation, soilPh)).toBe('unreadable')
  expect(read.observation.coverage?.settling).toEqual({ [soilPh]: { reason: 'stale', until } })
  expect(read.observation.coverage?.complete).toBe(false)
  expect(read.issues.map((i) => [i.code, i.message])).toContainEqual([
    'W_SETTLING',
    `HubSpot still serves an older copy of 1 resource apply wrote minutes ago, so this read is not trusted on it until ${until}: ${soilPh}`,
  ])
  const plan = await planOn(sim, loadProject([described, relabelled]), state, [], now)
  expect(plan.steps).toMatchObject([
    {
      address: soilPh,
      action: 'unknown',
      risk: 'blocked',
      blocked: { reason: 'settling', fix: `plan again after ${until}` },
    },
  ])
  expect(plan.steps.flatMap((s) => s.held ?? [])).toEqual([])
})

test('the same read after the window is drift, held as ever', async () => {
  const { at, sim, state } = await relabelledPortal()
  serve(sim, { label: 'Soil pH' })
  const plan = await planOn(sim, loadProject([described, relabelled]), state, [], new Date(at + SETTLE_MS))
  expect(plan.steps).toMatchObject([{ address: soilPh, action: 'update', held: [{ unit: 'label', class: 'drift' }] }])
})

test('a difference on a unit apply did not write is drift inside the window too', async () => {
  const { at, sim, state } = await relabelledPortal()
  serve(sim, { description: 'Edited in HubSpot' })
  const plan = await planOn(sim, loadProject([described, relabelled]), state, [], new Date(at + MINUTE))
  expect(plan.steps).toMatchObject([
    { address: soilPh, action: 'update', held: [{ unit: 'description', class: 'drift', live: 'Edited in HubSpot' }] },
  ])
})

test('a resource apply created that the read does not list is settling inside the window, never created again', async () => {
  const sim = simPortal()
  const h = await harness(sim)
  expect((await executePlan(request(await planOn(sim, loadProject())), h.deps)).exitCode).toBe(0)
  const state = h.deps.store.read(portalId) as TargetState
  sim.object(portalId, 'companies').properties.delete('soil_ph')
  const inside = await planOn(sim, loadProject(), state, [], new Date(h.clock.t + MINUTE))
  expect(inside.steps).toMatchObject([{ address: soilPh, action: 'unknown', blocked: { reason: 'settling' } }])
  expect(inside.missing).toEqual([])
  // After the window the read is believed: state owns it and HubSpot no longer has it, so it is missing, no step.
  const after = await planOn(sim, loadProject(), state, [], new Date(h.clock.t + SETTLE_MS))
  expect(after.steps).toEqual([])
  expect(after.missing.map((m) => m.address)).toEqual([soilPh])
})

// A custom object with a group, a property, a plain association and a label on its pair with companies.
const visitProject: Edit[] = [[files.config, 'companies: {},', 'companies: {},\n    orchard_visit: {},']]
const visitFiles = {
  'hubspot/objects/orchard_visit.ts': [
    "import { defineCustomObject, p } from '@kalup/core'",
    '',
    "export const OrchardVisit = defineCustomObject('orchard_visit', {",
    "  labels: { singular: 'Orchard visit', plural: 'Orchard visits' },",
    "  primaryDisplayProperty: 'visit_code',",
    "  groups: { visit_details: { label: 'Visit details' } },",
    "  properties: { visitCode: p.string('visit_code', { label: 'Visit code', group: 'visit_details', fieldType: 'text' }) },",
    '})',
    '',
  ].join('\n'),
  'hubspot/associations.ts': [
    "import { defineAssociations } from '@kalup/core'",
    '',
    'export const Associations = defineAssociations({',
    "  visited: { from: 'orchard_visit', to: 'companies', name: 'visited_orchard' },",
    "  host: { from: 'orchard_visit', to: 'companies', name: 'orchard_host', label: 'Host' },",
    '})',
    '',
  ].join('\n'),
}

test('a custom object the schemas list leaves out right after its create settles with all that lies under it', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const loaded = loadProject(visitProject, visitFiles)
  expect((await executePlan(request(await planOn(sim, loaded)), h.deps)).exitCode).toBe(0)
  const state = h.deps.store.read(portalId) as TargetState
  // The plain association sends no unit, so its entry records no write: it settles with the object it lies on.
  expect(state.resources['association:orchard_visit/companies/visited_orchard']?.written).toBeUndefined()
  // The list leaves the object out, as it did in a live run (73dfce0a, 2026-10-06).
  const portal = sim.portal(portalId)
  const listed = portal.schemas
  portal.schemas = []
  const inside = await planOn(sim, loaded, state, [], new Date(h.clock.t + MINUTE))
  expect(inside.steps.map((s) => [s.address, s.action, s.blocked?.reason])).toEqual([
    ['object:orchard_visit', 'unknown', 'settling'],
    ['group:orchard_visit/visit_details', 'unknown', 'settling'],
    ['property:orchard_visit/visit_code', 'unknown', 'settling'],
    ['association:orchard_visit/companies/orchard_host', 'unknown', 'settling'],
    ['association:orchard_visit/companies/visited_orchard', 'unknown', 'settling'],
  ])
  expect(inside.missing).toEqual([])
  // Listed again, the read agrees with what apply wrote: nothing to do.
  portal.schemas = listed
  expect((await planOn(sim, loaded, state, [], new Date(h.clock.t + MINUTE))).steps).toEqual([])
})

test('an older copy of a custom object settles the object alone: what is on it still reads, and waits on nothing', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const loaded = loadProject(visitProject, visitFiles)
  expect((await executePlan(request(await planOn(sim, loaded)), h.deps)).exitCode).toBe(0)
  const state = h.deps.store.read(portalId) as TargetState
  // The schemas list serves the labels from before apply's write, as it did in a live run (e3a97730, 2026-10-06).
  const [schema] = sim.portal(portalId).schemas
  Object.assign(schema ?? {}, { labels: { singular: 'Visit', plural: 'Visits' } })
  const inside = await planOn(sim, loaded, state, [], new Date(h.clock.t + MINUTE))
  expect(inside.steps.map((s) => [s.address, s.action, s.blocked?.reason])).toEqual([
    ['object:orchard_visit', 'unknown', 'settling'],
  ])
})

// An owned entry that wrote its label at 09:00, and a read whose verdict and captured resources are given.
function settles(
  entry: Partial<ResourceState>,
  read: { resource?: IRResource; status: string; tombstoned?: boolean },
  now = Date.parse('2026-10-06T09:01:00.000Z'),
) {
  const written = { label: '2026-10-06T09:00:00.000Z' }
  const state: TargetState = {
    format: 'kalup.state/1',
    lineage: '0123456789abcdef',
    serial: 1,
    portalId,
    resources: {
      [soilPh]: { origin: 'created', id: 'soil_ph', normVersion: 1, base: { label: 'New' }, written, ...entry },
    },
  }
  return settlingOf({
    now: new Date(now),
    overrides: {},
    resources: read.resource ? { [soilPh]: read.resource } : {},
    state,
    status: () => read.status,
    tombstones: new Set(read.tombstoned ? [soilPh] : []),
  })
}

const stale: IRResource = { type: 'property', managed: true, definition: { label: 'Old' } }

test('only an entry that owns its address, and only its own write, settles a read', () => {
  expect(settles({}, { resource: stale, status: 'present' })).toEqual({
    [soilPh]: { reason: 'stale', until: '2026-10-06T09:05:00.000Z' },
  })
  // Absent: only what the entry created is missing, never what it adopted.
  expect(settles({}, { status: 'absent' })[soilPh]?.reason).toBe('missing')
  expect(settles({ origin: 'adopted' }, { status: 'absent' })).toEqual({})
  // removed.ts asks it to go: its absence may be the delete apply made, so it is believed.
  expect(settles({}, { status: 'absent', tombstoned: true })).toEqual({})
  // An entry that records another portal name owns nothing here; one with no write, or an old one, settles nothing.
  expect(settles({ id: 'soil_ph_v1' }, { resource: stale, status: 'present' })).toEqual({})
  expect(settles({ written: undefined }, { resource: stale, status: 'present' })).toEqual({})
  expect(settles({}, { resource: stale, status: 'present' }, Date.parse('2026-10-06T09:05:00.000Z'))).toEqual({})
  // A read that could not see it, or a unit the write did not touch, is the read's own business.
  expect(settles({}, { resource: stale, status: 'unreadable' })).toEqual({})
  expect(
    settles({ written: { description: '2026-10-06T09:00:00.000Z' } }, { resource: stale, status: 'present' }),
  ).toEqual({})
})

test('an entry keeps each unit it wrote while the window after that write is open, and only then', () => {
  const open: ResourceState = {
    origin: 'created',
    id: 'soil_ph',
    written: { group: '2026-10-06T08:59:00.000Z', label: '2026-10-06T09:00:00.000Z' },
  }
  // Each unit settles on its own clock: group's window ends a minute before label's.
  expect(writtenAfter(open, ['description'], new Date('2026-10-06T09:04:30.000Z'))).toEqual({
    description: '2026-10-06T09:04:30.000Z',
    label: '2026-10-06T09:00:00.000Z',
  })
  expect(writtenAfter(open, ['label'], new Date('2026-10-06T09:05:00.000Z'))).toEqual({
    label: '2026-10-06T09:05:00.000Z',
  })
  expect(writtenAfter(open, [], new Date('2026-10-06T09:05:00.000Z'))).toBeUndefined()
})
