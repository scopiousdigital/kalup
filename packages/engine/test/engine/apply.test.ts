// The executor with an injected clock and the simulator: what reaches the portal, what state records, and what a run
// reports when a write is uncertain, waited out, refused, interrupted or stored differently.

import { expect, test } from 'vitest'
import { executePlan, type Journal, nothingToApply } from '../../src/engine/apply.js'
import type { TargetState } from '../../src/ir/state.js'
import { KalupError } from '../../src/lib/errors.js'
import type { Plan, PlanStep } from '../../src/plan/types.js'
import { fault, type PortalSim } from '../support/portal-sim.js'
import {
  companies,
  type Edit,
  files,
  groups,
  type Harness,
  harness,
  loadProject,
  orchardGroup,
  planOn,
  portalId,
  request,
  sent,
  simPortal,
  soilPh,
  soilPhProperty,
} from './apply-harness.js'

const lineage = '0a1b2c3d4e5f6071'
const relabel: Edit = [files.companies, "label: 'Soil pH'", "label: 'Soil acidity'"]

/** State that owns the orchard group and soil_ph, agreeing with the fixture config. */
function owned(extra: TargetState['resources'] = {}): TargetState {
  return {
    format: 'kalup.state/1',
    lineage,
    serial: 4,
    portalId,
    resources: {
      'group:companies/orchard': { origin: 'created', id: 'orchard', normVersion: 1, base: { label: 'Orchard' } },
      [soilPh]: {
        origin: 'created',
        id: 'soil_ph',
        normVersion: 1,
        base: { fieldType: 'number', group: { $ref: 'group:companies/orchard' }, label: 'Soil pH', type: 'number' },
      },
      ...extra,
    },
  }
}

/** A portal that holds the applied group and soil_ph, and a harness whose state owns them. */
async function appliedPortal(extra: Parameters<typeof simPortal>[1] = {}) {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] }, extra)
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  return { sim, h }
}

function stateOf(h: Harness): TargetState {
  return h.deps.store.read(portalId) as TargetState
}

test('an update PATCHes exactly the approved unit with the live type and fieldType, and advances the base', async () => {
  const { sim, h } = await appliedPortal()
  const plan = await planOn(sim, loadProject([relabel]), owned())
  expect(plan.steps).toMatchObject([{ address: soilPh, action: 'update', risk: 'safe' }])
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path, r.body])).toEqual([
    ['PATCH', `${companies}/soil_ph`, { label: 'Soil acidity', type: 'number', fieldType: 'number' }],
  ])
  expect(sent(sim, from)).toEqual([
    `GET ${companies}`,
    `GET ${companies}`,
    `GET ${companies}`,
    `GET ${groups}`,
    `GET ${companies}/soil_ph`,
    `PATCH ${companies}/soil_ph`,
    `GET ${companies}/soil_ph`,
  ])
  const state = stateOf(h)
  expect(state.resources[soilPh]?.base).toMatchObject({ label: 'Soil acidity' })
  // Three saves: the running record, the step, the final record.
  expect(state.serial).toBe(7)
  expect(state.lastApply).toMatchObject({ outcome: 'done', actor: 'yes', at: '2026-09-25T09:00:00.000Z' })
  expect([...h.host.held]).toEqual([])
})

test('display, order and hidden changes PATCH those units, read back, and advance the base', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  // A base as a 0.2 pull or apply records it: the fields config leaves out, agreed at what HubSpot holds for them.
  const agreed = owned({
    [soilPh]: {
      origin: 'created',
      id: 'soil_ph',
      normVersion: 1,
      base: {
        displayOrder: -1,
        fieldType: 'number',
        group: { $ref: 'group:companies/orchard' },
        hidden: false,
        label: 'Soil pH',
        numberDisplayHint: 'formatted',
        type: 'number',
      },
    },
  })
  h.deps.store.write(agreed, null)
  const shown: Edit = [
    files.companies,
    "fieldType: 'number',",
    "fieldType: 'number',\n      hidden: true,\n      displayOrder: 2,\n      numberDisplayHint: 'percentage',",
  ]
  const plan = await planOn(sim, loadProject([shown]), agreed)
  expect(plan.steps).toMatchObject([
    {
      address: soilPh,
      action: 'update',
      risk: 'safe',
      changes: [{ unit: 'displayOrder' }, { unit: 'hidden' }, { unit: 'numberDisplayHint' }],
    },
  ])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(sim.writes().map((r) => r.body)).toEqual([
    { displayOrder: 2, hidden: true, numberDisplayHint: 'percentage', type: 'number', fieldType: 'number' },
  ])
  expect(stateOf(h).resources[soilPh]?.base).toMatchObject({
    displayOrder: 2,
    hidden: true,
    numberDisplayHint: 'percentage',
  })
  expect((await planOn(sim, loadProject([shown]), stateOf(h))).steps).toEqual([])
})

test('a boolean is created with its two options, an owner with its external options, a sensitive property read back under its sensitivity', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const added: Edit = [
    files.companies,
    '  properties: {',
    [
      '  properties: {',
      "    grower: p.owner('grower', { label: 'Grower', group: 'orchard', fieldType: 'select' }),",
      "    growerTaxRef: p.string('grower_tax_ref', { label: 'Grower tax reference', group: 'orchard', fieldType: 'text', dataSensitivity: 'sensitive' }),",
      "    organic: p.boolean('organic', { label: 'Organic', group: 'orchard', fieldType: 'booleancheckbox' }),",
    ].join('\n'),
  ]
  const plan = await planOn(sim, loadProject([added]))
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  const posts = sim.writes().filter((r) => r.method === 'POST' && r.path === companies)
  expect(Object.fromEntries(posts.map((r) => [(r.body as { name: string }).name, r.body]))).toMatchObject({
    grower: { type: 'enumeration', fieldType: 'select', externalOptions: true, referencedObjectType: 'OWNER' },
    grower_tax_ref: { dataSensitivity: 'sensitive' },
    organic: {
      type: 'bool',
      options: [
        { label: 'Yes', value: 'true', displayOrder: 0, hidden: false },
        { label: 'No', value: 'false', displayOrder: 1, hidden: false },
      ],
    },
  })
  // Before the create and after it, the single read asks for the sensitivity the create sends.
  const reads = sim.log.slice(from).filter((r) => r.path === `${companies}/grower_tax_ref`)
  expect(reads.map((r) => [r.method, r.query, r.status])).toEqual([
    ['GET', { dataSensitivity: 'sensitive' }, 404],
    ['GET', { dataSensitivity: 'sensitive' }, 200],
  ])
  expect(Object.keys(stateOf(h).resources)).toEqual(
    expect.arrayContaining([
      'property:companies/grower',
      'property:companies/grower_tax_ref',
      'property:companies/organic',
    ]),
  )
})

test('a group update PATCHes its label alone', async () => {
  const { sim, h } = await appliedPortal()
  const plan = await planOn(
    sim,
    loadProject([[files.companies, "{ label: 'Orchard' }", "{ label: 'Orchard details' }"]]),
    owned(),
  )
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(sim.writes().map((r) => [r.method, r.path, r.body])).toEqual([
    ['PATCH', `${groups}/orchard`, { label: 'Orchard details' }],
  ])
  expect(stateOf(h).resources).toHaveProperty(['group:companies/orchard', 'base'], { label: 'Orchard details' })
})

test('an option added in config: every live option sent unchanged, the new one after the highest displayOrder', async () => {
  const tier = {
    name: 'yield_tier',
    label: 'Yield tier',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'orchard',
    options: [
      { value: 'low', label: 'Low', displayOrder: 0, hidden: false },
      { value: 'high', label: 'High', displayOrder: 1, hidden: false, description: 'Top band' },
    ],
  }
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty, tier] })
  const h = await harness(sim)
  const tierAddress = 'property:companies/yield_tier'
  const state = owned({
    [tierAddress]: {
      origin: 'adopted',
      id: 'yield_tier',
      normVersion: 1,
      base: {
        fieldType: 'select',
        group: { $ref: 'group:companies/orchard' },
        label: 'Yield tier',
        options: { high: { hidden: false, label: 'High' }, low: { hidden: false, label: 'Low' } },
        optionsOrder: ['low', 'high'],
        type: 'enumeration',
      },
    },
  })
  h.deps.store.write(state, null)
  const enumProperty = `    yieldTier: p.enum('yield_tier', {
      label: 'Yield tier',
      group: 'orchard',
      fieldType: 'select',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
        { value: 'trial', label: 'Trial' },
      ],
    }),
`
  const loaded = loadProject([[files.companies, '  properties: {\n', `  properties: {\n${enumProperty}`]])
  const plan = await planOn(sim, loaded, state)
  expect(plan.steps).toMatchObject([{ address: tierAddress, action: 'update', risk: 'safe' }])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode, JSON.stringify(applied.issues)).toBe(0)
  expect(sim.writes()[0]?.body).toEqual({
    type: 'enumeration',
    fieldType: 'select',
    options: [
      { value: 'low', label: 'Low', displayOrder: 0, hidden: false },
      { value: 'high', label: 'High', displayOrder: 1, hidden: false, description: 'Top band' },
      { value: 'trial', label: 'Trial', displayOrder: 2, hidden: false },
    ],
  })
  expect(stateOf(h).resources[tierAddress]?.base).toMatchObject({
    options: {
      high: { hidden: false, label: 'High' },
      low: { hidden: false, label: 'Low' },
      trial: { hidden: false, label: 'Trial' },
    },
    optionsOrder: ['low', 'high', 'trial'],
  })
  // The order of the members both sides now hold is agreed too, so nothing is left to record.
  expect((await planOn(sim, loaded, stateOf(h))).steps).toEqual([])
})

test('a kept option with no displayOrder: the plan sets options.order, and the PATCH renumbers every option', async () => {
  const tier = {
    name: 'yield_tier',
    label: 'Yield tier',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'orchard',
    options: [
      { value: 'low', label: 'Low', displayOrder: 0, hidden: false },
      { value: 'high', label: 'High', displayOrder: -1, hidden: false },
    ],
  }
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty, tier] })
  const h = await harness(sim)
  const tierAddress = 'property:companies/yield_tier'
  const state = owned({
    [tierAddress]: {
      origin: 'adopted',
      id: 'yield_tier',
      normVersion: 1,
      base: {
        fieldType: 'select',
        group: { $ref: 'group:companies/orchard' },
        label: 'Yield tier',
        options: { high: { hidden: false, label: 'High' }, low: { hidden: false, label: 'Low' } },
        optionsOrder: ['low', 'high'],
        type: 'enumeration',
      },
    },
  })
  h.deps.store.write(state, null)
  const enumProperty = `    yieldTier: p.enum('yield_tier', {
      label: 'Yield tier',
      group: 'orchard',
      fieldType: 'select',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
        { value: 'trial', label: 'Trial' },
      ],
    }),
`
  const loaded = loadProject([[files.companies, '  properties: {\n', `  properties: {\n${enumProperty}`]])
  const plan = await planOn(sim, loaded, state)
  expect(plan.steps[0]?.changes?.map((c) => [c.unit, c.after])).toEqual([
    ['options.order', ['low', 'high', 'trial']],
    ['options[trial]', { value: 'trial', label: 'Trial' }],
  ])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode, JSON.stringify(applied.issues)).toBe(0)
  // Without the renumber, high (-1) would show after trial (2).
  expect(sim.writes()[0]?.body).toEqual({
    type: 'enumeration',
    fieldType: 'select',
    options: [
      { value: 'low', label: 'Low', displayOrder: 0, hidden: false },
      { value: 'high', label: 'High', displayOrder: 1, hidden: false },
      { value: 'trial', label: 'Trial', displayOrder: 2, hidden: false },
    ],
  })
  expect(stateOf(h).resources[tierAddress]?.base).toMatchObject({ optionsOrder: ['low', 'high', 'trial'] })
})

test('adopting what already agrees sends no write: ownership and the base come from the fresh read', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const plan = await planOn(sim, loadProject())
  expect(plan.steps.map((s) => [s.action, s.baseUnits])).toEqual([
    ['adopt', ['label']],
    ['adopt', ['fieldType', 'group', 'label', 'type']],
  ])
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(sim.writes()).toEqual([])
  expect(stateOf(h).resources).toEqual({
    'group:companies/orchard': { origin: 'adopted', id: 'orchard', normVersion: 1, base: { label: 'Orchard' } },
    [soilPh]: {
      origin: 'adopted',
      id: 'soil_ph',
      normVersion: 1,
      // The fields config leaves out are agreed at what HubSpot holds for them, so config adding one is its change.
      base: {
        dataSensitivity: 'non_sensitive',
        description: '',
        displayOrder: -1,
        fieldType: 'number',
        formField: false,
        group: { $ref: 'group:companies/orchard' },
        hasUniqueValue: false,
        hidden: false,
        label: 'Soil pH',
        numberDisplayHint: 'formatted',
        showCurrencySymbol: false,
        type: 'number',
      },
    },
  })
})

test('a unit held as diverged at adoption stays held on the next plan, so apply --yes never writes it', async () => {
  // Made in the HubSpot UI with no description and formField off; the file states both.
  const sim = simPortal({
    groups: [orchardGroup],
    properties: [{ ...soilPhProperty, description: '', formField: false }],
  })
  const h = await harness(sim)
  const stated: Edit = [
    files.companies,
    "fieldType: 'number',\n    }",
    "fieldType: 'number',\n      description: 'Hand-written',\n      formField: true,\n    }",
  ]
  const heldUnits = (plan: Plan) => plan.steps.find((s) => s.address === soilPh)?.held?.map((u) => [u.unit, u.class])
  const first = await planOn(sim, loadProject([stated]))
  expect(heldUnits(first)).toEqual([
    ['description', 'diverged'],
    ['formField', 'diverged'],
  ])
  const adopted = await executePlan(request(first), h.deps)
  expect(adopted.exitCode).toBe(0)
  expect(adopted.text).toContain(
    '2 values differ between config and HubSpot (edited in HubSpot, or never agreed) and are held, not written: run kalup plan --target sandbox to see them and how to settle them.',
  )
  const second = await planOn(sim, loadProject([stated]), stateOf(h))
  expect(second.steps.find((s) => s.address === soilPh)?.changes ?? []).toEqual([])
  expect(heldUnits(second)).toEqual([
    ['description', 'diverged'],
    ['formField', 'diverged'],
  ])
  // Nothing to apply, and the held units are said, so nobody takes the portal for matching config.
  expect(nothingToApply(second).text).toBe(
    `Nothing to apply: plan ${second.planId} writes nothing to HubSpot or state.\n2 values differ between config and HubSpot (edited in HubSpot, or never agreed) and are held, not written: run kalup plan --target sandbox to see them and how to settle them.\n`,
  )
  await executePlan(request(second), h.deps)
  expect(sim.writes()).toEqual([])
})

test('steps that send no request are saved together, before the next request goes out', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const saves: { requests: number; resources: string[] }[] = []
  const deps = {
    ...h.deps,
    store: {
      ...h.deps.store,
      write: (next: TargetState, expectSerial: number | null) => {
        saves.push({ requests: sim.log.length, resources: Object.keys(next.resources).sort() })
        return h.deps.store.write(next, expectSerial)
      },
    },
  }
  const treeCount: Edit = [
    files.companies,
    '  },\n})',
    "    treeCount: p.number('tree_count', { label: 'Tree count', group: 'orchard', fieldType: 'number' }),\n  },\n})",
  ]
  const plan = await planOn(sim, loadProject([treeCount]))
  expect(plan.steps.map((s) => s.action)).toEqual(['adopt', 'adopt', 'create'])
  const applied = await executePlan(request(plan), deps)
  expect(applied.exitCode).toBe(0)
  const post = sim.log.findIndex((r) => r.method === 'POST')
  const tree = 'property:companies/tree_count'
  // Running, both adoptions in one save before the POST, the create, the outcome.
  expect(saves.map((s) => s.resources)).toEqual([
    [],
    ['group:companies/orchard', soilPh],
    ['group:companies/orchard', soilPh, tree],
    ['group:companies/orchard', soilPh, tree],
  ])
  expect(saves[1]?.requests).toBeLessThanOrEqual(post)
})

/** The harness's deps with a store whose save number `failing` (1 is the running record) throws E_STATE_WRITE. */
function failingSave(h: Harness, failing: number): Harness['deps'] {
  let saves = 0
  return {
    ...h.deps,
    store: {
      ...h.deps.store,
      write: (next: TargetState, expectSerial: number | null) => {
        saves += 1
        if (saves === failing) {
          throw new KalupError({ code: 'E_STATE_WRITE', message: 'could not save it (ENOSPC).' })
        }
        return h.deps.store.write(next, expectSerial)
      },
    },
  }
}

test('a failed save of the batched entries stops the run before the next request: that step is not run', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const treeCount: Edit = [
    files.companies,
    '  },\n})',
    "    treeCount: p.number('tree_count', { label: 'Tree count', group: 'orchard', fieldType: 'number' }),\n  },\n})",
  ]
  const plan = await planOn(sim, loadProject([treeCount]))
  expect(plan.steps.map((s) => s.action)).toEqual(['adopt', 'adopt', 'create'])
  const applied = await executePlan(request(plan), failingSave(h, 2))
  expect(sim.writes()).toEqual([])
  expect(applied.data.steps.map((s) => [s.action, s.outcome, s.issue])).toEqual([
    ['adopt', 'done', undefined],
    ['adopt', 'done', undefined],
    ['create', 'not-run', 'E_STATE_WRITE'],
  ])
  expect(applied.issues.map((i) => i.code)).toContain('E_STATE_WRITE')
  expect(applied.exitCode).toBe(1)
  expect(stateOf(h).resources).toEqual({})
})

test('a failed save of the batched entries at the end of the run is reported, and the run does not finish', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const h = await harness(sim)
  const plan = await planOn(sim, loadProject())
  expect(plan.steps.map((s) => s.action)).toEqual(['adopt', 'adopt'])
  const applied = await executePlan(request(plan), failingSave(h, 2))
  expect(sim.writes()).toEqual([])
  expect(applied.issues.map((i) => i.code)).toContain('E_STATE_WRITE')
  expect(applied.exitCode).toBe(1)
  expect(applied.text).toContain('Did not finish')
  expect(stateOf(h).resources).toEqual({})
})

test('HubSpot storing another value than the one sent: W_UNVERIFIED, recorded in rewrites, and the next plan notes it', async () => {
  const { sim, h } = await appliedPortal()
  const wrapped: PortalSim = {
    ...sim,
    fetch: async (input, init) => {
      const answer = await sim.fetch(input, init)
      if (init?.method === 'PATCH') {
        Object.assign(sim.object(portalId, 'companies').properties.get('soil_ph') ?? {}, { label: 'SOIL ACIDITY' })
      }
      return answer
    },
  }
  const hh = await harness(wrapped)
  hh.deps.store.write(owned(), null)
  const plan = await planOn(sim, loadProject([relabel]), owned())
  const applied = await executePlan(request(plan), hh.deps)
  expect(applied.exitCode).toBe(5)
  expect(applied.data.steps).toEqual([
    { id: 's1', address: soilPh, action: 'update', outcome: 'unverified', units: ['label'], issue: 'W_UNVERIFIED' },
  ])
  expect(applied.issues[0]).toMatchObject({ code: 'W_UNVERIFIED' })
  expect(applied.issues[0]?.message).toContain('"SOIL ACIDITY", not "Soil acidity"')
  const entry = stateOf(hh).resources[soilPh]
  expect(entry?.base).toMatchObject({ label: 'Soil pH' })
  expect(entry?.rewrites).toEqual({ label: { sent: 'Soil acidity', stored: 'SOIL ACIDITY' } })
  const next = await planOn(sim, loadProject([relabel]), stateOf(hh))
  expect(next.steps[0]?.changes).toBeUndefined()
  expect(next.steps[0]?.notes?.[0]?.note).toContain('"SOIL ACIDITY" when sent "Soil acidity"')
  expect(h.host).not.toBe(hh.host)
})

test('a PATCH that times out is never resent: uncertain after the read-back deadline, exit 5, base kept', async () => {
  const { sim, h } = await appliedPortal()
  const plan = await planOn(sim, loadProject([relabel]), owned())
  sim.fault({ method: 'PATCH', path: `${companies}/soil_ph`, action: fault.timeout() })
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(5)
  expect(applied.data.outcome).toBe('uncertain')
  expect(applied.data.steps[0]).toMatchObject({ outcome: 'uncertain', issue: 'E_UNCERTAIN_WRITE' })
  expect(sim.writes().length).toBe(1)
  expect(h.clock.t - Date.parse('2026-09-25T09:00:00.000Z')).toBeGreaterThanOrEqual(60_000)
  expect(stateOf(h).resources[soilPh]?.base).toMatchObject({ label: 'Soil pH' })
  expect(stateOf(h).lastApply?.outcome).toBe('uncertain')
  expect(applied.text).toContain('kalup plan --target sandbox')
})

test('a read-back that waits more than a few seconds says so once; one that settles at once says nothing', async () => {
  const { sim, h } = await appliedPortal()
  const plan = await planOn(sim, loadProject([relabel]), owned())
  const lines: string[] = []
  sim.fault({ method: 'PATCH', path: `${companies}/soil_ph`, action: fault.timeout() })
  await executePlan(request(plan), { ...h.deps, progress: (line) => lines.push(line) })
  expect(lines).toMatchInlineSnapshot(`
    [
      "s1: waiting for HubSpot to show the result, up to 60 s",
    ]
  `)

  const quick = await appliedPortal()
  const again = await planOn(quick.sim, loadProject([relabel]), owned())
  const none: string[] = []
  const applied = await executePlan(request(again), { ...quick.h.deps, progress: (line) => none.push(line) })
  expect(applied.exitCode).toBe(0)
  expect(none).toEqual([])
})

test('a PATCH that timed out after HubSpot applied it settles on positive evidence: the approved values read back', async () => {
  const { sim, h } = await appliedPortal()
  const plan = await planOn(sim, loadProject([relabel]), owned())
  sim.fault({ method: 'PATCH', path: `${companies}/soil_ph`, action: fault.timeout({ apply: true }) })
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(sim.writes().length).toBe(1)
  expect(stateOf(h).resources[soilPh]?.base).toMatchObject({ label: 'Soil acidity' })
})

test('a rate limit is waited out three times, then the run stops with the step not run', async () => {
  const { sim, h } = await appliedPortal()
  const plan = await planOn(sim, loadProject([relabel]), owned())
  sim.fault({ method: 'PATCH', path: `${companies}/soil_ph`, action: fault.status(423, { message: 'Locked' }) })
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(1)
  expect(applied.data.steps[0]).toMatchObject({ outcome: 'not-run', issue: 'E_RATE_LIMIT' })
  expect(sim.writes().length).toBe(4)
  expect(h.slept).toEqual([2000, 2000, 2000])
  // Each attempt read the property again before it wrote.
  expect(sent(sim).filter((line) => line === `GET ${companies}/soil_ph`).length).toBe(4)
})

test("a dependent create's 400 is tried again after a new read, within the deadline; an independent one is not", async () => {
  const sim = simPortal()
  const h = await harness(sim)
  const plan = await planOn(sim, loadProject())
  sim.fault({
    method: 'POST',
    path: companies,
    occurrence: 1,
    action: fault.status(400, { message: 'group not found' }),
  })
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode, JSON.stringify(applied.issues)).toBe(0)
  expect(sim.writes().map((r) => r.status)).toEqual([201, 400, 201])
  expect(h.slept).toEqual([250])

  const { sim: other, h: oh } = await appliedPortal()
  other.object(portalId, 'companies').properties.delete('soil_ph')
  oh.deps.store.write(
    {
      ...owned(),
      serial: 5,
      resources: { 'group:companies/orchard': owned().resources['group:companies/orchard'] as never },
    },
    4,
  )
  const lone = await planOn(other, loadProject(), stateOf(oh))
  expect(lone.steps.map((s) => s.action)).toEqual(['create'])
  other.fault({ method: 'POST', path: companies, action: fault.status(400, { message: 'invalid' }) })
  const refused = await executePlan(request(lone), oh.deps)
  expect(refused.exitCode).toBe(1)
  expect(refused.data.steps[0]).toMatchObject({ outcome: 'rejected', issue: 'E_HTTP' })
  expect(other.writes().length).toBe(1)
})

test('a recreate keeps the owning entry origin and records a new base', async () => {
  const { sim, h } = await appliedPortal()
  const adopted = owned()
  ;(adopted.resources[soilPh] as { origin: string }).origin = 'adopted'
  h.deps.store.write({ ...adopted, serial: 5 }, 4)
  sim.object(portalId, 'companies').properties.delete('soil_ph')
  const plan = await planOn(sim, loadProject(), stateOf(h), [{ address: soilPh }])
  expect(plan.steps).toMatchObject([{ action: 'create', risk: 'risky', labels: ['reverts-ui-edit'] }])
  const applied = await executePlan(request(plan, 'terminal'), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(stateOf(h).resources[soilPh]).toMatchObject({ origin: 'adopted', id: 'soil_ph', base: { label: 'Soil pH' } })
})

test('a signal stops the run before its next request, saves state and releases the lock', async () => {
  const sim = simPortal()
  const controller = new AbortController()
  const wrapped: PortalSim = {
    ...sim,
    fetch: async (input, init) => {
      const answer = await sim.fetch(input, init)
      if (init?.method === 'POST') {
        controller.abort()
      }
      return answer
    },
  }
  const h = await harness(wrapped, { signal: controller.signal })
  const plan = await planOn(sim, loadProject())
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(5)
  expect(sent(sim, from).at(-1)).toBe(`POST ${groups}`)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['unverified', 'not-run'])
  expect(applied.issues.map((i) => i.code)).toContain('E_CANCELLED')
  expect(stateOf(h).lastApply?.outcome).toBe('partial')
  expect([...h.host.held]).toEqual([])
})

test('a refusal under the lock releases it and saves nothing: stale, changed state, and the budget', async () => {
  const { sim, h } = await appliedPortal()
  const plan = await planOn(sim, loadProject([relabel]), owned())
  Object.assign(sim.object(portalId, 'companies').properties.get('soil_ph') ?? {}, { label: 'Soil reading' })
  await expect(executePlan(request(plan), h.deps)).rejects.toMatchObject({ issues: [{ code: 'E_PLAN_STALE' }] })
  expect([...h.host.held]).toEqual([])
  expect(stateOf(h).serial).toBe(4)

  h.deps.store.write({ ...owned(), serial: 5 }, 4)
  await expect(executePlan(request(plan), h.deps)).rejects.toMatchObject({ issues: [{ code: 'E_STATE_CHANGED' }] })

  const { sim: tight, h: th } = await appliedPortal({ dailyRemaining: 12 })
  const costly = await planOn(tight, loadProject([relabel]), owned())
  await expect(executePlan(request(costly), th.deps)).rejects.toMatchObject({ issues: [{ code: 'E_BUDGET' }] })
  expect(tight.writes()).toEqual([])
  expect([...th.host.held]).toEqual([])
})

test('with no daily figure the run warns W_RATE_HEADERS', async () => {
  const { sim, h } = await appliedPortal({ dailyRemaining: null })
  const plan: Plan = await planOn(sim, loadProject([relabel]), owned())
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(applied.issues.map((i) => i.code)).toEqual(['W_RATE_HEADERS'])
})

/** A delete of an owned plot_notes property, as kalup plan writes one under allowDestroy. */
function plotNotesDelete(id: string): PlanStep {
  return {
    id,
    address: 'property:companies/plot_notes',
    action: 'delete',
    risk: 'destructive',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'x',
    expect: { exists: true },
  }
}

test('a delete runs only when every step before it verified: after a refused update it is not run', async () => {
  const plotNotes = { ...soilPhProperty, name: 'plot_notes', label: 'Plot notes' }
  const entry = { origin: 'created' as const, id: 'plot_notes', normVersion: 1 }
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty, plotNotes] })
  const h = await harness(sim)
  const state = owned({ 'property:companies/plot_notes': entry })
  h.deps.store.write(state, null)
  const update = await planOn(sim, loadProject([relabel]), state)
  const plan: Plan = {
    ...update,
    target: { ...update.target, allowDestroy: true },
    steps: [...update.steps, plotNotesDelete(`s${update.steps.length + 1}`)],
  }
  sim.fault({
    method: 'PATCH',
    path: `${companies}/soil_ph`,
    action: fault.status(403, { category: 'MISSING_SCOPES' }),
  })
  const applied = await executePlan(request(plan, 'terminal'), h.deps)
  expect(applied.exitCode).toBe(1)
  expect(applied.data.steps.map((s) => [s.action, s.outcome])).toEqual([
    ['update', 'rejected'],
    ['delete', 'not-run'],
  ])
  expect(sim.writes().map((r) => `${r.method} ${r.path}`)).toEqual([`PATCH ${companies}/soil_ph`])
  expect(stateOf(h).resources['property:companies/plot_notes']).toEqual(entry)
})

test('a journal line that cannot be written stops the run before its next request; state and the outcome are saved', async () => {
  const sim = simPortal()
  const failing = (journal: Journal): Journal => ({
    path: journal.path,
    append: (line) => {
      if (line.method === 'POST') {
        throw new Error('ENOSPC: no space left on device, write')
      }
      journal.append(line)
    },
  })
  const h = await harness(sim)
  const open = h.deps.openJournal
  h.deps.openJournal = (run) => failing(open(run))
  const plan = await planOn(sim, loadProject())
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(5)
  expect(sent(sim, from).at(-1)).toBe(`POST ${groups}`)
  expect(applied.data.steps.map((s) => s.outcome)).toEqual(['unverified', 'not-run'])
  expect(applied.issues.map((i) => i.code)).toContain('E_JOURNAL_WRITE')
  const state = stateOf(h)
  expect(state.resources['group:companies/orchard']).toEqual({
    origin: 'created',
    id: 'orchard',
    normVersion: 1,
    written: { label: expect.any(String) },
  })
  expect(state.lastApply?.outcome).toBe('partial')
  expect([...h.host.held]).toEqual([])
})

test('a read HubSpot answers 503 is tried again by the executor: every attempt journaled, the signal checked between', async () => {
  const { sim, h } = await appliedPortal()
  const plan = await planOn(sim, loadProject([relabel]), owned())
  sim.fault({ method: 'GET', path: groups, occurrence: 1, action: fault.status(503, { message: 'Unavailable' }) })
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode, JSON.stringify(applied.issues)).toBe(0)
  expect(h.slept.length).toBe(1)
  const lines = (h.host.journals.get(applied.data.journal as string) ?? []).filter((line) =>
    line.path.endsWith('/groups'),
  )
  expect(lines.map((line) => [line.status, line.outcome])).toEqual([
    [503, 'wait'],
    [200, 'ok'],
  ])

  // A signal while the read waits: no further attempt, and nothing is written.
  const { sim: other } = await appliedPortal()
  const controller = new AbortController()
  const oh = await harness(other, {
    signal: controller.signal,
    sleep: () => {
      controller.abort()
      return Promise.resolve()
    },
  })
  oh.deps.store.write(owned(), null)
  other.fault({ method: 'GET', path: groups, action: fault.status(503, { message: 'Unavailable' }) })
  const from = other.log.length
  await expect(executePlan(request(plan), oh.deps)).rejects.toMatchObject({ issues: [{ code: 'E_CANCELLED' }] })
  expect(sent(other, from).filter((line) => line === `GET ${groups}`)).toEqual([`GET ${groups}`])
  expect(other.writes()).toEqual([])
})
