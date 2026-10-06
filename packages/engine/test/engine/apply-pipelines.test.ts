// Pipelines and stages through plan and the executor against the simulator: a pipeline create that carries its stages,
// a stage added in the middle and the order written stage by stage, metadata updates, held drift, the deletes and their
// rules, and what Kalup reads and compares but does not write.

import { expect, test } from 'vitest'
import { executePlan } from '../../src/engine/apply.js'
import { stepTitle } from '../../src/engine/apply-check.js'
import { namesOf } from '../../src/engine/apply-observe.js'
import { writesHash } from '../../src/engine/digest.js'
import { planText } from '../../src/engine/plan.js'
import type { TargetState } from '../../src/ir/state.js'
import type { Plan, PlanStep } from '../../src/plan/types.js'
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

const withDeals: Edit = [
  files.config,
  'companies: {},',
  'companies: {},\n    deals: {},\n    tickets: {},\n    contacts: {},',
]

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
      [tasting]: {
        origin: 'created',
        id: 'orchard_tasting',
        normVersion: 1,
        base: { label: 'Tasting', probability: 0.2 },
      },
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
      written: { displayOrder: expect.any(String), label: expect.any(String), stages: expect.any(String) },
      writtenAt: expect.any(String),
    },
    [signed]: {
      origin: 'created',
      id: 'orchard_signed',
      normVersion: 1,
      base: { label: 'Signed', probability: 1 },
      written: { label: expect.any(String), probability: expect.any(String) },
      writtenAt: expect.any(String),
    },
    [tasting]: {
      origin: 'created',
      id: 'orchard_tasting',
      normVersion: 1,
      base: { label: 'Tasting', probability: 0.2 },
      written: { label: expect.any(String), probability: expect.any(String) },
      writtenAt: expect.any(String),
    },
  })
  expect((await planOn(sim, project(), state)).steps).toEqual([])
})

test('a pipeline create whose every stage the target skips is blocked: HubSpot refuses a pipeline without one', async () => {
  const skipped: Edit = [
    files.config,
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
    `credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: { '${tasting}': { skip: true }, '${signed}': { skip: true } },`,
  ]
  const plan = await planOn(
    withPipelines({}),
    loadProject([withDeals, skipped], { [PIPELINES]: dealPipeline(twoStages) }),
    companiesOnly(),
  )
  expect(plan.steps).toMatchObject([
    {
      address: orchard,
      action: 'create',
      risk: 'blocked',
      blocked: {
        reason: 'override',
        detail: `every stage of ${orchard} is skipped on target sandbox, and HubSpot refuses a pipeline without one`,
      },
    },
  ])
})

test('a stage a pipeline create carried that HubSpot stores otherwise is recorded with its rewrite', async () => {
  const sim = withPipelines({})
  // HubSpot stores the signed stage's label otherwise than sent.
  const { fetch: answered } = sim
  sim.fetch = async (input, init) => {
    const answer = await answered(input, init)
    const stage = sim
      .portal(portalId)
      .pipelines.get('deals')?.[0]
      ?.stages.find((st) => st.id === 'orchard_signed')
    if (stage) {
      stage.label = 'Signed.'
    }
    return answer
  }
  const h = await harness(sim)
  h.deps.store.write(companiesOnly(), null)
  const applied = await executePlan(request(await planOn(sim, project(), companiesOnly())), h.deps)
  expect(applied.data.steps.map((s) => [s.outcome, s.units])).toEqual([['unverified', ['orchard_signed.label']]])
  const state = h.deps.store.read(portalId) as TargetState
  expect(state.resources[signed]).toEqual({
    origin: 'created',
    id: 'orchard_signed',
    normVersion: 1,
    base: { probability: 1 },
    rewrites: { label: { sent: 'Signed', stored: 'Signed.' } },
    written: { probability: expect.any(String) },
    writtenAt: expect.any(String),
  })
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

test('two deal stages appended out of address order: the plan sets the order, and apply leaves config order', async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const appended = dealPipeline([
    first,
    last,
    ['zeta', 'orchard_zeta', 'Zeta', 0.4],
    ['alpha', 'orchard_alpha', 'Alpha', 0.6],
  ])
  const plan = await planOn(sim, project(appended), owned())
  expect(plan.steps.find((s) => s.address === orchard)?.changes).toMatchObject([
    { unit: 'stages', after: ['orchard_tasting', 'orchard_signed', 'orchard_zeta', 'orchard_alpha'] },
  ])
  expect((await executePlan(request(plan), h.deps)).exitCode).toBe(0)
  const stages = sim.portal(portalId).pipelines.get('deals')?.[0]?.stages ?? []
  expect([...stages].sort((a, b) => a.displayOrder - b.displayOrder).map((st) => st.id)).toEqual([
    'orchard_tasting',
    'orchard_signed',
    'orchard_zeta',
    'orchard_alpha',
  ])
  expect((await planOn(sim, project(appended), h.deps.store.read(portalId))).steps).toEqual([])
})

test('a closing ticket stage appended after an open one: created first, then moved back into config order', async () => {
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
    "    open: { id: 'desk_open', label: 'Open', ticketState: 'OPEN' },",
    "    done: { id: 'desk_done', label: 'Done', ticketState: 'CLOSED' },",
    "    proposal: { id: 'desk_a_proposal', label: 'Proposal', ticketState: 'OPEN' },",
    "    closing: { id: 'desk_b_closing', label: 'Closing', ticketState: 'CLOSED' },",
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
      'stage:tickets/orchard_desk/desk_done': {
        origin: 'created',
        id: 'desk_done',
        normVersion: 1,
        base: { label: 'Done', ticketState: 'CLOSED' },
      },
      'stage:tickets/orchard_desk/desk_open': {
        origin: 'created',
        id: 'desk_open',
        normVersion: 1,
        base: { label: 'Open', ticketState: 'OPEN' },
      },
    },
  }
  h.deps.store.write(state, null)
  const loaded = loadProject([withDeals], { 'hubspot/pipelines/tickets.ts': text })
  const plan = await planOn(sim, loaded, state)
  expect(plan.steps.find((s) => s.address === 'pipeline:tickets/orchard_desk')?.changes).toMatchObject([
    { unit: 'stages', after: ['desk_open', 'desk_done', 'desk_a_proposal', 'desk_b_closing'] },
  ])
  expect((await executePlan(request(plan), h.deps)).exitCode).toBe(0)
  const stages = sim.portal(portalId).pipelines.get('tickets')?.[0]?.stages ?? []
  expect([...stages].sort((a, b) => a.displayOrder - b.displayOrder).map((st) => st.id)).toEqual([
    'desk_open',
    'desk_done',
    'desk_a_proposal',
    'desk_b_closing',
  ])
  expect((await planOn(sim, loaded, h.deps.store.read(portalId))).steps).toEqual([])
})

test('the plan text shows a stage order by label, never by the IDs HubSpot assigned in its UI', async () => {
  const ui: SimPipelineInput = {
    ...live,
    stages: [
      { id: '700100301', label: 'Tasting', metadata: { probability: '0.2' } },
      { id: '700100302', label: 'Signed', metadata: { probability: '1.0' } },
    ],
  }
  const text = dealPipeline([
    ['signed', '700100302', 'Signed', 1],
    ['tasting', '700100301', 'Tasting', 0.2],
  ])
  const plan = await planOn(withPipelines({ deals: [ui] }), project(text), companiesOnly())
  expect(plan.steps.find((s) => s.address === orchard)?.stageLabels).toEqual({
    '700100301': 'Tasting',
    '700100302': 'Signed',
  })
  expect(
    planText(plan)
      .split('\n')
      .filter((line) => line.includes('stage order')),
  ).toEqual([
    '  held stage order diverged: config "Signed", "Tasting", portal "Tasting", "Signed". Take the portal side: kalup pull --target sandbox --only pipeline:deals/orchard_sales; take config: kalup plan --target sandbox --take config \'pipeline:deals/orchard_sales#stages\'',
  ])
})

const stagePatch = /^\/crm\/pipelines\/2026-09\/deals\/orchard_sales\/stages\/[^/]+$/
const rateLimited = {
  status: 'error',
  category: 'RATE_LIMITS',
  message: 'You have reached your ten_secondly_rolling limit.',
}

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
  sim.fault({
    method: 'PATCH',
    path: stagePatch,
    occurrence: 2,
    action: { kind: 'status', status: 429, body: rateLimited },
  })
  const h = await harness(sim)
  const state = owned()
  Object.assign(state.resources, {
    [orchard]: {
      ...state.resources[orchard],
      base: {
        displayOrder: 1,
        label: 'Orchard sales',
        stages: ['orchard_tasting', 'orchard_signed', 'orchard_pressing'],
      },
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
  expect(sim.writes().map((r) => [r.method, r.path])).toEqual([
    ['DELETE', `${deals}/orchard_sales/stages/orchard_signed`],
  ])
  const state = h.deps.store.read(portalId) as TargetState
  expect(state.resources[signed]).toBeUndefined()
})

test('the last stage replaced: the new stage is created first, so its delete is not blocked', async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  const state = owned()
  delete state.resources[signed]
  state.resources[orchard] = {
    ...state.resources[orchard],
    base: { displayOrder: 1, label: 'Orchard sales', stages: ['orchard_tasting'] },
  } as TargetState['resources'][string]
  sim.portal(portalId).pipelines.get('deals')?.[0]?.stages.splice(1, 1)
  h.deps.store.write(state, null)
  const won: Stage = ['won', 'orchard_won', 'Won', 1]
  const loaded = loadProject([withDeals, allow], {
    [PIPELINES]: dealPipeline([won]),
    'hubspot/removed.ts': removed(tasting),
  })
  const plan = await planOn(sim, loaded, state)
  expect(plan.steps.map((s) => [s.address, s.action, s.risk])).toEqual([
    ['stage:deals/orchard_sales/orchard_won', 'create', 'safe'],
    [tasting, 'delete', 'destructive'],
  ])
  expect((await executePlan(request(plan, 'terminal'), h.deps)).exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path])).toEqual([
    ['POST', `${deals}/orchard_sales/stages`],
    ['DELETE', `${deals}/orchard_sales/stages/orchard_tasting`],
  ])
})

test("a ticket pipeline's last closed stage replaced by closing another: the close runs first, the delete goes", async () => {
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
    "  stages: { open: { id: 'desk_open', label: 'Open', ticketState: 'CLOSED' } },",
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
      'stage:tickets/orchard_desk/desk_done': {
        origin: 'created',
        id: 'desk_done',
        normVersion: 1,
        base: { label: 'Done', ticketState: 'CLOSED' },
      },
      'stage:tickets/orchard_desk/desk_open': {
        origin: 'created',
        id: 'desk_open',
        normVersion: 1,
        base: { label: 'Open', ticketState: 'OPEN' },
      },
    },
  }
  h.deps.store.write(state, null)
  const loaded = loadProject([withDeals, allow], {
    'hubspot/pipelines/tickets.ts': text,
    'hubspot/removed.ts': removed('stage:tickets/orchard_desk/desk_done'),
  })
  const plan = await planOn(sim, loaded, state)
  expect(plan.steps.map((s) => [s.address, s.action, s.risk])).toEqual([
    ['stage:tickets/orchard_desk/desk_open', 'update', 'risky'],
    ['stage:tickets/orchard_desk/desk_done', 'delete', 'destructive'],
  ])
  expect((await executePlan(request(plan, 'terminal'), h.deps)).exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path.slice(r.path.lastIndexOf('/') + 1)])).toEqual([
    ['PATCH', 'desk_open'],
    ['DELETE', 'desk_done'],
  ])
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

test.each([
  [orchard, 'owns nothing of it', companiesOnly],
  [orchard, 'owns it', owned],
  [signed, 'owns nothing of it', companiesOnly],
  [signed, 'owns it', owned],
])(
  'a delete of %s labelled takeover is refused when state %s: takeover never deletes either',
  async (address, _, held) => {
    const sim = withPipelines({ deals: [live] })
    const h = await harness(sim)
    h.deps.store.write(held(), null)
    const more: Record<string, string> = address === signed ? { [PIPELINES]: dealPipeline([first]) } : {}
    const loaded = loadProject([withDeals, allow], { ...more, 'hubspot/removed.ts': removed(address) })
    // Planned against state that owns it, then labelled takeover and sealed again by hand.
    const plan = await planOn(sim, loaded, owned())
    expect(plan.steps).toMatchObject([{ address, action: 'delete', risk: 'destructive' }])
    const edited: Plan = { ...plan, steps: plan.steps.map((s) => ({ ...s, labels: ['takeover' as const] })) }
    const hash = writesHash(edited)
    const sealed = { ...edited, writesHash: hash, planId: `pl_${hash.slice(7, 19)}` }
    await expect(executePlan(request(sealed, 'terminal'), h.deps)).rejects.toMatchObject({
      issues: [{ code: 'E_PLAN_RISK', message: expect.stringContaining('takeover archives properties and groups') }],
    })
    expect(sim.writes()).toEqual([])
  },
)

test('a stage added in HubSpot after the review stops the pipeline delete stale, before the purge', async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const loaded = loadProject([withDeals, allow], { 'hubspot/removed.ts': removed(orchard) })
  const plan = await planOn(sim, loaded, owned())
  expect(plan.steps[0]?.expect.values?.stages).toEqual(['orchard_tasting', 'orchard_signed'])
  const at = '2026-09-25T09:00:00.000Z'
  sim
    .portal(portalId)
    .pipelines.get('deals')?.[0]
    ?.stages.push({
      id: 'orchard_lost',
      label: 'Lost',
      displayOrder: 2,
      metadata: { probability: '0.0', isClosed: 'true' },
      archived: false,
      createdAt: at,
      updatedAt: at,
      writePermissions: 'CRM_PERMISSIONS_ENFORCEMENT',
    })
  await expect(executePlan(request(plan, 'terminal'), h.deps)).rejects.toMatchObject({
    issues: [{ code: 'E_PLAN_STALE', message: expect.stringContaining(`${orchard} stages`) }],
  })
  expect(sim.writes()).toEqual([])
})

// State owning the orchard pipeline with a base that holds no stage order, and its stages.
function ownedWithoutOrder(): TargetState {
  const state = owned()
  state.resources[orchard] = {
    origin: 'created',
    id: 'orchard_sales',
    normVersion: 1,
    base: { label: 'Orchard sales' },
  }
  return state
}

test('apply refuses a pipeline delete whose expect leaves out the stages it would purge', async () => {
  const sim = withPipelines({ deals: [live] })
  const h = await harness(sim)
  h.deps.store.write(ownedWithoutOrder(), null)
  const loaded = loadProject([withDeals, allow], { 'hubspot/removed.ts': removed(orchard) })
  const plan = await planOn(sim, loaded, ownedWithoutOrder())
  const [step] = plan.steps as [PlanStep]
  const { stages: _, ...values } = step.expect.values ?? {}
  const edited: Plan = { ...plan, steps: [{ ...step, expect: { exists: true, values } }] }
  const hash = writesHash(edited)
  const sealed = { ...edited, writesHash: hash, planId: `pl_${hash.slice(7, 19)}` }
  await expect(executePlan(request(sealed, 'terminal'), h.deps)).rejects.toMatchObject({
    issues: [{ message: expect.stringContaining('its expect leaves out stages') }],
  })
  expect(sim.writes()).toEqual([])
})

test('a pipeline delete expects the full live stage list even when its base holds no stage order', async () => {
  const sim = withPipelines({ deals: [live] })
  const loaded = loadProject([withDeals, allow], { 'hubspot/removed.ts': removed(orchard) })
  const plan = await planOn(sim, loaded, ownedWithoutOrder())
  expect(plan.steps[0]?.expect).toEqual({
    exists: true,
    values: { label: 'Orchard sales', stages: ['orchard_tasting', 'orchard_signed'] },
  })
})

test("a stage's destroy under its pipeline's release is blocked with the reason, never dropped", async () => {
  const sim = withPipelines({ deals: [live] })
  const tombstones = [
    "import { defineRemoved } from '@kalup/core'",
    '',
    'export default defineRemoved({',
    `  '${orchard}': { action: 'release' },`,
    `  '${signed}': { action: 'destroy' },`,
    '})',
    '',
  ].join('\n')
  const loaded = loadProject([withDeals, allow], { 'hubspot/removed.ts': tombstones })
  const plan = await planOn(sim, loaded, owned())
  expect(plan.steps.map((s) => [s.address, s.action, s.risk, s.blocked?.detail])).toEqual([
    [orchard, 'release', 'safe', undefined],
    [
      signed,
      'delete',
      'blocked',
      `the tombstone of ${orchard} releases the pipeline with its stages, so Kalup no longer owns this stage to delete it`,
    ],
  ])
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
    deals: [
      {
        id: '700100200',
        label: 'Orchard sales',
        stages: [{ id: '700100201', label: 'Tasting', metadata: { probability: '0.2' } }],
      },
    ],
  })
  const text = dealPipeline([['tasting', '512700419', 'Tasting', 0.2]]).replace("'orchard_sales'", "'512700418'")
  const plan = await planOn(sim, project(text), companiesOnly())
  expect(plan.steps).toMatchObject([{ address: 'pipeline:deals/512700418', action: 'create', risk: 'risky' }])
  expect(plan.steps[0]?.notes?.map((n) => n.note)).toMatchInlineSnapshot(`
    [
      "HubSpot assigned the ID 512700418, 512700419 in another portal; the portal holds a pipeline "Orchard sales" as 700100200. If this portal holds the same pipeline under other IDs, add a name override for the pipeline and each stage under targets.sandbox.overrides instead of creating a copy",
      "HubSpot keeps pipeline IDs unique across deals and tickets, and this plan did not read the pipelines of tickets: HubSpot refuses the create if a ticket pipeline holds 512700418",
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

test('a deal pipeline create notes the ticket pipelines it did not read; the refusal names a fix that ends', async () => {
  const desk: SimPipelineInput = {
    id: 'orchard_sales',
    label: 'Desk',
    stages: [{ id: 'desk_done', label: 'Done', metadata: { ticketState: 'CLOSED' } }],
  }
  const sim = withPipelines({ tickets: [desk] })
  const h = await harness(sim)
  h.deps.store.write(companiesOnly(), null)
  const plan = await planOn(sim, project(), companiesOnly())
  expect(plan.steps).toMatchObject([{ address: orchard, action: 'create', risk: 'safe' }])
  expect(plan.steps[0]?.notes?.map((n) => n.note)).toEqual([
    'HubSpot keeps pipeline IDs unique across deals and tickets, and this plan did not read the pipelines of tickets: HubSpot refuses the create if a ticket pipeline holds orchard_sales',
  ])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.issues.map((i) => i.fix)).toEqual([
    'give the pipeline or stage another ID in config, then run kalup plan --target sandbox',
  ])
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
  const labelled = (label: string) => loadProject([withDeals], { 'hubspot/pipelines/contacts.ts': text(label) })
  const compared = await planOn(sim, labelled('Lifecycle stages'), companiesOnly())
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
  const noted = await planOn(sim, labelled('Lifecycle stages'), base)
  expect(noted.steps.find((s) => s.address === 'pipeline:contacts/contacts-lifecycle-pipeline')).toMatchObject({
    action: 'update',
    notes: [{ unit: 'label', note: expect.stringContaining('Kalup reads and compares the pipelines of contacts') }],
  })
  expect(noted.steps.every((s) => (s.changes ?? []).length === 0)).toBe(true)
  expect(compared.steps.every((s) => (s.changes ?? []).length === 0)).toBe(true)
  const created = await planOn(withPipelines({}), labelled('Lifecycle'), companiesOnly())
  expect(created.steps.find((s) => s.address === 'pipeline:contacts/contacts-lifecycle-pipeline')).toMatchObject({
    risk: 'blocked',
    blocked: { reason: 'unsupported' },
  })
})

test("apply's titles for pipeline and stage steps read as the plan's, with no portal rename where there is none", async () => {
  const sim = withPipelines({ deals: [live] })
  const plans = [
    await planOn(withPipelines({}), project(), companiesOnly()),
    await planOn(sim, project(dealPipeline([first, pressing, last])), owned()),
    await planOn(sim, project(dealPipeline([['tasting', 'orchard_tasting', 'Tasted', 0.3], last])), owned()),
    await planOn(sim, loadProject([withDeals, allow], { 'hubspot/removed.ts': removed(orchard) }), owned()),
    await planOn(
      sim,
      loadProject([withDeals, allow], { [PIPELINES]: dealPipeline([first]), 'hubspot/removed.ts': removed(signed) }),
      owned(),
    ),
  ]
  const steps = plans.flatMap((plan) => plan.steps.map((step) => [step.title, stepTitle(step, namesOf(plan), true)]))
  expect(steps.map(([title]) => title)).toMatchInlineSnapshot(`
    [
      "Create pipeline "Orchard sales" (orchard_sales) on deals with 2 stages",
      "Update pipeline "Orchard sales" (orchard_sales) on deals, set the stage order",
      "Create stage "Pressing" (orchard_pressing) of pipeline orchard_sales on deals",
      "Update stage "Tasted" (orchard_tasting) of pipeline orchard_sales on deals, set label, probability (the effect on existing values is not checked)",
      "Delete pipeline "Orchard sales" (orchard_sales) on deals; it cannot be restored",
      "Delete stage "Signed" (orchard_signed) of pipeline orchard_sales on deals; it cannot be restored",
    ]
  `)
  expect(steps.filter(([title, redrawn]) => title !== redrawn)).toEqual([])
})

test('a destroy tombstone on a pipeline of an object Kalup does not write is blocked, with the release fix', async () => {
  const lifecycle: SimPipelineInput = {
    id: 'contacts-lifecycle-pipeline',
    label: 'Lifecycle',
    stages: [{ id: 'subscriber', label: 'Subscriber' }],
  }
  const state: TargetState = {
    ...companiesOnly(),
    resources: {
      ...companiesOwned,
      'pipeline:contacts/contacts-lifecycle-pipeline': {
        origin: 'adopted',
        id: 'contacts-lifecycle-pipeline',
        normVersion: 1,
        base: { displayOrder: 0, label: 'Lifecycle', stages: ['subscriber'] },
      },
    },
  }
  const tombstone = removed('pipeline:contacts/contacts-lifecycle-pipeline')
  const loaded = loadProject([withDeals, allow], { 'hubspot/removed.ts': tombstone })
  const plan = await planOn(withPipelines({ contacts: [lifecycle] }), loaded, state)
  expect(plan.steps).toMatchObject([
    {
      address: 'pipeline:contacts/contacts-lifecycle-pipeline',
      action: 'delete',
      risk: 'blocked',
      blocked: {
        reason: 'unsupported',
        detail: expect.stringContaining('Kalup reads and compares the pipelines of contacts'),
        fix: expect.stringContaining('action to release'),
      },
    },
  ])
})

test('a pipelines list the key cannot read blocks its pipelines and stages, and leaves the properties planned', async () => {
  const sim = withPipelines({ deals: [live] })
  sim.fault({
    method: 'GET',
    path: deals,
    action: {
      kind: 'status',
      status: 403,
      body: { status: 'error', category: 'MISSING_SCOPES', message: 'missing scopes' },
    },
  })
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

// The tasting stage under another ID on the sandbox portal, as a stage made in the HubSpot UI of each portal is.
const tastingUi: Edit = [
  files.config,
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: { 'stage:deals/orchard_sales/orchard_tasting': { name: 'tasting_ui' } },",
]
const liveUi: SimPipelineInput = {
  ...live,
  stages: [{ id: 'tasting_ui', label: 'Tasting', metadata: { probability: '0.2' } }, ...live.stages.slice(1)],
}
function ownedUi(): TargetState {
  const state = owned()
  state.resources[tasting] = {
    origin: 'created',
    id: 'tasting_ui',
    normVersion: 1,
    base: { label: 'Tasting', probability: 0.2 },
  }
  return state
}

test('a stage name override binds the stage in a reorder: the plan carries it, and apply moves the stage by its ID', async () => {
  const sim = withPipelines({ deals: [liveUi] })
  const h = await harness(sim)
  h.deps.store.write(ownedUi(), null)
  const loaded = loadProject([withDeals, tastingUi], { [PIPELINES]: dealPipeline([last, first]) })
  const plan = await planOn(sim, loaded, ownedUi())
  expect(plan.bindings).toMatchObject({ [tasting]: { name: 'tasting_ui' } })
  expect((await executePlan(request(plan), h.deps)).exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path, r.body])).toEqual([
    ['PATCH', `${deals}/orchard_sales/stages/tasting_ui`, { displayOrder: 1 }],
  ])
})

test('a pipeline delete holds no stage override, since an override names a config address and its stages left', () => {
  const removing = () => loadProject([withDeals, allow, tastingUi], { 'hubspot/removed.ts': removed(orchard) })
  expect(removing).toThrow('E_UNKNOWN_OVERRIDE')
})

test('a stage delete beside a renamed stage reads the pipeline by its bindings and deletes the stage alone', async () => {
  const sim = withPipelines({ deals: [liveUi] })
  const h = await harness(sim)
  h.deps.store.write(ownedUi(), null)
  const loaded = loadProject([withDeals, allow, tastingUi], {
    [PIPELINES]: dealPipeline([first]),
    'hubspot/removed.ts': removed(signed),
  })
  const plan = await planOn(sim, loaded, ownedUi())
  expect(plan.steps.map((s) => [s.address, s.action])).toEqual([[signed, 'delete']])
  expect((await executePlan(request(plan, 'terminal'), h.deps)).exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path])).toEqual([
    ['DELETE', `${deals}/orchard_sales/stages/orchard_signed`],
  ])
})
