// Pipelines and stages through plan and the executor against the simulator: a pipeline create that carries its stages,
// a stage added in the middle and the order written stage by stage, metadata updates, held drift, the deletes and their
// rules, and what Kalup reads and compares but does not write.

import { expect, test } from 'vitest'
import { executePlan } from '../../src/engine/apply.js'
import type { TargetState } from '../../src/ir/state.js'
import type { SimPipelineInput, SimPortalInput } from '../support/portal-sim.js'
import {
  type Edit,
  files,
  harness,
  loadProject,
  orchardGroup,
  planOn,
  portalId,
  request,
  sent,
  simPortal,
  soilPhProperty,
} from './apply-harness.js'

const deals = '/crm/pipelines/2026-09/deals'
const orchard = 'pipeline:deals/orchard_sales'
const tasting = 'stage:deals/orchard_sales/orchard_tasting'
const signed = 'stage:deals/orchard_sales/orchard_signed'
const PIPELINES = 'hubspot/pipelines/deals.ts'

const withDeals: Edit = [files.config, 'companies: {},', 'companies: {},\n    deals: {},\n    tickets: {},\n    contacts: {},']

// The deal pipeline config holds, with its stages in order, each `[key, id, label, probability]`.
function dealPipeline(stages: [string, string, string, number][], extra = ''): string {
  const lines = stages.map(([k, id, label, p]) => `    ${k}: { id: '${id}', label: '${label}', probability: ${p} },`)
  return [
    "import { definePipeline } from '@kalup/core'",
    '',
    "export const OrchardSalesPipeline = definePipeline('deals', {",
    "  id: 'orchard_sales',",
    "  label: 'Orchard sales',",
    '  displayOrder: 1,',
    `  stages: {\n${lines.join('\n')}\n  },`,
    '})',
    extra,
  ].join('\n')
}

const twoStages: [string, string, string, number][] = [
  ['tasting', 'orchard_tasting', 'Tasting', 0.2],
  ['signed', 'orchard_signed', 'Signed', 1],
]

function project(text = dealPipeline(twoStages), more: Record<string, string> = {}) {
  return loadProject([withDeals], { [PIPELINES]: text, ...more })
}

// The orchard pipeline as HubSpot holds it once applied.
const live: SimPipelineInput = {
  id: 'orchard_sales',
  label: 'Orchard sales',
  displayOrder: 1,
  stages: [
    { id: 'orchard_tasting', label: 'Tasting', metadata: { probability: '0.2' } },
    { id: 'orchard_signed', label: 'Signed', metadata: { probability: '1.0' } },
  ],
}

// The sandbox portal holding the fixture's company group and property, so only pipelines differ, and `pipelines`.
function withPipelines(pipelines: SimPortalInput['pipelines'], extra: Partial<SimPortalInput> = {}) {
  return simPortal({ groups: [orchardGroup], properties: [soilPhProperty] }, { pipelines, ...extra })
}

// The fixture's company group and property, owned and agreeing with the portal.
const companiesOwned: TargetState['resources'] = {
  'group:companies/orchard': { origin: 'created', id: 'orchard', normVersion: 1, base: { label: 'Orchard' } },
  'property:companies/soil_ph': {
    origin: 'created',
    id: 'soil_ph',
    normVersion: 1,
    base: { fieldType: 'number', group: { $ref: 'group:companies/orchard' }, label: 'Soil pH', type: 'number' },
  },
}

// State that owns the fixture's company resources and nothing else.
function companiesOnly(): TargetState {
  return { format: 'kalup.state/1', lineage: '0a1b2c3d4e5f6071', serial: 3, portalId, resources: companiesOwned }
}

// State that owns the orchard pipeline and its two stages, agreeing with `live`.
function owned(): TargetState {
  return {
    format: 'kalup.state/1',
    lineage: '0a1b2c3d4e5f6071',
    serial: 3,
    portalId,
    resources: {
      ...companiesOwned,
      [orchard]: {
        origin: 'created',
        id: 'orchard_sales',
        normVersion: 1,
        base: { displayOrder: 1, label: 'Orchard sales', stages: ['orchard_tasting', 'orchard_signed'] },
      },
      [tasting]: { origin: 'created', id: 'orchard_tasting', normVersion: 1, base: { label: 'Tasting', probability: 0.2 } },
      [signed]: { origin: 'created', id: 'orchard_signed', normVersion: 1, base: { label: 'Signed', probability: 1 } },
    },
  }
}

test('a pipeline create carries its stages in one request, and apply records the pipeline and each stage', async () => {
  const sim = withPipelines({})
  const h = await harness(sim)
  h.deps.store.write(companiesOnly(), null)
  const plan = await planOn(sim, project(), companiesOnly())
  expect(plan.steps).toMatchObject([
    {
      address: orchard,
      action: 'create',
      risk: 'safe',
      title: 'Create pipeline "Orchard sales" (orchard_sales) on deals with 2 stages',
      stages: [
        { address: tasting, desired: { label: 'Tasting', probability: 0.2 } },
        { address: signed, desired: { label: 'Signed', probability: 1 } },
      ],
    },
  ])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path, r.body])).toEqual([
    [
      'POST',
      deals,
      {
        pipelineId: 'orchard_sales',
        label: 'Orchard sales',
        displayOrder: 1,
        stages: [
          { stageId: 'orchard_tasting', label: 'Tasting', displayOrder: 0, metadata: { probability: '0.2' } },
          { stageId: 'orchard_signed', label: 'Signed', displayOrder: 1, metadata: { probability: '1' } },
        ],
      },
    ],
  ])
  const state = h.deps.store.read(portalId) as TargetState
  expect(state.resources).toEqual({
    ...companiesOwned,
    [orchard]: {
      origin: 'created',
      id: 'orchard_sales',
      normVersion: 1,
      base: { displayOrder: 1, label: 'Orchard sales', stages: ['orchard_tasting', 'orchard_signed'] },
    },
    [signed]: { origin: 'created', id: 'orchard_signed', normVersion: 1, base: { label: 'Signed', probability: 1 } },
    [tasting]: { origin: 'created', id: 'orchard_tasting', normVersion: 1, base: { label: 'Tasting', probability: 0.2 } },
  })
  expect((await planOn(sim, project(), state)).steps).toEqual([])
})

type Stage = [string, string, string, number]
const [first, last] = twoStages as [Stage, Stage]
const pressing: Stage = ['pressing', 'orchard_pressing', 'Pressing', 0.5]

test('a stage added in the middle is created after the last stage, then the pipeline moves it into place', async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const middle = dealPipeline([first, pressing, last])
  const plan = await planOn(sim, project(middle), owned())
  expect(plan.steps).toMatchObject([
    {
      address: orchard,
      action: 'update',
      risk: 'safe',
      title: 'Update pipeline "Orchard sales" (orchard_sales) on deals, set the stage order',
      changes: [
        {
          unit: 'stages',
          op: 'set',
          before: ['orchard_tasting', 'orchard_signed'],
          after: ['orchard_tasting', 'orchard_pressing', 'orchard_signed'],
        },
      ],
      expect: { exists: true, values: { stages: ['orchard_tasting', 'orchard_signed'] } },
    },
    { address: 'stage:deals/orchard_sales/orchard_pressing', action: 'create', risk: 'safe' },
  ])
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path, r.body])).toEqual([
    [
      'POST',
      `${deals}/orchard_sales/stages`,
      { stageId: 'orchard_pressing', label: 'Pressing', displayOrder: 2, metadata: { probability: '0.5' } },
    ],
    ['PATCH', `${deals}/orchard_sales/stages/orchard_pressing`, { displayOrder: 0 }],
  ])
  // The stage create runs before the pipeline's order write, each read before and after.
  expect(sent(sim, from)).toMatchInlineSnapshot(`
    [
      "GET /crm/pipelines/2026-09/deals",
      "GET /crm/pipelines/2026-09/deals/orchard_sales",
      "POST /crm/pipelines/2026-09/deals/orchard_sales/stages",
      "GET /crm/pipelines/2026-09/deals/orchard_sales",
      "GET /crm/pipelines/2026-09/deals/orchard_sales",
      "PATCH /crm/pipelines/2026-09/deals/orchard_sales/stages/orchard_pressing",
      "GET /crm/pipelines/2026-09/deals/orchard_sales",
      "GET /crm/pipelines/2026-09/deals/orchard_sales",
    ]
  `)
  const stages = sim.portal(portalId).pipelines.get('deals')?.[0]?.stages ?? []
  expect([...stages].sort((a, b) => a.displayOrder - b.displayOrder).map((st) => st.id)).toEqual([
    'orchard_tasting',
    'orchard_pressing',
    'orchard_signed',
  ])
  const state = h.deps.store.read(portalId) as TargetState
  expect(state.resources[orchard]?.base).toMatchObject({
    stages: ['orchard_tasting', 'orchard_pressing', 'orchard_signed'],
  })
  expect((await planOn(sim, project(middle), state)).steps).toEqual([])
})

const stagePatch = /^\/crm\/pipelines\/2026-09\/deals\/orchard_sales\/stages\/[^/]+$/
const rateLimited = { status: 'error', category: 'RATE_LIMITS', message: 'You have reached your ten_secondly_rolling limit.' }

test('a stage move answered 429 every time is waited out three times, then the run stops with E_RATE_LIMIT', async () => {
  const sim = withPipelines({ deals: [live] })
  sim.fault({ method: 'PATCH', path: stagePatch, action: { kind: 'status', status: 429, body: rateLimited } })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const plan = await planOn(sim, project(dealPipeline([last, first])), owned())
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.issues.map((i) => i.code)).toEqual(['E_RATE_LIMIT'])
  expect(sim.log.filter((r) => r.method === 'PATCH')).toHaveLength(4)
})

test('a pipeline PATCH whose outcome is uncertain ends the step there: no stage is moved after it', async () => {
  const sim = withPipelines({ deals: [live] })
  sim.fault({ method: 'PATCH', path: `${deals}/orchard_sales`, action: { kind: 'status', status: 502 } })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const relabelled = dealPipeline([last, first]).replace("label: 'Orchard sales'", "label: 'Orchard deals'")
  const plan = await planOn(sim, project(relabelled), owned())
  expect(plan.steps[0]?.changes?.map((c) => c.unit)).toEqual(['label', 'stages'])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['uncertain'])
  expect(sim.writes().map((r) => [r.method, r.path])).toEqual([['PATCH', `${deals}/orchard_sales`]])
})

test('a wait after a move landed stops the step stale, and the report says to plan again', async () => {
  const three: SimPipelineInput = {
    ...live,
    stages: [...live.stages, { id: 'orchard_pressing', label: 'Pressing', metadata: { probability: '0.5' } }],
  }
  const sim = withPipelines({ deals: [three] })
  sim.fault({ method: 'PATCH', path: stagePatch, occurrence: 2, action: { kind: 'status', status: 429, body: rateLimited } })
  const h = await harness(sim)
  const state = owned()
  Object.assign(state.resources, {
    [orchard]: {
      ...state.resources[orchard],
      base: { displayOrder: 1, label: 'Orchard sales', stages: ['orchard_tasting', 'orchard_signed', 'orchard_pressing'] },
    },
    'stage:deals/orchard_sales/orchard_pressing': {
      origin: 'created',
      id: 'orchard_pressing',
      normVersion: 1,
      base: { label: 'Pressing', probability: 0.5 },
    },
  })
  h.deps.store.write(state, null)
  const plan = await planOn(sim, project(dealPipeline([pressing, last, first])), state)
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(5)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['stale'])
  expect(applied.issues.map((i) => [i.code, i.fix])).toEqual([
    ['E_PLAN_STALE', 'run kalup plan --target sandbox --out <file> again and review it'],
  ])
  expect(applied.text).toContain('Run kalup plan --target sandbox to see what is left.')
})

test('two stages swapped: one move, onto the slot of the stage it now follows', async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const swapped = dealPipeline([last, first])
  const plan = await planOn(sim, project(swapped), owned())
  expect(plan.steps).toMatchObject([{ address: orchard, action: 'update', changes: [{ unit: 'stages' }] }])
  expect((await executePlan(request(plan), h.deps)).exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path, r.body])).toEqual([
    ['PATCH', `${deals}/orchard_sales/stages/orchard_tasting`, { displayOrder: 1 }],
  ])
  expect((await planOn(sim, project(swapped), h.deps.store.read(portalId))).steps).toEqual([])
})

test("a stage's probability is a risky update its metadata PATCH carries; a label alone is safe", async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const changed = dealPipeline([['tasting', 'orchard_tasting', 'Tasted', 0.3], last])
  const plan = await planOn(sim, project(changed), owned())
  expect(plan.steps).toMatchObject([
    {
      address: tasting,
      action: 'update',
      risk: 'risky',
      changes: [
        { unit: 'label', before: 'Tasting', after: 'Tasted' },
        { unit: 'probability', before: 0.2, after: 0.3 },
      ],
    },
  ])
  expect((await executePlan(request(plan, 'terminal'), h.deps)).exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path, r.body])).toEqual([
    ['PATCH', `${deals}/orchard_sales/stages/orchard_tasting`, { label: 'Tasted', metadata: { probability: '0.3' } }],
  ])
  const state = h.deps.store.read(portalId) as TargetState
  expect(state.resources[tasting]?.base).toEqual({ label: 'Tasted', probability: 0.3 })
  const relabel = dealPipeline([['tasting', 'orchard_tasting', 'Tasting today', 0.3], last])
  expect((await planOn(sim, project(relabel), state)).steps).toMatchObject([{ address: tasting, risk: 'safe' }])
})

test('a stage relabelled in HubSpot is held as drift and not written', async () => {
  const sim = withPipelines({ deals: [live] })
  const stage = sim.portal(portalId).pipelines.get('deals')?.[0]?.stages[0]
  Object.assign(stage ?? {}, { label: 'Tasting day' })
  const plan = await planOn(sim, project(), owned())
  expect(plan.steps).toMatchObject([
    {
      address: tasting,
      action: 'update',
      held: [{ unit: 'label', class: 'drift', config: 'Tasting', live: 'Tasting day', base: 'Tasting' }],
    },
  ])
  expect(plan.steps[0]?.changes).toBeUndefined()
})

const allow: Edit = [
  files.config,
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      allowDestroy: true,",
]

function removed(address: string): string {
  return `import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n  '${address}': { action: 'destroy' },\n})\n`
}

test('a stage tombstone deletes the stage, proven by a read that lacks it, and drops its entry', async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const one = dealPipeline([first])
  const loaded = loadProject([withDeals, allow], { [PIPELINES]: one, 'hubspot/removed.ts': removed(signed) })
  const plan = await planOn(sim, loaded, owned())
  // The order of the stages config and the portal share does not change, so the pipeline has no step.
  expect(plan.steps).toMatchObject([
    {
      address: signed,
      action: 'delete',
      risk: 'destructive',
      title: 'Delete stage "Signed" (orchard_signed) of pipeline orchard_sales on deals; it cannot be restored',
    },
  ])
  expect((await executePlan(request(plan, 'terminal'), h.deps)).exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path])).toEqual([['DELETE', `${deals}/orchard_sales/stages/orchard_signed`]])
  const state = h.deps.store.read(portalId) as TargetState
  expect(state.resources[signed]).toBeUndefined()
})

test('a pipeline tombstone deletes the pipeline alone and drops its stages from state with it', async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const loaded = loadProject([withDeals, allow], { 'hubspot/removed.ts': removed(orchard) })
  const plan = await planOn(sim, loaded, owned())
  expect(plan.steps).toMatchObject([{ address: orchard, action: 'delete', risk: 'destructive' }])
  expect(plan.orphans).toEqual([])
  expect((await executePlan(request(plan, 'terminal'), h.deps)).exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path])).toEqual([['DELETE', `${deals}/orchard_sales`]])
  expect(Object.keys((h.deps.store.read(portalId) as TargetState).resources)).toEqual(Object.keys(companiesOwned))
})

test('HubSpot refuses a delete while a record sits in the stage, and apply names the stage and the records', async () => {
  const sim = withPipelines({ deals: [live] }, { stagesInUse: ['orchard_signed'] })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const loaded = loadProject([withDeals, allow], { 'hubspot/removed.ts': removed(orchard) })
  const applied = await executePlan(request(await planOn(sim, loaded, owned()), 'terminal'), h.deps)
  expect(applied.exitCode).toBe(1)
  expect(applied.issues.map((i) => [i.code, i.message, i.fix])).toMatchInlineSnapshot(`
    [
      [
        "E_HTTP",
        "s1 Delete pipeline "Orchard sales" (orchard_sales) on deals was refused (VALIDATION_ERROR): HubSpot never deletes a stage a record sits in (stages [orchard_signed], records [4242])",
        "move those records to another stage in HubSpot, or delete them, then run kalup plan --target sandbox",
      ],
    ]
  `)
})

test('a create with an ID HubSpot assigned elsewhere is risky, and names the portal pipeline with the same label', async () => {
  const sim = withPipelines({
    deals: [{ id: '284280770', label: 'Orchard sales', stages: [{ id: '462157507', label: 'Tasting', metadata: { probability: '0.2' } }] }],
  })
  const text = dealPipeline([['tasting', '512700419', 'Tasting', 0.2]]).replace("'orchard_sales'", "'512700418'")
  const plan = await planOn(sim, project(text), companiesOnly())
  expect(plan.steps).toMatchObject([{ address: 'pipeline:deals/512700418', action: 'create', risk: 'risky' }])
  expect(plan.steps[0]?.notes?.map((n) => n.note)).toMatchInlineSnapshot(`
    [
      "HubSpot assigned the ID 512700418, 512700419 in another portal; the portal holds a pipeline "Orchard sales" as 284280770. If this portal holds the same pipeline under other IDs, add a name override for the pipeline and each stage under targets.sandbox.overrides instead of creating a copy",
    ]
  `)
})

test('a pipeline ID another object holds, or a stage ID another pipeline of the object holds, blocks the create', async () => {
  const desk: SimPipelineInput = {
    id: 'orchard_sales',
    label: 'Desk',
    stages: [{ id: 'desk_done', label: 'Done', metadata: { ticketState: 'CLOSED' } }],
  }
  const cider: SimPipelineInput = {
    id: 'cider',
    label: 'Cider',
    stages: [{ id: 'orchard_signed', label: 'Pressed', metadata: { probability: '0.5' } }],
  }
  // Only an object whose pipelines are in scope is read, so the plan sees the tickets pipeline once they are.
  const scoped: Edit = [files.config, 'tickets: {},', 'tickets: { pipelines: true },']
  const files_ = loadProject([withDeals, scoped], { [PIPELINES]: dealPipeline(twoStages) })
  const ticketed = await planOn(withPipelines({ tickets: [desk] }), files_, companiesOnly())
  expect(ticketed.steps.find((s) => s.address === orchard)).toMatchObject({
    risk: 'blocked',
    blocked: { reason: 'unsupported', detail: expect.stringContaining('pipeline:tickets/orchard_sales holds the ID') },
  })
  const staged = await planOn(withPipelines({ deals: [cider] }), project(), companiesOnly())
  expect(staged.steps.find((s) => s.address === orchard)).toMatchObject({
    risk: 'blocked',
    blocked: { detail: expect.stringContaining('stage:deals/cider/orchard_signed holds the ID orchard_signed') },
  })
})

test("a ticket pipeline's closed stage moves: the stage that closes runs before the one that reopens", async () => {
  const desk: SimPipelineInput = {
    id: 'orchard_desk',
    label: 'Desk',
    stages: [
      { id: 'desk_open', label: 'Open', metadata: { ticketState: 'OPEN' } },
      { id: 'desk_done', label: 'Done', metadata: { ticketState: 'CLOSED' } },
    ],
  }
  const text = [
    "import { definePipeline } from '@kalup/core'",
    '',
    "export const DeskPipeline = definePipeline('tickets', {",
    "  id: 'orchard_desk',",
    "  label: 'Desk',",
    '  displayOrder: 0,',
    '  stages: {',
    "    open: { id: 'desk_open', label: 'Open', ticketState: 'CLOSED' },",
    "    done: { id: 'desk_done', label: 'Done', ticketState: 'OPEN' },",
    '  },',
    '})',
    '',
  ].join('\n')
  const sim = withPipelines({ tickets: [desk] })
  const h = await harness(sim)
  const state: TargetState = {
    ...companiesOnly(),
    resources: {
      ...companiesOwned,
      'pipeline:tickets/orchard_desk': {
        origin: 'created',
        id: 'orchard_desk',
        normVersion: 1,
        base: { displayOrder: 0, label: 'Desk', stages: ['desk_open', 'desk_done'] },
      },
      'stage:tickets/orchard_desk/desk_open': {
        origin: 'created',
        id: 'desk_open',
        normVersion: 1,
        base: { label: 'Open', ticketState: 'OPEN' },
      },
      'stage:tickets/orchard_desk/desk_done': {
        origin: 'created',
        id: 'desk_done',
        normVersion: 1,
        base: { label: 'Done', ticketState: 'CLOSED' },
      },
    },
  }
  h.deps.store.write(state, null)
  const plan = await planOn(sim, loadProject([withDeals], { 'hubspot/pipelines/tickets.ts': text }), state)
  expect((await executePlan(request(plan, 'terminal'), h.deps)).exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.path.slice(r.path.lastIndexOf('/') + 1), r.body])).toEqual([
    ['desk_open', { metadata: { ticketState: 'CLOSED' } }],
    ['desk_done', { metadata: { ticketState: 'OPEN' } }],
  ])
})

test('a pipeline of an object Kalup does not write is compared: a difference is a note, a create is blocked', async () => {
  const lifecycle: SimPipelineInput = {
    id: 'contacts-lifecycle-pipeline',
    label: 'Lifecycle',
    stages: [{ id: 'subscriber', label: 'Subscriber' }],
  }
  const text = (label: string) =>
    [
      "import { definePipeline } from '@kalup/core'",
      '',
      "export const LifecyclePipeline = definePipeline('contacts', {",
      "  id: 'contacts-lifecycle-pipeline',",
      `  label: '${label}',`,
      '  displayOrder: 0,',
      "  stages: { subscriber: { id: 'subscriber', label: 'Subscriber' } },",
      '})',
      '',
    ].join('\n')
  const sim = withPipelines({ contacts: [lifecycle] })
  const files = (label: string) => loadProject([withDeals], { 'hubspot/pipelines/contacts.ts': text(label) })
  const compared = await planOn(sim, files('Lifecycle stages'), companiesOnly())
  // With no base the label is held as diverged, as anywhere; a config change it would write becomes a note.
  expect(compared.steps.find((s) => s.address === 'pipeline:contacts/contacts-lifecycle-pipeline')).toMatchObject({
    action: 'adopt',
    held: [{ unit: 'label', class: 'diverged' }],
  })
  const base = {
    ...companiesOnly(),
    resources: {
      ...companiesOwned,
      'pipeline:contacts/contacts-lifecycle-pipeline': {
        origin: 'adopted' as const,
        id: 'contacts-lifecycle-pipeline',
        normVersion: 1,
        base: { displayOrder: 0, label: 'Lifecycle', stages: ['subscriber'] },
      },
    },
  }
  const noted = await planOn(sim, files('Lifecycle stages'), base)
  expect(noted.steps.find((s) => s.address === 'pipeline:contacts/contacts-lifecycle-pipeline')).toMatchObject({
    action: 'update',
    notes: [{ unit: 'label', note: expect.stringContaining('Kalup reads and compares the pipelines of contacts') }],
  })
  expect(noted.steps.every((s) => (s.changes ?? []).length === 0)).toBe(true)
  expect(compared.steps.every((s) => (s.changes ?? []).length === 0)).toBe(true)
  const created = await planOn(withPipelines({}), files('Lifecycle'), companiesOnly())
  expect(created.steps.find((s) => s.address === 'pipeline:contacts/contacts-lifecycle-pipeline')).toMatchObject({
    risk: 'blocked',
    blocked: { reason: 'unsupported' },
  })
})

test('a pipelines list the key cannot read blocks its pipelines and stages, and leaves the properties planned', async () => {
  const sim = withPipelines({ deals: [live] })
  sim.fault({ method: 'GET', path: deals, action: { kind: 'status', status: 403, body: { status: 'error', category: 'MISSING_SCOPES', message: 'missing scopes' } } })
  const plan = await planOn(sim, project(), owned())
  expect(plan.coverage).toMatchObject({ complete: false, unreadable: [{ object: 'deals' }] })
  expect(plan.steps.map((s) => [s.address, s.action, s.blocked?.reason])).toEqual([
    [orchard, 'unknown', 'scope'],
    [signed, 'unknown', 'scope'],
    [tasting, 'unknown', 'scope'],
  ])
})

test('an adopt of a pipeline the portal holds records the agreed values of the pipeline and each stage', async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  h.deps.store.write(companiesOnly(), null)
  const plan = await planOn(sim, project(), companiesOnly())
  expect(plan.steps.map((s) => [s.address, s.action, s.baseUnits])).toEqual([
    [orchard, 'adopt', ['displayOrder', 'label', 'stages']],
    [signed, 'adopt', ['label', 'probability']],
    [tasting, 'adopt', ['label', 'probability']],
  ])
  expect((await executePlan(request(plan), h.deps)).exitCode).toBe(0)
  expect(sim.writes()).toEqual([])
  const state = h.deps.store.read(portalId) as TargetState
  expect(state.resources[orchard]).toMatchObject({ origin: 'adopted', id: 'orchard_sales' })
  expect((await planOn(sim, project(), state)).steps).toEqual([])
})
