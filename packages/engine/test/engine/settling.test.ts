// Reads that settle after a write: what apply wrote minutes ago and a read shows otherwise is unknown, never drift,
// absence or a create, until the window ends; a difference on a unit apply did not write is drift as ever.
import { expect, test } from 'vitest'
import { executePlan } from '../../src/engine/apply.js'
import { observeTarget, statusOf } from '../../src/engine/observe.js'
import { SETTLE_MS, settlingOf, writtenAfter } from '../../src/engine/settling.js'
import type { ResourceState, TargetState } from '../../src/ir/state.js'
import type { IRResource } from '../../src/ir/types.js'
import { createHttp } from '../../src/lib/http.js'
import type { PortalSim, SimPortal, SimProperty } from '../support/portal-sim.js'
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
// The host label's line in the associations file.
const HOST_LINE = / {2}host: .*\n/

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

const withDeals: Edit = [files.config, 'companies: {},', 'companies: {},\n    deals: {},']
const allowDestroy: Edit = [files.config, 'portalId: 1111111,', 'portalId: 1111111,\n      allowDestroy: true,']
const PIPELINES = 'hubspot/pipelines/deals.ts'
const pipelineFile = [
  "import { definePipeline } from '@kalup/core'",
  '',
  "export const OrchardSalesPipeline = definePipeline('deals', {",
  "  id: 'orchard_sales',",
  "  label: 'Orchard sales',",
  '  displayOrder: 1,',
  "  stages: { tasting: { id: 'orchard_tasting', label: 'Tasting', probability: 0.2 } },",
  '})',
  '',
].join('\n')

// removed.ts destroying one address.
function destroyed(address: string): string {
  return `import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n  '${address}': { action: 'destroy' },\n})\n`
}

test('a destroy tombstone on what apply wrote minutes ago is settling while the read leaves it out, never released', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const created = loadProject([...visitProject, withDeals], { ...visitFiles, [PIPELINES]: pipelineFile })
  expect((await executePlan(request(await planOn(sim, created)), h.deps)).exitCode).toBe(0)
  const state = h.deps.store.read(portalId) as TargetState
  const portal = sim.portal(portalId)
  const host = 'association:orchard_visit/companies/orchard_host'
  const visitOnly = visitFiles['hubspot/objects/orchard_visit.ts']
  const plainOnly = visitFiles['hubspot/associations.ts'].replace(HOST_LINE, '')
  // Each in turn: kalup rm took it out of config, removed.ts destroys it, and a lagging list leaves it out.
  const cases: [string, Record<string, string>, () => () => void][] = [
    [
      'object:orchard_visit',
      { [PIPELINES]: pipelineFile },
      () => {
        const listed = portal.schemas
        portal.schemas = []
        return () => {
          portal.schemas = listed
        }
      },
    ],
    [
      host,
      {
        'hubspot/objects/orchard_visit.ts': visitOnly,
        'hubspot/associations.ts': plainOnly,
        [PIPELINES]: pipelineFile,
      },
      () => hideAssociation(portal, 'orchard_host'),
    ],
    [
      'pipeline:deals/orchard_sales',
      visitFiles,
      () => {
        const listed = portal.pipelines.get('deals') ?? []
        portal.pipelines.set(
          'deals',
          listed.filter((p) => p.id !== 'orchard_sales'),
        )
        return () => portal.pipelines.set('deals', listed)
      },
    ],
  ]
  for (const [address, kept, lag] of cases) {
    const restore = lag()
    const loaded = loadProject([...visitProject, withDeals, allowDestroy], {
      ...kept,
      'hubspot/removed.ts': destroyed(address),
    })
    // biome-ignore lint/performance/noAwaitInLoops: one simulator, changed and restored per case
    const plan = await planOn(sim, loaded, state, [], new Date(h.clock.t + MINUTE))
    expect(
      plan.steps.find((s) => s.address === address),
      address,
    ).toMatchObject({
      action: 'unknown',
      blocked: { reason: 'settling' },
    })
    expect(plan.steps.filter((s) => s.action === 'release' || s.action === 'delete')).toEqual([])
    restore()
  }
})

test('a release tombstone releases inside the window too: it never rested on the absence, and claims none', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  expect((await executePlan(request(await planOn(sim, loadProject(visitProject, visitFiles))), h.deps)).exitCode).toBe(
    0,
  )
  const state = h.deps.store.read(portalId) as TargetState
  sim.portal(portalId).schemas = []
  const released = destroyed('object:orchard_visit').replace("action: 'destroy'", "action: 'release'")
  const plan = await planOn(
    sim,
    loadProject(visitProject, { 'hubspot/removed.ts': released }),
    state,
    [],
    new Date(h.clock.t + MINUTE),
  )
  expect(plan.steps.map((s) => [s.address, s.action, s.risk, s.title])).toEqual([
    ['object:orchard_visit', 'release', 'safe', 'Stop managing object orchard_visit'],
  ])
})

test('a plain association apply created, which names no unit, is settling while its pair list leaves it out', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const loaded = loadProject(visitProject, visitFiles)
  expect((await executePlan(request(await planOn(sim, loaded)), h.deps)).exitCode).toBe(0)
  const state = h.deps.store.read(portalId) as TargetState
  const plain = 'association:orchard_visit/companies/visited_orchard'
  expect(state.resources[plain]).toMatchObject({ origin: 'created', writtenAt: new Date(h.clock.t).toISOString() })
  const restore = hideAssociation(sim.portal(portalId), 'visited_orchard')
  const plan = await planOn(sim, loaded, state, [], new Date(h.clock.t + MINUTE))
  expect(plan.steps.map((s) => [s.address, s.action, s.blocked?.reason])).toEqual([[plain, 'unknown', 'settling']])
  expect(plan.missing).toEqual([])
  restore()
})

test('a label config now writes from the other side settles there: what apply wrote follows the direction', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const hostLine = (text: string) =>
    `  host: { from: 'orchard_visit', to: 'companies', name: 'orchard_host', label: '${text}', inverseLabel: 'Hosted visit' },`
  const associations = (line: string) => visitFiles['hubspot/associations.ts'].replace(HOST_LINE, `${line}\n`)
  const project = (line: string) =>
    loadProject(visitProject, { ...visitFiles, 'hubspot/associations.ts': associations(line) })
  expect((await executePlan(request(await planOn(sim, project(hostLine('Host')))), h.deps)).exitCode).toBe(0)
  // After the create's window, apply relabels one side: its entry records that write of label alone.
  h.clock.t += SETTLE_MS + MINUTE
  const created = h.deps.store.read(portalId) as TargetState
  const relabel = await planOn(sim, project(hostLine('Visit host')), created, [], new Date(h.clock.t))
  expect((await executePlan(request(relabel), h.deps)).exitCode).toBe(0)
  const state = h.deps.store.read(portalId) as TargetState
  expect(state.resources['association:orchard_visit/companies/orchard_host']?.written).toEqual({
    label: new Date(h.clock.t).toISOString(),
  })
  // Config now writes it from companies, its label and inverse label swapped, and HubSpot still serves the old label.
  const flipped =
    "  host: { from: 'companies', to: 'orchard_visit', name: 'orchard_host', label: 'Hosted visit', inverseLabel: 'Visit host' },"
  const label = sim.portal(portalId).associations.find((a) => a.name === 'orchard_host')
  Object.assign(label ?? {}, { labels: [...(label?.labels ?? [])].map((l) => (l === 'Visit host' ? 'Host' : l)) })
  const plan = await planOn(sim, project(flipped), state, [], new Date(h.clock.t + MINUTE))
  expect(plan.steps.map((s) => [s.address, s.action, s.blocked?.reason])).toEqual([
    ['association:companies/orchard_visit/orchard_host', 'unknown', 'settling'],
  ])
})

test('a create HubSpot acknowledged and no read showed records what it sent by the units a read is compared on', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const soilType: Edit = [
    files.companies,
    "      fieldType: 'number',\n    }),\n",
    "      fieldType: 'number',\n    }),\n    soilType: p.enum('soil_type', { label: 'Soil type', group: 'orchard', fieldType: 'select', options: [{ value: 'clay', label: 'Clay' }] }),\n",
  ]
  // From its POST on, no read shows soil_ph's new neighbour for longer than the read-back waits.
  let hiding = false
  const lagging: PortalSim = {
    ...sim,
    fetch: async (input, init) => {
      hiding ||= init?.method === 'POST' && String(init.body).includes('soil_type')
      const { properties } = sim.object(portalId, 'companies')
      const hidden = hiding && (init?.method ?? 'GET') === 'GET' ? properties.get('soil_type') : undefined
      if (hidden) {
        properties.delete('soil_type')
      }
      try {
        return await sim.fetch(input, init)
      } finally {
        if (hidden) {
          properties.set('soil_type', hidden)
        }
      }
    },
  }
  const h = await harness(lagging)
  const applied = await executePlan(request(await planOn(sim, loadProject([soilType]))), h.deps)
  expect(applied.data.steps.map((s) => [s.address, s.outcome])).toContainEqual([
    'property:companies/soil_type',
    'unverified',
  ])
  const entry = (h.deps.store.read(portalId) as TargetState).resources['property:companies/soil_type']
  expect(Object.keys(entry?.written ?? {})).toEqual([
    'fieldType',
    'group',
    'label',
    'options.order',
    'options[clay].hidden',
    'options[clay].label',
    'type',
  ])
  expect(entry?.writtenAt).toBe(new Date(h.clock.t).toISOString())
})

test('a property HubSpot serves an older copy of still holds the display field of its object', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const withNotes = visitFiles['hubspot/objects/orchard_visit.ts'].replace(
    '  properties: { visitCode:',
    "  properties: { visitNotes: p.string('visit_notes', { label: 'Visit notes', group: 'visit_details', fieldType: 'text' }), visitCode:",
  )
  const project = (text: string) =>
    loadProject(visitProject, { ...visitFiles, 'hubspot/objects/orchard_visit.ts': text })
  expect((await executePlan(request(await planOn(sim, project(withNotes))), h.deps)).exitCode).toBe(0)
  const state = h.deps.store.read(portalId) as TargetState
  // Config shows visit_notes first, and the read serves visit_notes' label from before apply's write.
  const shown = withNotes.replace("primaryDisplayProperty: 'visit_code',", "primaryDisplayProperty: 'visit_notes',")
  const [schema] = sim.portal(portalId).schemas
  Object.assign(sim.object(portalId, schema?.objectTypeId as string).properties.get('visit_notes') ?? {}, {
    label: 'Notes',
  })
  const plan = await planOn(sim, project(shown), state, [], new Date(h.clock.t + MINUTE))
  expect(plan.steps.map((s) => [s.address, s.action, s.risk, s.blocked?.reason])).toEqual([
    ['object:orchard_visit', 'update', 'safe', undefined],
    ['property:orchard_visit/visit_notes', 'unknown', 'blocked', 'settling'],
  ])
})

test('takeover waits on what settles on the object it takes from, and on nothing elsewhere', async () => {
  const sim = simPortal()
  const h = await harness(sim)
  const pipelines = { [PIPELINES]: pipelineFile }
  expect((await executePlan(request(await planOn(sim, loadProject([withDeals], pipelines))), h.deps)).exitCode).toBe(0)
  const state = h.deps.store.read(portalId) as TargetState
  // HubSpot holds a custom property config lacks, which takeover archives.
  sim.object(portalId, 'companies').properties.set('swarm_notes', {
    ...(sim.object(portalId, 'companies').properties.get('soil_ph') as SimProperty),
    name: 'swarm_notes',
    label: 'Swarm notes',
  })
  const takeover: Edit = [files.config, "  name: 'orchard-apply',", "  name: 'orchard-apply',\n  mode: 'takeover',"]
  const plan = (edits: Edit[] = []) =>
    planOn(
      sim,
      loadProject([withDeals, takeover, allowDestroy, ...edits], pipelines),
      state,
      [],
      new Date(h.clock.t + MINUTE),
    )
  const swarm = async (edits: Edit[] = []) =>
    (await plan(edits)).steps.find((s) => s.address === 'property:companies/swarm_notes')
  // The pipeline on deals serves an older copy: takeover on companies goes ahead.
  const pipeline = sim
    .portal(portalId)
    .pipelines.get('deals')
    ?.find((p) => p.id === 'orchard_sales')
  Object.assign(pipeline ?? {}, { label: 'Sales' })
  expect(await swarm()).toMatchObject({ action: 'delete', risk: 'destructive' })
  expect((await swarm())?.blocked).toBeUndefined()
  Object.assign(pipeline ?? {}, { label: 'Orchard sales' })
  // A type on the companies and deals pair its schema read does not name yet: takeover never deletes an association.
  sim.portal(portalId).associations.push({
    category: 'USER_DEFINED',
    from: 'companies',
    to: 'deals',
    name: 'fresh_label',
    labels: ['Fresh', 'Fresh'],
    typeIds: [9101, 9102],
  })
  sim.portal(portalId).hiddenNames.set(9101, 50)
  sim.portal(portalId).hiddenNames.set(9102, 50)
  const associations: Edit = [files.config, 'companies: {},', 'companies: { associations: true },']
  expect((await plan([associations])).coverage.complete).toBe(false)
  expect((await swarm([associations]))?.blocked).toBeUndefined()
  sim.portal(portalId).associations.pop()
  // soil_ph, on companies, serves an older copy: takeover there waits for the window, and says until when.
  const soil = sim.object(portalId, 'companies').properties.get('soil_ph')
  Object.assign(soil ?? {}, { label: 'Soil acidity' })
  const until = new Date(h.clock.t + SETTLE_MS).toISOString()
  expect(await swarm()).toMatchObject({
    action: 'delete',
    risk: 'blocked',
    blocked: { reason: 'settling', fix: `plan again after ${until}` },
  })
})

// Leaves the association `name` out of the portal's lists, as a lagging read does, and returns how to put it back.
function hideAssociation(portal: SimPortal, name: string): () => void {
  const listed = portal.associations
  portal.associations = listed.filter((a) => a.name !== name)
  return () => {
    portal.associations = listed
  }
}

// An owned entry that wrote its label at 09:00, and a read whose verdict and captured resources are given.
function settles(
  entry: Partial<ResourceState>,
  read: { resource?: IRResource; status: string },
  now = Date.parse('2026-10-06T09:01:00.000Z'),
) {
  const at = '2026-10-06T09:00:00.000Z'
  const state: TargetState = {
    format: 'kalup.state/1',
    lineage: '0123456789abcdef',
    serial: 1,
    portalId,
    resources: {
      [soilPh]: {
        origin: 'created',
        id: 'soil_ph',
        normVersion: 1,
        base: { label: 'New' },
        written: { label: at },
        writtenAt: at,
        ...entry,
      },
    },
  }
  return settlingOf({
    now: new Date(now),
    overrides: {},
    resources: read.resource ? { [soilPh]: read.resource } : {},
    state,
    status: () => read.status,
  })
}

const stale: IRResource = { type: 'property', managed: true, definition: { label: 'Old' } }

test('only an entry that owns its address, and only its own write, settles a read', () => {
  expect(settles({}, { resource: stale, status: 'present' })).toEqual({
    [soilPh]: { reason: 'stale', until: '2026-10-06T09:05:00.000Z' },
  })
  // Absent within the window proves nothing, whatever the entry's origin; removed.ts plays no part (the plans below).
  const missing = { [soilPh]: { reason: 'missing', until: '2026-10-06T09:05:00.000Z' } }
  expect(settles({}, { status: 'absent' })).toEqual(missing)
  expect(settles({ origin: 'adopted' }, { status: 'absent' })).toEqual(missing)
  // A write that names no unit, as a plain association's create, still settles its absence; no write at all does not.
  expect(settles({ written: undefined }, { status: 'absent' })).toEqual(missing)
  expect(settles({ written: undefined, writtenAt: undefined }, { status: 'absent' })).toEqual({})
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

test('a write time ahead of this clock cannot keep a resource settling for the skew', () => {
  const ahead = '2026-10-06T10:00:00.000Z'
  const skewed = { written: { label: ahead }, writtenAt: ahead }
  // An hour ahead is a wrong clock, not a write minutes ago: the read is believed at once, and minutes later.
  expect(settles(skewed, { resource: stale, status: 'present' })).toEqual({})
  expect(settles(skewed, { status: 'absent' }, Date.parse('2026-10-06T09:07:00.000Z'))).toEqual({})
  // A minute ahead counts as now: the window ends at most 5 minutes after this read.
  const near = '2026-10-06T09:02:00.000Z'
  expect(settles({ written: { label: near }, writtenAt: near }, { resource: stale, status: 'present' })).toEqual({
    [soilPh]: { reason: 'stale', until: '2026-10-06T09:06:00.000Z' },
  })
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
