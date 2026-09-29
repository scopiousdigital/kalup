// The state rebuild engine against the orchard portal the plan tests read: what it adopts and with which base, what it
// reports missing, stale or excluded and why, and what the current file loses. State fixtures use invented names and
// are built from core's types.

import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { type RebuildInput, rebuild, rebuiltState } from '../../src/engine/rebuild.js'
import { type Base, type ResourceState, type TargetState, validateState } from '../../src/ir/state.js'
import { files, planScenario, routes, type Scenario } from './plan-harness.js'

// A plan's warnings include the API pins' expiry, so every test runs on one day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-23T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const orchard = 'group:companies/orchard'
const legacy = 'group:companies/legacy'
const harvestDetails = 'group:harvest/harvest_details'
const harvestWindow = 'property:companies/harvest_window'
const irrigation = 'property:companies/irrigation_notes'
const plotTags = 'property:companies/plot_tags'
const plotTotal = 'property:companies/plot_total'
const rowMeta = 'property:companies/row_meta'
const yieldTier = 'property:companies/yield_tier'

/** The rebuild input for a scenario: its config, its read of the orchard portal, and `state`. */
async function input(state: TargetState | null, scenario: Scenario = {}): Promise<RebuildInput> {
  const run = await planScenario({ ...scenario, ...(state ? { state } : {}) })
  return { loaded: run.input.loaded, observation: run.input.observation, state, target: 'sandbox' }
}

function stateOf(resources: Record<string, ResourceState>): TargetState {
  return { format: 'kalup.state/1', lineage: '0a1b2c3d4e5f6071', serial: 9, portalId: 1_111_111, resources }
}

function entry(id: string, base?: Base, origin: ResourceState['origin'] = 'adopted'): ResourceState {
  return { origin, id, normVersion: 1, ...(base === undefined ? {} : { base }) }
}

test('with no state it adopts every managed config resource the portal holds, with a base of the units that agree', async () => {
  const result = rebuild(await input(null))
  expect(result.found.map((f) => [f.address, f.id, f.units, f.agreed])).toEqual([
    [orchard, 'orchard', 1, 0],
    [harvestDetails, 'harvest_details', 1, 1],
    ['object:harvest', 'harvest', 3, 3],
    [plotTags, 'plot_tags', 4, 4],
    [plotTotal, 'plot_total', 4, 4],
    [rowMeta, 'row_meta', 4, 4],
    [yieldTier, 'yield_tier', 11, 8],
    ['property:harvest/batch_code', 'batch_code', 4, 4],
    ['property:harvest/picked_on', 'picked_on', 4, 4],
  ])
  expect(result.missing).toEqual([legacy, harvestWindow])
  expect(result.stale).toEqual([])
  expect(result.excluded).toEqual([])
  expect(result).not.toHaveProperty('loses')
  // Nothing agreed on the group's label, so its entry has no base.
  expect(result.resources[orchard]).toEqual({ origin: 'adopted', id: 'orchard', normVersion: 1 })
  // A partial base: the label and the option config adds differ, so only the rest is recorded.
  expect(result.resources[yieldTier]).toEqual({
    origin: 'adopted',
    id: 'yield_tier',
    normVersion: 1,
    base: {
      fieldType: 'select',
      group: { $ref: orchard },
      options: { HIGH: { hidden: false, label: 'High' }, low: { hidden: false, label: 'Low' } },
      optionsOrder: ['low', 'HIGH'],
      type: 'enumeration',
    },
  })
  // A custom object schema is adopted as apply adopts it; a reference is no managed resource and is not listed.
  expect(result.resources['object:harvest']?.origin).toBe('adopted')
  const listed = [
    ...result.found.map((f) => f.address),
    ...result.missing,
    ...result.excluded.map((e) => e.address),
    ...Object.keys(result.resources),
  ]
  expect(listed).not.toContain('property:companies/name')
  expect(listed).not.toContain('property:companies/lifecyclestage')
})

const removedFile = [
  "import { defineRemoved } from '@kalup/core'",
  '',
  'export default defineRemoved({',
  `  '${irrigation}': { action: 'release' },`,
  '})',
  '',
].join('\n')

test('each excluded reason: a tombstone, a skip override, an unsupported type, a calculated property, an unread list', async () => {
  const scenario: Scenario = {
    files: { 'kalup/removed.ts': removedFile },
    edits: [
      [
        files.config,
        "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
        `credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: { '${plotTotal}': { skip: true } },`,
      ],
      // plot_shape is object_coordinates in the portal, which no builder carries; soil_ph is calculated there.
      [
        files.companies,
        '  properties: {\n',
        "  properties: {\n    plotShape: p.string('plot_shape', {\n      label: 'Plot shape',\n      group: 'orchard',\n      fieldType: 'text',\n    }),\n    soilPh: p.number('soil_ph', {\n      label: 'Soil pH',\n      group: 'orchard',\n      fieldType: 'number',\n    }),\n",
      ],
    ],
  }
  const result = rebuild(await input(null, scenario))
  expect(result.excluded).toEqual([
    { address: irrigation, reason: 'tombstone' },
    { address: 'property:companies/plot_shape', reason: 'unsupported' },
    { address: plotTotal, reason: 'skipped' },
    { address: 'property:companies/soil_ph', reason: 'hubspot-defined' },
  ])
  for (const e of result.excluded) {
    expect(Object.hasOwn(result.resources, e.address), e.address).toBe(false)
  }

  // A 403 on the companies properties list: nothing on companies was read, so nothing there is adopted or missing.
  const unread = rebuild(await input(null, { refused: [routes.companies] }))
  expect(unread.excluded).toEqual(
    [legacy, orchard, harvestWindow, plotTags, plotTotal, rowMeta, yieldTier].map((address) => ({
      address,
      reason: 'unread',
    })),
  )
  expect(unread.missing).toEqual([])
  expect(Object.keys(unread.resources).every((address) => address.includes(':harvest'))).toBe(true)
})

test('stale entries and what the current file loses: created origins, bases that change, entries not written', async () => {
  const fresh = rebuild(await input(null)).resources
  const state = stateOf({
    // Not in config, and tombstoned: stale, never adopted, dropped.
    [irrigation]: entry('irrigation_notes', { label: 'Irrigation notes' }, 'created'),
    // Records another portal name: stale, adopted again under its own, so its base changes.
    [plotTotal]: entry('plot_count', { label: 'Plot total' }),
    // The portal no longer holds it: stale and dropped.
    [harvestWindow]: entry('harvest_window', { label: 'Harvest window' }),
    // Created, with the base the rebuild writes: only the origin is lost.
    [plotTags]: entry('plot_tags', fresh[plotTags]?.base, 'created'),
    // Another base than the rebuild writes.
    [rowMeta]: entry('row_meta', { label: 'Row notes' }),
  })
  const result = rebuild(await input(state, { files: { 'kalup/removed.ts': removedFile } }))
  expect(result.stale).toEqual([
    { address: harvestWindow, id: 'harvest_window', reason: 'absent' },
    { address: irrigation, id: 'irrigation_notes', reason: 'not-in-config' },
    { address: plotTotal, id: 'plot_count', reason: 'renamed' },
  ])
  expect(result.loses).toEqual({
    created: [irrigation, plotTags],
    dropped: [harvestWindow, irrigation],
    bases: [plotTotal, rowMeta],
  })
  expect(result.excluded).toEqual([{ address: irrigation, reason: 'tombstone' }])
  expect(Object.hasOwn(result.resources, irrigation)).toBe(false)
  expect(result.resources[plotTotal]).toMatchObject({ origin: 'adopted', id: 'plot_total' })
  expect(result.resources[plotTags]).toEqual({ ...fresh[plotTags], origin: 'adopted' })
})

test('the new lineage: serial 1, the given entries, valid kalup.state/1', async () => {
  const { resources } = rebuild(await input(null))
  const state = rebuiltState(1_111_111, 'fedcba9876543210', resources)
  expect(state).toEqual({
    format: 'kalup.state/1',
    lineage: 'fedcba9876543210',
    serial: 1,
    portalId: 1_111_111,
    resources,
  })
  expect(validateState(state)).toEqual([])
})

test("the base records what the target's definition overrides and its portal agree on", async () => {
  // The portal calls the group 'Orchard details' and yield_tier 'Yield band'; config says 'Orchard' and 'Yield tier'.
  const override: Scenario['edits'] = [
    [
      files.config,
      "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
      "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: {\n        'group:companies/orchard': { definition: { label: 'Orchard details' } },\n        'property:companies/yield_tier': { definition: { label: 'Yield band' } },\n      },",
    ],
  ]
  const shared = rebuild(await input(null))
  const result = rebuild(await input(null, { edits: override }))
  expect(shared.resources[orchard]?.base).toBeUndefined()
  expect(result.resources[orchard]?.base).toEqual({ label: 'Orchard details' })
  expect(shared.resources[yieldTier]?.base).not.toHaveProperty('label')
  expect(result.resources[yieldTier]?.base).toHaveProperty('label', 'Yield band')
})
