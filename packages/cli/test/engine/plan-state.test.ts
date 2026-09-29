// The planner with state: ownership, the base, holds and both exits, --take config, tombstones, missing and
// orphaned entries. State fixtures are built from core's types with invented names; the portal is the orchard fixture
// the stateless plan tests read, edited per scenario.
import {
  advanceBase,
  type Base,
  type Plan,
  type PlanStep,
  type ResourceState,
  stableStringify,
  type TargetState,
  validatePlan,
} from '@kalup/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { hasEffect, writesHash } from '../../src/engine/digest.js'
import { planReads, planText } from '../../src/engine/plan.js'
import { capturedSpec, ownedFields, specOf } from '../../src/engine/units.js'
import { KalupError } from '../../src/lib/output.js'
import { fixture } from '../../src/lib/testing.js'
import { type Edit, files, planScenario, type Run, routes, type Scenario } from './plan-harness.js'

// An orphan note offers both ways out: the delete, then the release.
const bothRemovals = /kalup rm property:companies\/pruned .*kalup rm property:companies\/pruned --release/

// A plan's warnings include the API pins' expiry, so every test runs on one day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-23T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const LINEAGE = '0a1b2c3d4e5f6071'
const plotTotal = 'property:companies/plot_total'
const yieldTier = 'property:companies/yield_tier'
const harvestWindow = 'property:companies/harvest_window'
const irrigation = 'property:companies/irrigation_notes'
const pull = (address: string) => `kalup pull --target sandbox --only ${address}`

function stateOf(resources: Record<string, ResourceState>, serial = 7): TargetState {
  return { format: 'kalup.state/1', lineage: LINEAGE, serial, portalId: 1_111_111, resources }
}

function entry(id: string, base?: Base, origin: ResourceState['origin'] = 'adopted'): ResourceState {
  return { origin, id, normVersion: 1, ...(base === undefined ? {} : { base }) }
}

/** Plans the scenario and throws unless the plan holds what every plan must: plan/1, its own writesHash and planId. */
async function planned(scenario: Scenario): Promise<Run> {
  const run = await planScenario(scenario)
  const invalid = validatePlan(run.plan)
  if (invalid.length > 0) {
    throw new Error(`the plan does not match plan/1: ${JSON.stringify(invalid)}`)
  }
  const hash = writesHash(run.plan)
  if (run.plan.writesHash !== hash || run.plan.planId !== `pl_${hash.slice('sha256:'.length, 'sha256:'.length + 12)}`) {
    throw new Error('the plan does not carry its own writesHash and planId')
  }
  return run
}

function step(plan: Plan, address: string): PlanStep {
  const found = plan.steps.find((s) => s.address === address)
  if (!found) {
    throw new Error(`no step for ${address}`)
  }
  return found
}

function stepOf(plan: Plan, address: string): PlanStep | undefined {
  return plan.steps.find((s) => s.address === address)
}

/** The base apply records where config and this run's portal agree, as advanceBase computes it, for `units` if given. */
function agreed(run: Run, address: string, previous?: Base, units?: string[]): Base {
  const config = run.input.loaded.ir.resources[address]
  const observed = run.input.observation.resources[address]
  if (!(config && observed)) {
    throw new Error(`${address} is not in config and the portal`)
  }
  return advanceBase(previous, specOf(ownedFields(config)), capturedSpec(observed), units) ?? {}
}

/** State that owns every config resource the run adopts, each with the base config and the portal agree on. */
function settledState(run: Run): TargetState {
  const addresses = Object.keys(run.input.loaded.ir.resources).filter(
    (a) => stepOf(run.plan, a)?.action === 'adopt' && stepOf(run.plan, a)?.risk !== 'blocked',
  )
  return stateOf(
    Object.fromEntries(
      addresses.map((a) => [a, entry(a.slice(a.lastIndexOf('/') + 1).replace('object:', ''), agreed(run, a))]),
    ),
  )
}

/** The companies properties list with some properties changed or removed (null), and others added. */
function companies(patch: Record<string, object | null>, extra: object[] = []): Record<string, unknown> {
  const { results } = fixture('api/orchard/companies.properties.json') as { results: { name: string }[] }
  const kept = results.filter((p) => patch[p.name] !== null).map((p) => ({ ...p, ...(patch[p.name] ?? {}) }))
  return { [routes.companies]: { results: [...kept, ...extra] } }
}

function removedFile(entries: Record<string, 'destroy' | 'release'>): Record<string, string> {
  const lines = Object.entries(entries)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([address, action]) => `  '${address}': { action: '${action}' },`)
  return {
    'kalup/removed.ts': `import { defineRemoved } from 'kalup'\n\nexport default defineRemoved({\n${lines.join('\n')}\n})\n`,
  }
}

const allowDestroy: Edit = [files.config, 'portalId: 1111111,', 'portalId: 1111111,\n      allowDestroy: true,']
const overwrite: Edit = [files.config, 'portalId: 1111111,', "portalId: 1111111,\n      drift: 'overwrite',"]
const plotLabel = (label: string): Edit => [files.companies, "label: 'Plot total',", `label: '${label}',`]
const skipHarvestWindow: Edit = [
  files.config,
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: {\n        'property:companies/harvest_window': { skip: true },\n      },",
]

const plotBase = (label: string): Base => ({
  fieldType: 'number',
  group: { $ref: 'group:companies/orchard' },
  label,
  type: 'number',
})

// config label, the portal's, and the base's (undefined: the base holds no label).
function plotScenario(config: string, live: string, base: string | undefined, extra: Scenario = {}): Scenario {
  const { label: _, ...rest } = plotBase('')
  return {
    ...extra,
    edits: [...(config === 'Plot total' ? [] : [plotLabel(config)]), ...(extra.edits ?? [])],
    bodies: { ...companies({ plot_total: { label: live } }), ...extra.bodies },
    state: stateOf({ [plotTotal]: entry('plot_total', base === undefined ? rest : plotBase(base)) }),
  }
}

test('a config change is written as a set at risk safe; the step expects the live label, type and fieldType', async () => {
  const { plan } = await planned(plotScenario('Plot count', 'Plot total', 'Plot total'))
  expect(step(plan, plotTotal)).toEqual({
    id: expect.any(String),
    address: plotTotal,
    action: 'update',
    risk: 'safe',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'Update property "Plot count" (plot_total) on companies, set label',
    desired: { label: 'Plot count', group: { $ref: 'group:companies/orchard' }, type: 'number', fieldType: 'number' },
    changes: [{ unit: 'label', class: 'config-change', op: 'set', before: 'Plot total', after: 'Plot count' }],
    expect: { exists: true, values: { label: 'Plot total', type: 'number', fieldType: 'number' } },
  })
  expect(plan).toMatchObject({ stateLineage: LINEAGE, stateSerial: 7 })
})

const BLUEPRINT_HASH = `sha256:${'b'.repeat(64)}`

// A blueprint lock that lists these config addresses, as kalup add writes it: the loader merges its provenance into
// the IR. The loader does not read the stored original, so the test needs none.
function lockFile(addresses: string[]): Record<string, string> {
  const lock = {
    lockVersion: 1,
    blueprints: {
      'acme/orchard': {
        version: '1.2.0',
        source: 'blueprints/orchard-1.2.0.json',
        hash: BLUEPRINT_HASH,
        prefix: '',
        original: 'kalup/.blueprints/acme--orchard@1.2.0.json',
        resources: Object.fromEntries(addresses.map((address) => [address, address])),
        held: [],
      },
    },
    sources: { 'blueprints/orchard-1.2.0.json@1.2.0': BLUEPRINT_HASH },
  }
  return { 'kalup/blueprints.lock.json': `${JSON.stringify(lock, null, 2)}\n` }
}

test('a create, adopt or update carries its config resource provenance, which writesHash leaves out', async () => {
  const scenario = plotScenario('Plot count', 'Plot total', 'Plot total')
  const plain = await planned(scenario)
  const run = await planned({ ...scenario, files: lockFile([harvestWindow, yieldTier, plotTotal]) })
  const from = (sourceAddress: string) => ({
    blueprint: 'acme/orchard',
    version: '1.2.0',
    sourceAddress,
    prefix: '',
    hash: BLUEPRINT_HASH,
  })
  expect(step(run.plan, harvestWindow)).toMatchObject({ action: 'create', provenance: from(harvestWindow) })
  expect(step(run.plan, yieldTier)).toMatchObject({ action: 'adopt', provenance: from(yieldTier) })
  expect(step(run.plan, plotTotal)).toMatchObject({ action: 'update', provenance: from(plotTotal) })
  // A resource no blueprint provides carries none, and the plan is otherwise the same, down to its approval digest.
  expect(step(run.plan, 'group:companies/orchard').provenance).toBeUndefined()
  expect(run.plan.steps.map(({ provenance: _, ...rest }) => rest)).toEqual(plain.plan.steps)
  expect(run.plan.writesHash).toBe(plain.plan.writesHash)
})

test('drift is held with pull --only, a conflict with pull --accept, a unit with no base as diverged', async () => {
  const drift = step((await planned(plotScenario('Plot total', 'Plot sum', 'Plot total'))).plan, plotTotal)
  expect(drift).toMatchObject({
    action: 'update',
    risk: 'safe',
    title: 'No change to property "Plot total" (plot_total) on companies',
    held: [
      { unit: 'label', class: 'drift', config: 'Plot total', live: 'Plot sum', resolve: { portal: pull(plotTotal) } },
    ],
    expect: { exists: true },
  })
  expect(drift.changes).toBeUndefined()
  expect(drift.baseUnits).toBeUndefined()
  expect(hasEffect(drift)).toBe(false)
  const conflict = step((await planned(plotScenario('Plot count', 'Plot sum', 'Plot total'))).plan, plotTotal)
  expect(conflict.held).toEqual([
    {
      unit: 'label',
      class: 'conflict',
      config: 'Plot count',
      live: 'Plot sum',
      resolve: { portal: `kalup pull --target sandbox --accept '${plotTotal}#label'` },
    },
  ])
  const diverged = step((await planned(plotScenario('Plot total', 'Plot sum', undefined))).plan, plotTotal)
  expect(diverged.held).toEqual([
    { unit: 'label', class: 'diverged', config: 'Plot total', live: 'Plot sum', resolve: { portal: pull(plotTotal) } },
  ])
})

test('a converged unit with an out-of-date base is a base-only update; with a current base there is no step', async () => {
  const stale = await planned(plotScenario('Plot total', 'Plot total', 'Plot sum'))
  const recorded = step(stale.plan, plotTotal)
  expect(recorded).toMatchObject({
    action: 'update',
    risk: 'safe',
    title: 'Record the agreed values of property "Plot total" (plot_total) on companies',
    baseUnits: ['label'],
    expect: { exists: true },
  })
  expect(recorded.changes).toBeUndefined()
  expect(hasEffect(recorded)).toBe(true)
  expect(planText(stale.plan)).toContain('base is out of date')
  // No base at all for a unit: missing counts as out of date.
  const partial = await planned(plotScenario('Plot total', 'Plot total', undefined))
  expect(step(partial.plan, plotTotal).baseUnits).toEqual(['label'])
  const current = await planned(plotScenario('Plot total', 'Plot total', 'Plot total'))
  expect(stepOf(current.plan, plotTotal)).toBeUndefined()
  expect(planText(current.plan)).not.toContain('base is out of date')
})

test('a base another normalizer version wrote counts as absent: its differences are diverged', async () => {
  const s = plotScenario('Plot total', 'Plot sum', 'Plot total')
  const state = stateOf({ [plotTotal]: { ...entry('plot_total', plotBase('Plot total')), normVersion: 0 } })
  const { plan } = await planned({ ...s, state })
  expect(step(plan, plotTotal).held?.map((h) => h.class)).toEqual(['diverged'])
})

// yield_tier with its label settled, so only options differ. The portal holds peak (hidden), low and HIGH.
const settled = (patch: object = {}): Record<string, unknown> =>
  companies({ yield_tier: { label: 'Yield tier', ...patch } })

const yieldBase = (options: Record<string, object>, order = ['low', 'HIGH']): Base => ({
  fieldType: 'select',
  group: { $ref: 'group:companies/orchard' },
  label: 'Yield tier',
  options,
  optionsOrder: order,
  type: 'enumeration',
})

const low = { hidden: false, label: 'Low' }
const high = { hidden: false, label: 'High' }
const liveOptions = [
  { value: 'low', label: 'Low' },
  { value: 'HIGH', label: 'High' },
  { value: 'peak', label: 'Peak', hidden: true },
]

function yieldScenario(options: Record<string, object>, extra: Scenario = {}): Scenario {
  return {
    ...extra,
    bodies: { ...settled(), ...extra.bodies },
    state: stateOf({ [yieldTier]: entry('yield_tier', yieldBase(options)) }),
  }
}

test('options with a base: removed in HubSpot is drift, held; dropped from config is kept with a note', async () => {
  const { plan } = await planned(
    yieldScenario({ HIGH: high, low, peak: { hidden: true, label: 'Peak' }, trial: { hidden: false, label: 'Trial' } }),
  )
  expect(step(plan, yieldTier)).toMatchObject({
    action: 'update',
    title: 'No change to property "Yield tier" (yield_tier) on companies',
    held: [
      {
        unit: 'options[trial]',
        class: 'drift',
        config: { value: 'trial', label: 'Trial' },
        live: null,
        // pull keeps an option config and the base hold, so --accept takes the portal side and drops it.
        resolve: { portal: `kalup pull --target sandbox --accept '${yieldTier}#options[trial]'` },
      },
    ],
    notes: [
      {
        unit: 'options[peak]',
        live: { value: 'peak', label: 'Peak', hidden: true },
        note: expect.stringContaining('removedOptions'),
      },
    ],
  })
  expect(step(plan, yieldTier).changes).toBeUndefined()
})

test('options with a base: an option only config holds is added; removedOptions and exact remove at risk risky', async () => {
  const added = step((await planned(yieldScenario({ HIGH: high, low }))).plan, yieldTier)
  expect(added).toMatchObject({
    risk: 'safe',
    title: 'Update property "Yield tier" (yield_tier) on companies, add options "Trial"',
    changes: [
      { unit: 'options[trial]', class: 'add', op: 'add', before: null, after: { value: 'trial', label: 'Trial' } },
    ],
    notes: [{ unit: 'options[peak]', note: `kept; to add it to config, run ${pull(yieldTier)}` }],
    expect: { exists: true, values: { options: liveOptions, type: 'enumeration', fieldType: 'select' } },
  })
  const removal = {
    unit: 'options[peak]',
    class: 'remove',
    op: 'remove',
    before: { value: 'peak', label: 'Peak', hidden: true },
    after: null,
  }
  const lifecycles = ["removedOptions: ['peak']", "options: 'exact'"]
  const runs = await Promise.all(
    lifecycles.map((lifecycle) => {
      const edit: Edit = [
        files.companies,
        "lifecycle: { ignoreChanges: ['description'] },",
        `lifecycle: { ignoreChanges: ['description'], ${lifecycle} },`,
      ]
      return planned(yieldScenario({ HIGH: high, low }, { edits: [edit] }))
    }),
  )
  for (const [index, run] of runs.entries()) {
    const removed = step(run.plan, yieldTier)
    expect(removed.risk, lifecycles[index]).toBe('risky')
    expect(removed.changes, lifecycles[index]).toContainEqual(removal)
  }
})

test('options with a base: a member label config change is a set, and a config reorder sets the full order', async () => {
  const relabelled = step(
    (
      await planned(
        yieldScenario(
          { HIGH: high, low, trial: { hidden: false, label: 'Trial' } },
          { edits: [[files.companies, "{ value: 'low', label: 'Low' },", "{ value: 'low', label: 'Lowest' },"]] },
        ),
      )
    ).plan,
    yieldTier,
  )
  expect(relabelled.changes).toEqual([
    { unit: 'options[low].label', class: 'config-change', op: 'set', before: 'Low', after: 'Lowest' },
  ])
  // trial, which HubSpot lost, stays held.
  expect(relabelled.held?.map((h) => h.unit)).toEqual(['options[trial]'])
  expect(relabelled.expect).toEqual({
    exists: true,
    values: { options: liveOptions, type: 'enumeration', fieldType: 'select' },
  })
  // Config lists HIGH first; the base and the portal agree on low first.
  const reorder: Edit = [
    files.companies,
    "{ value: 'low', label: 'Low' },\n          { value: 'HIGH', label: 'High', as: 'high' },",
    "{ value: 'HIGH', label: 'High', as: 'high' },\n          { value: 'low', label: 'Low' },",
  ]
  const reordered = step((await planned(yieldScenario({ HIGH: high, low }, { edits: [reorder] }))).plan, yieldTier)
  expect(reordered.changes).toEqual([
    {
      unit: 'options.order',
      class: 'config-change',
      op: 'set',
      before: ['low', 'HIGH'],
      after: ['HIGH', 'low', 'trial'],
    },
    { unit: 'options[trial]', class: 'add', op: 'add', before: null, after: { value: 'trial', label: 'Trial' } },
  ])
})

// yield_tier with no portal-only option and its label settled: config and the portal agree on low and HIGH.
const middle: Edit = [
  files.companies,
  "{ value: 'HIGH', label: 'High', as: 'high' },\n          { value: 'trial', label: 'Trial' },",
  "{ value: 'mid', label: 'Mid' },\n          { value: 'HIGH', label: 'High', as: 'high' },",
]
const trailing: Edit = [files.companies, "{ value: 'trial', label: 'Trial' },", "{ value: 'mid', label: 'Mid' },"]
const twoOptions = [
  { label: 'Low', value: 'low', displayOrder: 0, hidden: false },
  { label: 'High', value: 'HIGH', displayOrder: 1, hidden: false },
]

test('a new option placed between two HubSpot holds is one write that renumbers, and the next plan is clean', async () => {
  const bodies = settled({ options: twoOptions })
  const state = stateOf({ [yieldTier]: entry('yield_tier', yieldBase({ HIGH: high, low })) })
  const first = await planned({ bodies, edits: [middle], state })
  const write = step(first.plan, yieldTier)
  // New options go after the highest live displayOrder unless the step sets the order: here it must.
  expect(write.changes).toEqual([
    { unit: 'options.order', class: 'add', op: 'set', before: ['low', 'HIGH'], after: ['low', 'mid', 'HIGH'] },
    { unit: 'options[mid]', class: 'add', op: 'add', before: null, after: { value: 'mid', label: 'Mid' } },
  ])
  expect(write.risk).toBe('safe')
  expect(first.plan.steps.filter((s) => s.address === yieldTier)).toHaveLength(1)
  // What the one PATCH leaves, and the base apply records from its read-back.
  const applied = settled({
    options: [
      { label: 'Low', value: 'low', displayOrder: 0, hidden: false },
      { label: 'Mid', value: 'mid', displayOrder: 1, hidden: false },
      { label: 'High', value: 'HIGH', displayOrder: 2, hidden: false },
    ],
  })
  const read = await planned({ bodies: applied, edits: [middle] })
  const base = agreed(read, yieldTier, yieldBase({ HIGH: high, low }))
  expect(base.optionsOrder).toEqual(['low', 'mid', 'HIGH'])
  const second = await planned({
    bodies: applied,
    edits: [middle],
    state: stateOf({ [yieldTier]: entry('yield_tier', base) }),
  })
  expect(stepOf(second.plan, yieldTier)).toBeUndefined()
  // Appended at the end, a new option needs no renumbering.
  const last = await planned({ bodies, edits: [trailing], state })
  expect(step(last.plan, yieldTier).changes?.map((c) => c.unit)).toEqual(['options[mid]'])
})

test('a new option after one HubSpot orders -1 sets the order too, since -1 shows after every other; the next plan is clean', async () => {
  // Numbered after the highest live displayOrder, 0, trial would show before HIGH.
  const unordered = [
    { label: 'Low', value: 'low', displayOrder: 0, hidden: false },
    { label: 'High', value: 'HIGH', displayOrder: -1, hidden: false },
  ]
  const previous = yieldBase({ HIGH: high, low })
  const first = await planned({
    bodies: settled({ options: unordered }),
    state: stateOf({ [yieldTier]: entry('yield_tier', previous) }),
  })
  expect(step(first.plan, yieldTier).changes).toEqual([
    { unit: 'options.order', class: 'add', op: 'set', before: ['low', 'HIGH'], after: ['low', 'HIGH', 'trial'] },
    { unit: 'options[trial]', class: 'add', op: 'add', before: null, after: { value: 'trial', label: 'Trial' } },
  ])
  // The write renumbers every option in config order.
  const applied = settled({
    options: [
      { label: 'Low', value: 'low', displayOrder: 0, hidden: false },
      { label: 'High', value: 'HIGH', displayOrder: 1, hidden: false },
      { label: 'Trial', value: 'trial', displayOrder: 2, hidden: false },
    ],
  })
  const base = agreed(await planned({ bodies: applied }), yieldTier, previous)
  const second = await planned({ bodies: applied, state: stateOf({ [yieldTier]: entry('yield_tier', base) }) })
  expect(stepOf(second.plan, yieldTier)).toBeUndefined()
  // The fixture's peak holds -1 too, but config does not keep it: appending trial leaves config order.
  const kept = await planned(yieldScenario({ HIGH: high, low }))
  expect(step(kept.plan, yieldTier).changes?.map((c) => c.unit)).toEqual(['options[trial]'])
})

test('an option config and HubSpot both dropped leaves the base in a base-only step, so adding it back is an add', async () => {
  const dropTrial: Edit = [files.companies, "\n          { value: 'trial', label: 'Trial' },", '']
  const bodies = settled({ options: twoOptions })
  const previous = yieldBase({ HIGH: high, low, trial: { hidden: false, label: 'Trial' } })
  const first = await planned({
    bodies,
    edits: [dropTrial],
    state: stateOf({ [yieldTier]: entry('yield_tier', previous) }),
  })
  const recorded = step(first.plan, yieldTier)
  expect(recorded).toMatchObject({ action: 'update', risk: 'safe', baseUnits: ['options[trial]'] })
  expect(recorded.changes).toBeUndefined()
  expect(hasEffect(recorded)).toBe(true)
  const base = agreed(first, yieldTier, previous, recorded.baseUnits)
  expect(base.options).toEqual({ HIGH: high, low })
  const state = stateOf({ [yieldTier]: entry('yield_tier', base) })
  expect(stepOf((await planned({ bodies, edits: [dropTrial], state })).plan, yieldTier)).toBeUndefined()
  // Config adds it back: an add, not drift removed in HubSpot.
  const readded = step((await planned({ bodies, state })).plan, yieldTier)
  expect(readded).toMatchObject({ risk: 'safe', changes: [{ unit: 'options[trial]', class: 'add', op: 'add' }] })
  expect(readded.held).toBeUndefined()
})

test('an order with no option in common is never recorded, so it is no base-only effect', async () => {
  const none: Edit = [
    files.companies,
    "options: [\n          { value: 'low', label: 'Low' },\n          { value: 'HIGH', label: 'High', as: 'high' },\n          { value: 'trial', label: 'Trial' },\n        ],",
    'options: [],',
  ]
  const adopted = await planned({ bodies: settled(), edits: [none] })
  expect(step(adopted.plan, yieldTier).baseUnits).not.toContain('options.order')
  const state = stateOf({ [yieldTier]: entry('yield_tier', agreed(adopted, yieldTier)) })
  const second = step((await planned({ bodies: settled(), edits: [none], state })).plan, yieldTier)
  // Only the notes on the options HubSpot keeps remain: nothing to approve.
  expect(second.notes?.map((n) => n.unit)).toEqual(['options[HIGH]', 'options[low]', 'options[peak]'])
  expect(second.baseUnits).toBeUndefined()
  expect(hasEffect(second)).toBe(false)
})

test("drift: 'overwrite' writes drift and conflicts labelled reverts-ui-edit at the change's own risk, never a missing resource", async () => {
  const drift = step(
    (await planned(plotScenario('Plot total', 'Plot sum', 'Plot total', { edits: [overwrite] }))).plan,
    plotTotal,
  )
  expect(drift).toMatchObject({
    risk: 'safe',
    labels: ['reverts-ui-edit'],
    changes: [{ unit: 'label', class: 'drift', op: 'set', before: 'Plot sum', after: 'Plot total' }],
  })
  expect(drift.held).toBeUndefined()
  const conflict = step(
    (await planned(plotScenario('Plot count', 'Plot sum', 'Plot total', { edits: [overwrite] }))).plan,
    plotTotal,
  )
  expect(conflict).toMatchObject({ risk: 'safe', labels: ['reverts-ui-edit'], changes: [{ class: 'conflict' }] })
  // No base: nothing to overwrite.
  const diverged = step(
    (await planned(plotScenario('Plot total', 'Plot sum', undefined, { edits: [overwrite] }))).plan,
    plotTotal,
  )
  expect(diverged.held?.map((h) => h.class)).toEqual(['diverged'])
  expect(diverged.labels).toBeUndefined()
  // An option HubSpot lost comes back as an add.
  const readded = step(
    (
      await planned(
        yieldScenario({ HIGH: high, low, trial: { hidden: false, label: 'Trial' } }, { edits: [overwrite] }),
      )
    ).plan,
    yieldTier,
  )
  expect(readded).toMatchObject({
    risk: 'safe',
    labels: ['reverts-ui-edit'],
    changes: [
      { unit: 'options[trial]', class: 'drift', op: 'add', before: null, after: { value: 'trial', label: 'Trial' } },
    ],
  })
  // A resource HubSpot no longer holds is never recreated by the policy.
  const gone = await planned({
    edits: [overwrite],
    state: stateOf({ [harvestWindow]: entry('harvest_window', {}, 'created') }),
  })
  expect(stepOf(gone.plan, harvestWindow)).toBeUndefined()
  expect(gone.plan.missing.map((m) => m.address)).toEqual([harvestWindow])
})

test('--take config: a held label becomes a risky set labelled reverts-ui-edit', async () => {
  const s = plotScenario('Plot total', 'Plot sum', 'Plot total', { take: [{ address: plotTotal, unit: 'label' }] })
  const { plan } = await planned(s)
  const taken = step(plan, plotTotal)
  expect(taken).toMatchObject({
    action: 'update',
    risk: 'risky',
    labels: ['reverts-ui-edit'],
    title: 'Update property "Plot total" (plot_total) on companies, set label',
    changes: [{ unit: 'label', class: 'drift', op: 'set', before: 'Plot sum', after: 'Plot total' }],
    expect: { exists: true, values: { label: 'Plot sum', type: 'number', fieldType: 'number' } },
  })
  expect(planText(plan)).toContain(
    `\n${taken.id} risky [reverts-ui-edit] Update property "Plot total" (plot_total) on companies, set label\n`,
  )
})

test('--take config: an address takes every held unit on it, a glob every address it matches', async () => {
  const lost = { HIGH: high, low, trial: { hidden: false, label: 'Trial' } }
  const drifted = yieldScenario(lost, {
    bodies: { ...settled(), ...companies({ yield_tier: { label: 'Yield band' } }) },
  })
  const whole = step((await planned({ ...drifted, take: [{ address: yieldTier }] })).plan, yieldTier)
  expect(whole.changes?.map((c) => [c.unit, c.class, c.op])).toEqual([
    ['label', 'drift', 'set'],
    ['options[trial]', 'drift', 'add'],
  ])
  expect(whole.held).toBeUndefined()
  expect(whole).toMatchObject({ risk: 'risky', labels: ['reverts-ui-edit'] })
  // One unit only: the option stays held.
  const one = step((await planned({ ...drifted, take: [{ address: yieldTier, unit: 'label' }] })).plan, yieldTier)
  expect(one.changes?.map((c) => c.unit)).toEqual(['label'])
  expect(one.held?.map((h) => h.unit)).toEqual(['options[trial]'])
  // A unit selects the units under it: options takes every option unit.
  const options = step((await planned({ ...drifted, take: [{ address: yieldTier, unit: 'options' }] })).plan, yieldTier)
  expect(options.changes?.map((c) => c.unit)).toEqual(['options[trial]'])
  // A glob: every property on companies whose label is held.
  const state = stateOf({
    [plotTotal]: entry('plot_total', plotBase('Plot total')),
    [yieldTier]: entry('yield_tier', yieldBase(lost)),
    [harvestWindow]: entry('harvest_window', {}, 'created'),
  })
  const glob = await planned({
    bodies: companies({ plot_total: { label: 'Plot sum' } }),
    state,
    take: [{ address: 'property:companies/*', unit: 'label' }],
  })
  expect(step(glob.plan, plotTotal).changes?.map((c) => c.unit)).toEqual(['label'])
  expect(step(glob.plan, yieldTier).changes?.map((c) => c.unit)).toEqual(['label'])
  expect(step(glob.plan, yieldTier).held?.map((h) => h.unit)).toEqual(['options[trial]'])
  // A unit takes units: the missing harvest_window the glob matches is not recreated.
  expect(stepOf(glob.plan, harvestWindow)).toBeUndefined()
  expect(glob.plan.missing.map((m) => m.address)).toEqual([harvestWindow])
})

test('--take config: a selector that matches no held unit or missing resource is E_TAKE_UNMATCHED, listing what is held', async () => {
  const thrown = async (scenario: Scenario) => {
    try {
      await planScenario(scenario)
    } catch (caught) {
      return caught as KalupError
    }
    throw new Error('the plan did not throw')
  }
  const error = await thrown(
    plotScenario('Plot total', 'Plot sum', 'Plot total', {
      take: [{ address: plotTotal, unit: 'description' }, { address: 'property:companies/row_meta' }],
    }),
  )
  expect(error).toBeInstanceOf(KalupError)
  expect(error.exitCode).toBe(1)
  expect(error.issues).toEqual([
    {
      code: 'E_TAKE_UNMATCHED',
      message: expect.stringContaining(`held there: ${plotTotal}#label`),
      fix: expect.stringContaining('kalup plan --target sandbox'),
    },
    {
      code: 'E_TAKE_UNMATCHED',
      message: expect.stringContaining('nothing is held there'),
      fix: expect.stringContaining('kalup plan --target sandbox'),
    },
  ])
  // A converged unit is nothing to take.
  const converged = await thrown(
    plotScenario('Plot total', 'Plot total', 'Plot total', { take: [{ address: plotTotal }] }),
  )
  expect(converged.issues.map((i) => i.code)).toEqual(['E_TAKE_UNMATCHED'])
  // Only the address alone recreates a missing resource.
  const gone = await thrown({
    state: stateOf({ [harvestWindow]: entry('harvest_window', {}, 'created') }),
    take: [{ address: harvestWindow, unit: 'label' }],
  })
  expect(gone.issues.map((i) => i.code)).toEqual(['E_TAKE_UNMATCHED'])
  expect(gone.issues[0]?.message).toContain(`missing in HubSpot: ${harvestWindow}`)
})

test('--take config recreates a missing property HubSpot does not hold archived: a risky create labelled reverts-ui-edit', async () => {
  const state = stateOf({ [harvestWindow]: entry('harvest_window', { label: 'Harvest window' }, 'created') })
  const { plan } = await planned({ state, take: [{ address: harvestWindow }] })
  expect(step(plan, harvestWindow)).toEqual({
    id: expect.any(String),
    address: harvestWindow,
    action: 'create',
    risk: 'risky',
    labels: ['reverts-ui-edit'],
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'Recreate property "Harvest window" (harvest_window) on companies',
    desired: { label: 'Harvest window', group: { $ref: 'group:companies/orchard' }, type: 'string', fieldType: 'text' },
    expect: { exists: false },
  })
  expect(plan.missing).toEqual([])
})

test('--take config is blocked for a property HubSpot holds archived and for a group', async () => {
  const archived = { [`${routes.companies}?archived=true`]: fixture('plans/api/companies.archived.json') }
  const property = await planned({
    bodies: archived,
    state: stateOf({ [harvestWindow]: entry('harvest_window', {}, 'created') }),
    take: [{ address: harvestWindow }],
  })
  expect(step(property.plan, harvestWindow)).toMatchObject({
    action: 'create',
    risk: 'blocked',
    title: expect.stringContaining('cannot recreate'),
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('archived property named harvest_window'),
      fix: expect.stringContaining('restore it in HubSpot'),
    },
  })
  const group = await planned({
    state: stateOf({ 'group:companies/legacy': entry('legacy', { label: 'Legacy' }, 'created') }),
    take: [{ address: 'group:companies/legacy' }],
  })
  expect(step(group.plan, 'group:companies/legacy')).toMatchObject({
    action: 'create',
    risk: 'blocked',
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('whether a group is archived'),
    },
  })
})

test('ownership: an entry naming another portal name owns nothing: the resource is adopted with a note', async () => {
  const state = stateOf({ [plotTotal]: entry('plot_sum', plotBase('Plot total')) })
  const { plan } = await planned({ state })
  expect(step(plan, plotTotal)).toMatchObject({
    action: 'adopt',
    baseUnits: ['fieldType', 'group', 'label', 'type'],
    notes: [
      {
        unit: 'name',
        live: 'plot_total',
        note: expect.stringContaining('state records plot_sum for this address, not plot_total'),
      },
    ],
  })
  // A reference entry owns nothing either, and says nothing.
  const reference = await planned({ state: stateOf({ [plotTotal]: entry('plot_total', undefined, 'reference') }) })
  expect(step(reference.plan, plotTotal)).toMatchObject({ action: 'adopt' })
  expect(step(reference.plan, plotTotal).notes).toBeUndefined()
})

test('ownership follows the name override: an entry owns a renamed address when it names the portal name', async () => {
  const legacy = 'group:companies/legacy'
  const renamed: Edit = [
    files.config,
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: {\n        'group:companies/legacy': { name: 'plots' },\n      },",
  ]
  // The portal names the group plots, labelled Plots; config labels it Legacy, the base Plots.
  const owned = await planned({ edits: [renamed], state: stateOf({ [legacy]: entry('plots', { label: 'Plots' }) }) })
  expect(step(owned.plan, legacy)).toMatchObject({
    action: 'update',
    changes: [{ unit: 'label', class: 'config-change', op: 'set', before: 'Plots', after: 'Legacy' }],
  })
  expect(owned.plan.bindings[legacy]).toEqual({ name: 'plots' })
  const stale = await planned({ edits: [renamed], state: stateOf({ [legacy]: entry('legacy', { label: 'Plots' }) }) })
  expect(step(stale.plan, legacy)).toMatchObject({
    action: 'adopt',
    held: [{ unit: 'label', class: 'diverged' }],
    notes: [{ unit: 'name', live: 'plots' }],
  })
})

const irrigationBase: Base = {
  fieldType: 'textarea',
  group: { $ref: 'group:companies/orchard' },
  label: 'Irrigation notes',
  type: 'string',
}

test('a destroy tombstone on an owned property that exists is a destructive delete, when the target allows destroys', async () => {
  const removed = removedFile({ [irrigation]: 'destroy' })
  const state = stateOf({ [irrigation]: entry('irrigation_notes', irrigationBase) })
  const { plan } = await planned({ files: removed, state, edits: [allowDestroy] })
  const last = plan.steps.at(-1) as PlanStep
  expect(last).toEqual({
    id: `s${plan.steps.length}`,
    address: irrigation,
    action: 'delete',
    risk: 'destructive',
    labels: ['existed-before-kalup'],
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'Archive property "Irrigation notes" (irrigation_notes) on companies',
    expect: {
      exists: true,
      values: {
        fieldType: 'textarea',
        group: { $ref: 'group:companies/orchard' },
        label: 'Irrigation notes',
        type: 'string',
      },
    },
  })
  expect(plan.counts.destructive).toBe(1)
  // A created one carries no label.
  const created = await planned({
    files: removed,
    state: stateOf({ [irrigation]: entry('irrigation_notes', irrigationBase, 'created') }),
    edits: [allowDestroy],
  })
  expect(step(created.plan, irrigation).labels).toBeUndefined()
})

test('a delete is blocked by policy without allowDestroy, and unsupported on a property HubSpot will not archive', async () => {
  const removed = removedFile({ [irrigation]: 'destroy' })
  const state = stateOf({ [irrigation]: entry('irrigation_notes', irrigationBase) })
  const policy = await planned({ files: removed, state })
  expect(step(policy.plan, irrigation)).toMatchObject({
    action: 'delete',
    risk: 'blocked',
    title: expect.stringContaining('deletes not allowed'),
    blocked: {
      reason: 'policy',
      detail: 'target sandbox does not allow deletes',
      fix: expect.stringContaining('allowDestroy: true under targets.sandbox'),
    },
  })
  const pinned = await planned({
    files: removed,
    state,
    edits: [allowDestroy],
    bodies: companies({
      irrigation_notes: {
        modificationMetadata: { archivable: false, readOnlyDefinition: false, readOnlyValue: false },
      },
    }),
  })
  expect(step(pinned.plan, irrigation).blocked).toMatchObject({
    reason: 'unsupported',
    detail: expect.stringContaining('not archivable'),
  })
})

test('a destroy tombstone on a present resource state does not own is blocked not-owned, a stale entry included', async () => {
  const removed = removedFile({ [irrigation]: 'destroy' })
  const none = await planned({ files: removed, edits: [allowDestroy] })
  expect(step(none.plan, irrigation)).toMatchObject({
    action: 'delete',
    risk: 'blocked',
    blocked: {
      reason: 'not-owned',
      detail: expect.stringContaining('no entry that owns it'),
      fix: expect.stringContaining('remove the tombstone from kalup/removed.ts'),
    },
  })
  // A group no entry owns stays blocked whatever its members are, so its archived lists are not read. harvest_window,
  // which companies would create, is left out.
  const group = await planned({
    files: removedFile({ 'group:companies/plots': 'destroy' }),
    edits: [allowDestroy, skipHarvestWindow],
  })
  expect(step(group.plan, 'group:companies/plots').blocked?.reason).toBe('not-owned')
  expect(group.requests.filter((r) => r.includes('archived=true'))).toEqual([])
  const stale = await planned({
    files: removed,
    edits: [allowDestroy],
    state: stateOf({ [irrigation]: entry('irrigation', irrigationBase) }),
  })
  expect(step(stale.plan, irrigation).blocked).toEqual({
    reason: 'not-owned',
    detail: expect.stringContaining('state records irrigation for this address, not irrigation_notes'),
    blocks: [],
    fix: expect.stringContaining(`kalup rm ${irrigation} --release`),
  })
})

test('releases: a release tombstone, and a destroy of what a complete read shows absent; no entry and absent is nothing', async () => {
  const removed = removedFile({
    [irrigation]: 'release',
    'property:companies/old_score': 'destroy',
    'property:companies/never_here': 'destroy',
    'group:companies/retired': 'release',
  })
  const state = stateOf({
    [irrigation]: entry('irrigation_notes', irrigationBase),
    'property:companies/old_score': entry('old_score', { label: 'Old score' }, 'created'),
  })
  const { plan } = await planned({ files: removed, state })
  const releases = plan.steps.filter((s) => s.action === 'release')
  expect(releases).toEqual([
    {
      id: expect.any(String),
      address: irrigation,
      action: 'release',
      risk: 'safe',
      transport: 'public-api',
      title: expect.stringContaining('it stays in HubSpot'),
      expect: {},
    },
    {
      id: expect.any(String),
      address: 'property:companies/old_score',
      action: 'release',
      risk: 'safe',
      transport: 'public-api',
      title: expect.stringContaining('HubSpot no longer has it'),
      // Apply releases what a destroy names only while HubSpot still does not hold it.
      expect: { exists: false },
    },
  ])
  expect(stepOf(plan, 'property:companies/never_here')).toBeUndefined()
  expect(stepOf(plan, 'group:companies/retired')).toBeUndefined()
  expect(releases.every(hasEffect)).toBe(true)
})

test('a tombstone on an object the key cannot read: an owned destroy is blocked on scope, an owned release still releases', async () => {
  const weight = 'property:harvest/weight_kg'
  const orchardRef = 'property:harvest/orchard_ref'
  const { plan } = await planned({
    refused: [routes.harvest],
    files: removedFile({ [weight]: 'destroy', [orchardRef]: 'release' }),
    edits: [allowDestroy],
    state: stateOf({ [weight]: entry('weight_kg', { label: 'Weight (kg)' }), [orchardRef]: entry('orchard_ref') }),
  })
  expect(step(plan, weight)).toMatchObject({ action: 'unknown', risk: 'blocked', blocked: { reason: 'scope' } })
  expect(step(plan, orchardRef)).toMatchObject({ action: 'release', risk: 'safe' })
})

// plots holds plot_count in the orchard portal. An archived property may name it too.
const plots = 'group:companies/plots'
const plotCount = 'property:companies/plot_count'
const archivedInPlots = {
  [`${routes.companies}?archived=true`]: {
    results: [
      {
        ...(fixture('plans/api/companies.archived.json').results as object[])[0],
        name: 'old_plot',
        groupName: 'plots',
      },
    ],
  },
}

test('a group delete is blocked while a property it does not delete names the group, active or archived', async () => {
  const removed = removedFile({ [plots]: 'destroy' })
  const state = stateOf({ [plots]: entry('plots', { label: 'Plots' }) })
  const active = await planned({ files: removed, state, edits: [allowDestroy] })
  expect(step(active.plan, plots)).toMatchObject({
    action: 'delete',
    risk: 'blocked',
    title: expect.stringContaining('group still holds properties'),
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('still name this group: plot_count'),
      fix: expect.stringContaining('move them to another group'),
    },
  })
  // The group delete reads the archived lists of its object.
  expect(active.requests).toContain(`${routes.companies}?archived=true`)
  const archived = await planned({
    files: removed,
    state,
    edits: [allowDestroy],
    bodies: { ...companies({ plot_count: null }), ...archivedInPlots },
  })
  expect(step(archived.plan, plots).blocked?.detail).toContain('archived: old_plot')
})

test('deletes come last, properties before groups, after the releases; a group delete may follow its last property', async () => {
  const removed = removedFile({ [plots]: 'destroy', [plotCount]: 'destroy', [irrigation]: 'release' })
  const state = stateOf({
    [plots]: entry('plots', { label: 'Plots' }, 'created'),
    [plotCount]: entry('plot_count', { label: 'Plot count' }, 'created'),
    [irrigation]: entry('irrigation_notes'),
  })
  const { plan } = await planned({ files: removed, state, edits: [allowDestroy] })
  expect(plan.steps.slice(-3).map((s) => [s.address, s.action, s.risk])).toEqual([
    [irrigation, 'release', 'safe'],
    [plotCount, 'delete', 'destructive'],
    [plots, 'delete', 'destructive'],
  ])
  expect(step(plan, plots).expect).toEqual({ exists: true, values: { label: 'Plots' } })
  // An archived property in the group still blocks it.
  const held = await planned({ files: removed, state, edits: [allowDestroy], bodies: archivedInPlots })
  expect(step(held.plan, plots).blocked?.detail).toContain('archived: old_plot')
  expect(step(held.plan, plotCount).risk).toBe('destructive')
  // Without allowDestroy the policy blocks both: the group names the policy, not the member the plan deletes.
  const denied = await planned({ files: removed, state })
  expect(step(denied.plan, plotCount).blocked?.reason).toBe('policy')
  expect(step(denied.plan, plots).blocked).toMatchObject({
    reason: 'policy',
    detail: 'target sandbox does not allow deletes',
  })
})

test('missing: an owned resource a complete read did not find is no step, with its archived status and the exits', async () => {
  const state = stateOf({
    [harvestWindow]: entry('harvest_window', {}, 'created'),
    'group:companies/legacy': entry('legacy', { label: 'Legacy' }),
  })
  const { plan } = await planned({ state })
  expect(stepOf(plan, harvestWindow)).toBeUndefined()
  expect(stepOf(plan, 'group:companies/legacy')).toBeUndefined()
  expect(plan.missing).toEqual([
    {
      address: 'group:companies/legacy',
      origin: 'adopted',
      archived: null,
      resolve: ['kalup rm group:companies/legacy --release'],
    },
    {
      address: harvestWindow,
      origin: 'created',
      archived: false,
      resolve: [`kalup rm ${harvestWindow} --release`, `kalup plan --target sandbox --take config ${harvestWindow}`],
    },
  ])
  const archived = await planned({
    state,
    bodies: { [`${routes.companies}?archived=true`]: fixture('plans/api/companies.archived.json') },
  })
  expect(archived.plan.missing[1]).toEqual({
    address: harvestWindow,
    origin: 'created',
    archived: true,
    archivedAt: '2026-08-01T09:00:00.000Z',
    resolve: [expect.stringContaining('kalup plan --target sandbox'), `kalup rm ${harvestWindow} --release`],
  })
  const text = planText(archived.plan)
  expect(text.slice(text.indexOf('\nMissing in HubSpot'))).toMatchInlineSnapshot(`
    "
    Missing in HubSpot, owned in state:
      group:companies/legacy (adopted): kalup rm group:companies/legacy --release
      property:companies/harvest_window (created, archived 2026-08-01T09:00:00.000Z): restore it in HubSpot, then run kalup plan --target sandbox; or kalup rm property:companies/harvest_window --release
    9 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 2 held
    Coverage: complete; 1 unsupported, 0 excluded.
    About 16 API calls; the daily remainder is unknown.
    Not copied, HubSpot has no API: record page layouts, saved views.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    "
  `)
})

test('a property whose config group is missing in HubSpot is blocked on it', async () => {
  const moved: Edit = [
    files.companies,
    "label: 'Harvest window',\n      group: 'orchard',",
    "label: 'Harvest window',\n      group: 'legacy',",
  ]
  const { plan } = await planned({ edits: [moved], state: stateOf({ 'group:companies/legacy': entry('legacy') }) })
  expect(step(plan, harvestWindow)).toMatchObject({
    action: 'create',
    risk: 'blocked',
    blocked: { reason: 'dependency-blocked', detail: 'group:companies/legacy is missing in HubSpot' },
  })
})

test('planReads: the archived lists of an object with a missing property or a group delete, even without a create', async () => {
  const harvest = await planned({
    bodies: {
      [routes.harvest]: {
        results: (fixture('api/orchard/harvest.properties.json').results as { name: string }[]).filter(
          (p) => p.name !== 'picked_on',
        ),
      },
    },
    state: stateOf({ 'property:harvest/picked_on': entry('picked_on', {}, 'created') }),
  })
  expect(planReads(harvest.input).archived).toEqual({ companies: 'companies', harvest: '2-4242001' })
  expect(harvest.plan.missing.map((m) => [m.address, m.archived])).toEqual([['property:harvest/picked_on', false]])
})

test('orphans: a created or adopted entry config no longer names and no tombstone removes, with both rm commands', async () => {
  const state = stateOf({
    'property:companies/pruned': entry('pruned'),
    'property:companies/renamed_away': entry('something_else'),
    'property:companies/looked_up': entry('looked_up', undefined, 'reference'),
    'object:press_run': entry('press_run'),
  })
  const { plan } = await planned({ state })
  expect(plan.orphans).toEqual([
    {
      address: 'object:press_run',
      note: expect.stringContaining('custom objects are not removed or released'),
    },
    {
      address: 'property:companies/pruned',
      note: expect.stringMatching(bothRemovals),
    },
    // An entry naming another portal name owns nothing a delete could reach: only the release is offered.
    {
      address: 'property:companies/renamed_away',
      note: expect.stringContaining('kalup rm property:companies/renamed_away --release'),
    },
  ])
  const text = planText(plan)
  expect(text.slice(text.indexOf('\nOwned in state'))).toMatchInlineSnapshot(`
    "
    Owned in state, not in config:
      object:press_run: no longer in config; custom objects are not removed or released in this release
      property:companies/pruned: no longer in config: run kalup rm property:companies/pruned to delete it in HubSpot, or kalup rm property:companies/pruned --release to stop managing it
      property:companies/renamed_away: no longer in config, and state records something_else for it, not renamed_away: run kalup rm property:companies/renamed_away --release to drop the entry; something_else stays in HubSpot as it is
    11 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 2 held
    Coverage: complete; 1 unsupported, 0 excluded.
    About 22 API calls; the daily remainder is unknown.
    Not copied, HubSpot has no API: record page layouts, saved views.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    "
  `)
})

test('an entry left under an address it does not name: listed as an orphan, dropped by a release, never deleted', async () => {
  // moisture_log was managed as irrigation_notes through a name override; config, the override and the property under
  // that address are gone, and state still records irrigation_notes.
  const moisture = 'property:companies/moisture_log'
  const state = stateOf({ [moisture]: entry('irrigation_notes', irrigationBase, 'created') })
  const listed = await planned({ state })
  expect(listed.plan.orphans.map((o) => o.address)).toEqual([moisture])
  expect(stepOf(listed.plan, moisture)).toBeUndefined()
  const released = await planned({ state, files: removedFile({ [moisture]: 'release' }) })
  expect(step(released.plan, moisture)).toEqual({
    id: expect.any(String),
    address: moisture,
    action: 'release',
    risk: 'safe',
    transport: 'public-api',
    title: expect.stringContaining('which records irrigation_notes'),
    expect: {},
  })
  expect(released.plan.orphans).toEqual([])
  const destroyed = await planned({ state, files: removedFile({ [moisture]: 'destroy' }), edits: [allowDestroy] })
  expect(step(destroyed.plan, moisture)).toMatchObject({
    action: 'delete',
    risk: 'blocked',
    blocked: {
      reason: 'not-owned',
      detail: expect.stringContaining('state records irrigation_notes for this address, not moisture_log'),
    },
  })
})

test('rewrites: a unit HubSpot stores differently from what was sent is a note, neither written nor held, overwrite or not', async () => {
  const state = stateOf({
    [plotTotal]: {
      ...entry('plot_total', plotBase('Plot total')),
      rewrites: { label: { sent: 'Plot total', stored: 'Plot Total' } },
    },
  })
  const bodies = companies({ plot_total: { label: 'Plot Total' } })
  const runs = await Promise.all([[], [overwrite]].map((edits) => planned({ bodies, edits, state })))
  for (const { plan } of runs) {
    expect(step(plan, plotTotal)).toMatchObject({
      action: 'update',
      notes: [
        {
          unit: 'label',
          live: 'Plot Total',
          note: 'HubSpot stores "Plot Total" when sent "Plot total"; change config to match',
        },
      ],
    })
    expect(step(plan, plotTotal).changes).toBeUndefined()
    expect(step(plan, plotTotal).held).toBeUndefined()
  }
  // A config change of the unit is planned as usual.
  const changed = await planned({ bodies, state, edits: [plotLabel('Plot count')] })
  expect(step(changed.plan, plotTotal).held?.map((h) => h.class)).toEqual(['conflict'])
})

test('a custom object state owns: a difference is held or noted, never written, and --take config on it is blocked', async () => {
  const bare = await planned({})
  const state = stateOf({ 'object:harvest': entry('harvest', agreed(bare, 'object:harvest')) })
  const relabel: Edit = [
    files.harvest,
    "labels: { singular: 'Harvest', plural: 'Harvests' },",
    "labels: { singular: 'Harvest lot', plural: 'Harvest lots' },",
  ]
  const noted = await planned({ state, edits: [relabel] })
  expect(step(noted.plan, 'object:harvest')).toMatchObject({
    action: 'update',
    title: 'No change to custom object "Harvest lot" (harvest)',
    notes: [
      {
        unit: 'labels',
        live: { singular: 'Harvest', plural: 'Harvests' },
        note: expect.stringContaining('schema writes are not supported'),
      },
    ],
  })
  expect(hasEffect(step(noted.plan, 'object:harvest'))).toBe(false)
  const schemas = fixture('api/orchard/schemas.json') as { results: object[] }
  const drifted = {
    [routes.schemas]: {
      results: schemas.results.map((s, i) => (i === 0 ? { ...s, primaryDisplayProperty: 'orchard_ref' } : s)),
    },
  }
  const held = await planned({ state, bodies: drifted, edits: [overwrite] })
  // Even under overwrite a schema is held, with a note saying why it is not written.
  expect(step(held.plan, 'object:harvest').held).toMatchObject([
    { unit: 'primaryDisplayProperty', class: 'drift', config: 'batch_code', live: 'orchard_ref' },
  ])
  expect(step(held.plan, 'object:harvest').notes).toEqual([
    {
      unit: 'primaryDisplayProperty',
      live: 'orchard_ref',
      note: expect.stringContaining('schema writes are not supported'),
    },
  ])
  // Held drift would not be written anyway, so it needs no note.
  const kept = await planned({ state, bodies: drifted })
  expect(step(kept.plan, 'object:harvest').notes).toBeUndefined()
  const taken = await planned({ state, bodies: drifted, take: [{ address: 'object:harvest' }] })
  expect(step(taken.plan, 'object:harvest')).toMatchObject({
    action: 'update',
    risk: 'blocked',
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('--take config cannot write its units'),
    },
  })
  // No take-config exit is offered for a custom object's held unit.
  const heldLine = planText(held.plan)
    .split('\n')
    .find((line) => line.startsWith('  held primaryDisplayProperty'))
  expect(heldLine).toContain(pull('object:harvest'))
  expect(heldLine).not.toContain('--take config')
})

test('writesHash binds baseUnits and labels, not titles, held values or notes', async () => {
  const { plan } = await planned(plotScenario('Plot total', 'Plot sum', 'Plot sum', { edits: [overwrite] }))
  const at = plan.steps.findIndex((s) => s.address === plotTotal)
  const edited = (change: (s: PlanStep) => void) => {
    const copy = structuredClone(plan)
    change(copy.steps[at] as PlanStep)
    return writesHash(copy)
  }
  expect(
    edited((s) => {
      s.baseUnits = ['group']
    }),
  ).not.toBe(plan.writesHash)
  expect(
    edited((s) => {
      s.labels = []
    }),
  ).not.toBe(plan.writesHash)
  expect(
    edited((s) => {
      s.title = 'Something else'
    }),
  ).toBe(plan.writesHash)
  expect(
    edited((s) => {
      s.notes = [{ unit: 'label', live: 'x', note: 'y' }]
    }),
  ).toBe(plan.writesHash)
  const held = await planned(plotScenario('Plot total', 'Plot sum', 'Plot total'))
  const moved = await planned(plotScenario('Plot total', 'Plot summed', 'Plot total'))
  // Only a held unit moved: nothing an approval binds changed.
  expect(stableStringify(step(held.plan, plotTotal).held)).not.toBe(stableStringify(step(moved.plan, plotTotal).held))
  expect(moved.plan.writesHash).toBe(held.plan.writesHash)
  // The state serial is bound.
  const later = await planned({
    ...plotScenario('Plot total', 'Plot sum', 'Plot total'),
    state: stateOf({ [plotTotal]: entry('plot_total', plotBase('Plot total')) }, 8),
  })
  expect(later.plan.writesHash).not.toBe(held.plan.writesHash)
})

test('a held-only step binds nothing: its custom object adds no binding and writesHash stays', async () => {
  const state = settledState(await planned({}))
  const calm = await planned({ state })
  const { results } = fixture('api/orchard/harvest.properties.json') as { results: { name: string }[] }
  const relabelled = results.map((p) => (p.name === 'picked_on' ? { ...p, label: 'Picked date' } : p))
  const drifted = await planned({ state, bodies: { [routes.harvest]: { results: relabelled } } })
  const held = step(drifted.plan, 'property:harvest/picked_on')
  expect(held).toMatchObject({ action: 'update', held: [{ unit: 'label', class: 'drift' }] })
  expect(hasEffect(held)).toBe(false)
  expect(drifted.plan.bindings).toEqual(calm.plan.bindings)
  expect(drifted.plan.writesHash).toBe(calm.plan.writesHash)
})

test('budget: three calls per write, four lists per object with an effect, archived lists, schemas and account-info', async () => {
  // Every config resource agrees with the portal and its base, and nothing is created: no effect, no calls.
  const state = settledState(await planned({}))
  // Leave out the two creates and yield_tier, whose trial option config adds.
  const skip: Edit = [
    files.config,
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: {\n        'property:companies/harvest_window': { skip: true },\n        'group:companies/legacy': { skip: true },\n        'property:companies/yield_tier': { skip: true },\n      },",
  ]
  const quiet = await planned({ state, edits: [skip] })
  expect(quiet.plan.steps.filter(hasEffect)).toEqual([])
  expect(quiet.plan.budget.estimatedCalls).toBe(0)
  // One label write on companies: 3, four companies lists, account-info. No create, delete or missing entry.
  const one = await planned({ state, edits: [skip, plotLabel('Plot count')] })
  expect(one.plan.steps.filter(hasEffect).map((s) => s.address)).toEqual([plotTotal])
  expect(one.plan.budget.estimatedCalls).toBe(3 + 4 + 1)
})
