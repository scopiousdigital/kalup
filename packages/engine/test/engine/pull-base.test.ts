// baseUnits: the units pull merges against the base, classified exactly as plan classifies them. The orchard portal
// holds yield_tier as 'Yield band' with options low, HIGH and a hidden peak; config says 'Yield tier' with low, HIGH
// and trial. State fixtures use invented names and are built from core's types.

import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { baseUnits, recordPulled } from '../../src/engine/pull-base.js'
import type { Base, ResourceState, TargetState } from '../../src/ir/state.js'
import type { UnitResult } from '../../src/plan/classify.js'
import type { Plan } from '../../src/plan/types.js'
import { type Edit, files, planScenario, type Scenario } from './plan-harness.js'

// A plan's warnings include the API pins' expiry, so every test runs on one day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-23T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const yieldTier = 'property:companies/yield_tier'
const plotTotal = 'property:companies/plot_total'
const plotTags = 'property:companies/plot_tags'
const rowMeta = 'property:companies/row_meta'
const pickedOn = 'property:harvest/picked_on'

function stateOf(resources: Record<string, ResourceState>): TargetState {
  return { format: 'kalup.state/1', lineage: '0a1b2c3d4e5f6071', serial: 3, portalId: 1_111_111, resources }
}

function entry(id: string, base?: Base, rest: Partial<ResourceState> = {}): ResourceState {
  return { origin: 'created', id, normVersion: 1, ...(base === undefined ? {} : { base }), ...rest }
}

/** baseUnits for the scenario, and the plan made from the same read and state. */
async function classified(state: TargetState, scenario: Scenario = {}) {
  const run = await planScenario({ ...scenario, state })
  const { loaded, observation } = run.input
  return { plan: run.plan, bases: baseUnits({ loaded, observation, state, target: 'sandbox' }) }
}

function unit(units: UnitResult[] | undefined, name: string): UnitResult | undefined {
  return units?.find((u) => u.unit === name)
}

/** The class plan gives a unit of a step: held, written or recorded (converged). */
function planned(plan: Plan, address: string, name: string): string | undefined {
  const step = plan.steps.find((s) => s.address === address)
  const held = step?.held?.find((h) => h.unit === name)
  const change = step?.changes?.find((c) => c.unit === name)
  return held?.class ?? change?.class ?? (step?.baseUnits?.includes(name) ? 'converged' : undefined)
}

test.each([
  ['Yield tier', 'drift'],
  ['Yield band', 'config-change'],
  ['Yield grade', 'conflict'],
] as const)(
  'a base label %s makes the label %s, and converged units agree: each unit classified against the base as plan does',
  async (label, expected) => {
    const state = stateOf({
      [yieldTier]: entry('yield_tier', { label }),
      [plotTotal]: entry('plot_total', { label: 'Plot count' }),
    })
    const { plan, bases } = await classified(state)
    expect(unit(bases.get(yieldTier), 'label'), label).toEqual({
      unit: 'label',
      class: expected,
      desired: 'Yield tier',
      observed: 'Yield band',
      base: label,
    })
    expect(planned(plan, yieldTier, 'label'), label).toBe(expected)
    // Config and the portal agree; the base is out of date, so plan records it.
    expect(unit(bases.get(plotTotal), 'label')?.class).toBe('converged')
    expect(planned(plan, plotTotal, 'label')).toBe('converged')
  },
)

test('options: removed in HubSpot is drift, dropped from config with a base is keep, added in config is add', async () => {
  const members = { options: { peak: { label: 'Peak' }, trial: { label: 'Trial' } } }
  const withBase = await classified(stateOf({ [yieldTier]: entry('yield_tier', { label: 'Yield tier', ...members }) }))
  const units = withBase.bases.get(yieldTier)
  expect(unit(units, 'options[trial]')).toMatchObject({ class: 'drift', base: { label: 'Trial' } })
  expect(unit(units, 'options[trial]')).not.toHaveProperty('observed')
  expect(unit(units, 'options[peak]')).toMatchObject({ class: 'keep', base: { label: 'Peak' } })
  expect(planned(withBase.plan, yieldTier, 'options[trial]')).toBe('drift')

  const without = await classified(stateOf({ [yieldTier]: entry('yield_tier', { label: 'Yield tier' }) }))
  const fresh = without.bases.get(yieldTier)
  expect(unit(fresh, 'options[trial]')).toMatchObject({ class: 'add' })
  expect(unit(fresh, 'options[peak]')).toMatchObject({ class: 'keep' })
  expect(unit(fresh, 'options[peak]')).not.toHaveProperty('base')
  expect(planned(without.plan, yieldTier, 'options[trial]')).toBe('add')
})

// soil_ph is calculated in the portal, so its live resource is unmanaged whatever config says.
const soilPh: Edit = [
  files.companies,
  '  properties: {\n',
  "  properties: {\n    soilPh: p.number('soil_ph', {\n      label: 'Soil pH',\n      group: 'orchard',\n      fieldType: 'number',\n    }),\n",
]

test('entries it leaves to the plain merge: another normalizer, another name, no base, not owned, not managed', async () => {
  const good = { label: 'Picked on' }
  const state = stateOf({
    [pickedOn]: entry('picked_on', good),
    [yieldTier]: entry('yield_tier', { label: 'Yield tier' }, { normVersion: 2 }),
    [plotTotal]: entry('plot_count', { label: 'Plot total' }),
    [plotTags]: entry('plot_tags'),
    [rowMeta]: entry('row_meta', { label: 'Row meta' }, { origin: 'reference' }),
    'property:companies/name': entry('name', { label: 'Name' }),
    'property:companies/soil_ph': entry('soil_ph', { label: 'Soil pH' }),
    'property:companies/irrigation_notes': entry('irrigation_notes', { label: 'Irrigation notes' }),
  })
  const { bases } = await classified(state, { edits: [soilPh] })
  expect([...bases.keys()]).toEqual([pickedOn])
  expect(bases.get(pickedOn)?.every((u) => u.class === 'converged')).toBe(true)
})

test("a field the target overrides compares the override's value with this portal's base, as plan does", async () => {
  const override: Edit = [
    files.config,
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: { 'property:companies/yield_tier': { definition: { label: 'Yield grade' } } },",
  ]
  const state = stateOf({ [yieldTier]: entry('yield_tier', { label: 'Yield grade' }) })
  const { plan, bases } = await classified(state, { edits: [override] })
  expect(unit(bases.get(yieldTier), 'label')).toEqual({
    unit: 'label',
    class: 'drift',
    desired: 'Yield grade',
    observed: 'Yield band',
    base: 'Yield grade',
  })
  expect(planned(plan, yieldTier, 'label')).toBe('drift')
})

/** recordPulled over the scenario's read, with --only matching `only` (every address by default). */
async function recording(state: TargetState | null, only: (address: string) => boolean = () => true) {
  const run = await planScenario(state ? { state } : {})
  const { loaded, observation } = run.input
  return recordPulled({ loaded, observation, state, target: 'sandbox', only })
}

test('with no state, each resource the portal holds gets a pulled entry with the units config and the portal agree on', async () => {
  const recorded = await recording(null)
  expect(recorded[plotTotal]).toEqual({
    origin: 'pulled',
    id: 'plot_total',
    normVersion: 1,
    base: expect.objectContaining({ label: 'Plot total' }),
  })
  // The labels differ, so the base leaves the label out; the options config and the portal share are in it.
  expect(recorded[yieldTier]?.base).not.toHaveProperty('label')
  expect(recorded[yieldTier]?.base).toHaveProperty('options.low')
  // A custom object the portal lacks, and a HubSpot-defined reference, get nothing.
  expect(Object.keys(recorded).filter((a) => a.includes('crate') || a === 'property:companies/name')).toEqual([])
})

test('an owning entry keeps its origin and rewrites and advances only agreed units; others are left as they are', async () => {
  const rewrites = { label: { sent: 'Plot  count', stored: 'Plot count' } }
  const state = stateOf({
    [plotTotal]: entry('plot_total', { label: 'Plot count' }, { rewrites }),
    [yieldTier]: entry('yield_tier', { label: 'Yield grade' }),
    [plotTags]: entry('plot_count', { label: 'Plot tags old' }),
    [rowMeta]: entry('row_meta', { label: 'Row meta old' }, { origin: 'reference' }),
    'property:companies/irrigation_notes': entry('irrigation_notes', { label: 'Irrigation' }, { origin: 'pulled' }),
  })
  const recorded = await recording(state)
  expect(recorded[plotTotal]).toMatchObject({ origin: 'created', rewrites, base: { label: 'Plot total' } })
  // The label is not agreed, so its base stays where the last apply left it.
  expect(recorded[yieldTier]).toMatchObject({ origin: 'created', base: { label: 'Yield grade' } })
  // An entry that names another portal name, and a reference one, are not pull's to touch.
  expect(recorded[plotTags]).toEqual(state.resources[plotTags])
  expect(recorded[rowMeta]).toEqual(state.resources[rowMeta])
  // A pulled entry config no longer manages is dropped.
  expect(recorded).not.toHaveProperty('property:companies/irrigation_notes')
})

test('--only limits what a pull records, and a pulled base feeds the next merge as an owning one does', async () => {
  const recorded = await recording(null, (address) => address === plotTotal)
  expect(Object.keys(recorded)).toEqual([plotTotal])
  const state = stateOf({ [yieldTier]: entry('yield_tier', { label: 'Yield band' }, { origin: 'pulled' }) })
  const { plan, bases } = await classified(state)
  expect(unit(bases.get(yieldTier), 'label')?.class).toBe('config-change')
  const step = plan.steps.find((s) => s.address === yieldTier)
  expect(step?.action).toBe('adopt')
  expect(step?.changes).toContainEqual(expect.objectContaining({ unit: 'label', class: 'config-change' }))
  expect(step?.held).toBeUndefined()
})
