import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { writesHash } from '../../src/engine/digest.js'
import { plan as buildPlan, planPending, planReads, planText } from '../../src/engine/plan.js'
import { stableStringify } from '../../src/ir/serialize.js'
import { KalupError } from '../../src/lib/errors.js'
import { NORM_VERSIONS, registry } from '../../src/lib/registry.js'
import type { Plan, PlanStep } from '../../src/plan/types.js'
import { validatePlan } from '../../src/plan/validate.js'
import { normalise } from '../support/normalise.js'
import { fixture } from '../support/testing.js'
import { type Edit, files, golden, loadScenario, planScenario, routes, type Scenario } from './plan-harness.js'

// A plan's warnings include the API pins' expiry, so every test runs on one day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-23T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function step(plan: Plan, address: string): PlanStep {
  const found = plan.steps.find((s) => s.address === address)
  if (!found) {
    throw new Error(`no step for ${address}`)
  }
  return found
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code)
}

// Control characters and the line and paragraph separators.
const CONTROL = /\p{Cc}|\p{Zl}|\p{Zp}/u

const pull = (address: string) => `kalup pull --target sandbox --only ${address}`

const overrides = (entries: string): Edit => [
  files.config,
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
  `credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: {\n${entries}\n      },`,
]

const exact: Scenario = {
  edits: [
    [
      files.companies,
      "lifecycle: { ignoreChanges: ['description'] },",
      "lifecycle: { ignoreChanges: ['description'], options: 'exact' },",
    ],
  ],
}

const crate: Scenario = {
  files: {
    'hubspot/objects/crate.ts': `import { defineCustomObject, p } from '@kalup/core'

export const Crate = defineCustomObject('crate', {
  labels: { singular: 'Crate', plural: 'Crates' },
  primaryDisplayProperty: 'crate_code',
  groups: {
    crate_details: { label: 'Crate details' },
  },
  properties: {
    crateCode: p.string('crate_code', {
      label: 'Crate code',
      group: 'crate_details',
      fieldType: 'text',
    }),
  },
})
`,
  },
  edits: [[files.config, 'harvest: {},', 'harvest: {},\n    crate: {},']],
}

const limit: Scenario = {
  ...crate,
  bodies: { [routes.objectLimit]: fixture('api/orchard/limits.custom-object-types.zero.json') },
}

const scope: Scenario = { refused: [routes.harvest] }

const override: Scenario = {
  edits: [
    overrides(
      "        'group:companies/legacy': { name: 'plots' },\n        'property:companies/plot_tags': { name: 'plot_labels' },",
    ),
  ],
}

const archived: Scenario = {
  bodies: { [`${routes.companies}?archived=true`]: fixture('plans/api/companies.archived.json') },
  edits: [
    [
      files.companies,
      "orchard: { label: 'Orchard' },",
      "old_ledger: { label: 'Old ledger' },\n    orchard: { label: 'Orchard' },",
    ],
    [
      files.companies,
      "    name: p.string('name'),",
      "    ledgerCode: p.string('ledger_code', {\n      label: 'Ledger code',\n      group: 'old_ledger',\n      fieldType: 'text',\n    }),\n    name: p.string('name'),",
    ],
  ],
}

const unsupported: Scenario = {
  edits: [
    [
      files.companies,
      "    name: p.string('name'),",
      [
        "    name: p.string('name'),",
        "    plotShape: p.string('plot_shape', { label: 'Plot shape', group: 'orchard', fieldType: 'text' }),",
        "    soilPh: p.number('soil_ph', { label: 'Soil pH', group: 'orchard', fieldType: 'number' }),",
      ].join('\n'),
    ],
    [
      files.companies,
      "plotTags: p.stringArray('plot_tags', {\n      label: 'Plot tags',\n      group: 'orchard',\n      fieldType: 'text',",
      "plotTags: p.number('plot_tags', {\n      label: 'Plot tags',\n      group: 'orchard',\n      fieldType: 'number',",
    ],
    [
      files.harvest,
      "group: 'harvest_details',\n      fieldType: 'text',",
      "group: 'harvest_details',\n      fieldType: 'text',\n      hasUniqueValue: false,",
    ],
  ],
}

// orchard: a new group and property, an added option, a kept portal-only option, held labels. exact: a portal-only
// option removed, risky. limit: a custom object the portal lacks, blocked since schema writes are not supported, with
// its group and property, so the custom-object-types limit is not read. scope: an unreadable
// object. override: a portal name that is missing, and one that resolves. archived: an archived property name, blocked,
// and an archived group name, created. unsupported: a HubSpot-defined property config manages, a portal type no
// builder carries, a diverged type and hasUniqueValue. Regenerate them only on purpose; biome formats fixture JSON, so they compare through stableStringify.
const goldens: [string, Scenario][] = [
  ['orchard', {}],
  ['exact', exact],
  ['limit', limit],
  ['scope', scope],
  ['override', override],
  ['archived', archived],
  ['unsupported', unsupported],
]

test.each(goldens)(
  'the %s plan equals its golden, conforms to plan/1 and comes out byte-identical twice',
  async (name, s) => {
    const first = await planScenario(s)
    const second = await planScenario(s)
    expect(stableStringify(first.plan)).toBe(stableStringify(second.plan))
    expect(stableStringify(first.plan)).toBe(stableStringify(golden(name)))
    expect(validatePlan(first.plan)).toEqual([])
    expect(first.plan.writesHash).toBe(writesHash(first.plan))
    expect(first.plan.planId).toBe(`pl_${first.plan.writesHash.slice('sha256:'.length, 'sha256:'.length + 12)}`)
  },
)

test('steps run objects, groups, properties, each by address in code-unit order, numbered in that order', async () => {
  const { plan } = await planScenario(limit)
  expect(plan.steps.map((s) => [s.id, s.address])).toEqual([
    ['s1', 'object:crate'],
    ['s2', 'object:harvest'],
    ['s3', 'group:companies/legacy'],
    ['s4', 'group:companies/orchard'],
    ['s5', 'group:crate/crate_details'],
    ['s6', 'group:harvest/harvest_details'],
    ['s7', 'property:companies/harvest_window'],
    ['s8', 'property:companies/plot_tags'],
    ['s9', 'property:companies/plot_total'],
    ['s10', 'property:companies/row_meta'],
    ['s11', 'property:companies/yield_tier'],
    ['s12', 'property:crate/crate_code'],
    ['s13', 'property:harvest/batch_code'],
    ['s14', 'property:harvest/picked_on'],
  ])
})

test('a new property and a new group are creates with the full config definition', async () => {
  const { plan } = await planScenario()
  expect(step(plan, 'property:companies/harvest_window')).toEqual({
    id: 's5',
    address: 'property:companies/harvest_window',
    action: 'create',
    risk: 'safe',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'Create property "Harvest window" (harvest_window) on companies',
    desired: {
      label: 'Harvest window',
      group: { $ref: 'group:companies/orchard' },
      type: 'string',
      fieldType: 'text',
    },
    expect: { exists: false },
  })
  expect(step(plan, 'group:companies/legacy')).toMatchObject({
    action: 'create',
    title: 'Create property group "Legacy" (legacy) on companies',
    desired: { label: 'Legacy' },
    expect: { exists: false },
  })
})

test('a create lists every field it sends but type, and marks the ones HubSpot keeps as created', async () => {
  const { plan } = await planScenario({
    edits: [
      [
        files.companies,
        "    name: p.string('name'),",
        [
          "    partnerCode: p.string('partner_code', {",
          "      label: 'Partner code',",
          "      group: 'orchard',",
          "      fieldType: 'text',",
          '      hasUniqueValue: true,',
          "      dataSensitivity: 'sensitive',",
          '      hidden: true,',
          "      textDisplayHint: 'unformatted_single_line',",
          '    }),',
          "    grower: p.owner('grower', { label: 'Grower', group: 'orchard', fieldType: 'select' }),",
          "    name: p.string('name'),",
        ].join('\n'),
      ],
    ],
  })
  const lines = (name: string) => {
    const all = planText(plan).split('\n')
    const at = all.findIndex((line) => line.includes(`(${name})`))
    return all.slice(at, at + 2)
  }
  expect(lines('partner_code')).toMatchInlineSnapshot(`
    [
      "s7 safe Create property "Partner code" (partner_code) on companies",
      "  label "Partner code", group orchard, fieldType "text", dataSensitivity "sensitive" (create only), hasUniqueValue true (create only), hidden true, textDisplayHint "unformatted_single_line"",
    ]
  `)
  expect(lines('grower')).toMatchInlineSnapshot(`
    [
      "s5 safe Create property "Grower" (grower) on companies",
      "  label "Grower", group orchard, fieldType "select", externalOptions true, referencedObjectType "OWNER"",
    ]
  `)
})

test('an adopt: a config-only option is added, a portal-only one kept with a note, a differing label held', async () => {
  const { plan } = await planScenario()
  const address = 'property:companies/yield_tier'
  expect(step(plan, address)).toEqual({
    id: 's9',
    address,
    action: 'adopt',
    risk: 'safe',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'Adopt property "Yield tier" (yield_tier) on companies, add option "Trial"',
    // ignoreChanges names description, which the resource exists to release, so desired leaves it out.
    desired: {
      label: 'Yield tier',
      group: { $ref: 'group:companies/orchard' },
      type: 'enumeration',
      fieldType: 'select',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'HIGH', label: 'High' },
        { value: 'trial', label: 'Trial' },
      ],
    },
    changes: [
      { unit: 'options[trial]', class: 'add', op: 'add', before: null, after: { value: 'trial', label: 'Trial' } },
    ],
    held: [
      {
        unit: 'label',
        class: 'diverged',
        config: 'Yield tier',
        live: 'Yield band',
        resolve: { portal: pull(address) },
      },
    ],
    notes: [
      {
        unit: 'options[peak]',
        live: { value: 'peak', label: 'Peak', hidden: true },
        note: expect.stringContaining(pull(address)),
      },
    ],
    // Every unit config and the portal already agree on: apply records them in the base as it adopts.
    baseUnits: [
      'fieldType',
      'group',
      'options.order',
      'options[HIGH].hidden',
      'options[HIGH].label',
      'options[low].hidden',
      'options[low].label',
      'type',
    ],
    // HubSpot replaces the whole options list, and the PATCH carries the live type and fieldType.
    expect: {
      exists: true,
      values: {
        options: [
          { value: 'low', label: 'Low' },
          { value: 'HIGH', label: 'High' },
          { value: 'peak', label: 'Peak', hidden: true },
        ],
        type: 'enumeration',
        fieldType: 'select',
      },
    },
  })
  expect(step(plan, 'group:companies/orchard')).toMatchObject({
    action: 'adopt',
    risk: 'safe',
    held: [
      {
        unit: 'label',
        class: 'diverged',
        config: 'Orchard',
        live: 'Orchard details',
        resolve: { portal: pull('group:companies/orchard') },
      },
    ],
  })
  // Converged adopts carry desired and nothing else to write.
  expect(step(plan, 'object:harvest')).toEqual({
    id: 's1',
    address: 'object:harvest',
    action: 'adopt',
    risk: 'safe',
    transport: 'public-api',
    api: { family: 'crm-object-schemas', version: '2026-09' },
    title: 'Adopt custom object "Harvest" (harvest)',
    desired: {
      labels: { singular: 'Harvest', plural: 'Harvests' },
      primaryDisplayProperty: 'batch_code',
      requiredProperties: ['batch_code'],
    },
    baseUnits: ['labels', 'primaryDisplayProperty', 'requiredProperties'],
    expect: { exists: true },
  })
  expect(plan.counts).toEqual({ safe: 11, risky: 0, destructive: 0, blocked: 0, manual: 0, held: 2 })
})

test('exact options: a portal-only option is removed at risk risky, and expect holds the full live options', async () => {
  const { plan } = await planScenario(exact)
  const yieldTier = step(plan, 'property:companies/yield_tier')
  expect(yieldTier).toMatchObject({
    risk: 'risky',
    title: 'Adopt property "Yield tier" (yield_tier) on companies, add option "Trial", remove option "Peak"',
    changes: [
      {
        unit: 'options[peak]',
        class: 'remove',
        op: 'remove',
        before: { value: 'peak', label: 'Peak', hidden: true },
        after: null,
      },
      { unit: 'options[trial]', class: 'add', op: 'add', before: null, after: { value: 'trial', label: 'Trial' } },
    ],
    expect: {
      exists: true,
      values: {
        options: [
          { value: 'low', label: 'Low' },
          { value: 'HIGH', label: 'High' },
          { value: 'peak', label: 'Peak', hidden: true },
        ],
      },
    },
  })
  expect(yieldTier.notes).toBeUndefined()
  expect(plan.counts).toMatchObject({ safe: 10, risky: 1 })
})

test('a custom object the portal lacks is blocked unsupported, never created, and blocks its group and properties', async () => {
  const { plan, issues, requests } = await planScenario(limit)
  expect(step(plan, 'object:crate')).toEqual({
    id: 's1',
    address: 'object:crate',
    action: 'create',
    risk: 'blocked',
    transport: 'public-api',
    api: { family: 'crm-object-schemas', version: '2026-09' },
    title: expect.stringContaining('schema writes not supported'),
    expect: { exists: false },
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('the portal has no custom object crate'),
      blocks: ['group:crate/crate_details', 'property:crate/crate_code'],
      fix: expect.stringContaining("{ 'object:crate': { skip: true } }"),
    },
  })
  expect(step(plan, 'group:crate/crate_details')).toMatchObject({
    action: 'create',
    risk: 'blocked',
    title: expect.stringContaining('object:crate is blocked'),
    blocked: {
      reason: 'dependency-blocked',
      detail: 'object:crate is blocked',
      blocks: ['property:crate/crate_code'],
    },
  })
  expect(step(plan, 'property:crate/crate_code')).toMatchObject({
    action: 'create',
    risk: 'blocked',
    blocked: { reason: 'dependency-blocked', detail: 'group:crate/crate_details is blocked', blocks: [] },
  })
  // No custom object create can run, so the custom-object-types limit is not read.
  expect(requests).not.toContain(routes.objectLimit)
  expect(plan.preflight.limits.map((l) => l.key)).toEqual(['custom-properties'])
  expect(plan.counts).toMatchObject({ blocked: 3 })
  expect(codes(issues)).not.toContain('W_LIMIT_HEADROOM')
})

// A second property create on companies, next to harvest_window.
const plotRows: Edit = [
  files.companies,
  "    name: p.string('name'),",
  "    name: p.string('name'),\n    plotRows: p.number('plot_rows', { label: 'Plot rows', group: 'orchard', fieldType: 'number' }),",
]

test('headroom smaller than the creates warns, and every create stays in the plan', async () => {
  const { plan, issues } = await planScenario({
    edits: [plotRows],
    bodies: {
      [routes.propertyLimit]: { overallLimit: 413, overallUsage: 412, overallPercentage: 99.8, byObjectType: [] },
    },
  })
  expect(step(plan, 'property:companies/harvest_window').action).toBe('create')
  expect(step(plan, 'property:companies/plot_rows')).toMatchObject({ action: 'create', risk: 'safe' })
  expect(issues.find((i) => i.code === 'W_LIMIT_HEADROOM')).toMatchInlineSnapshot(`
    {
      "code": "W_LIMIT_HEADROOM",
      "fix": "leave some of them out on this target with skip overrides under targets.sandbox.overrides",
      "message": "the plan creates 2 custom properties and HubSpot reports room for 1 more (limit 413, 412 in use)",
    }
  `)
})

// HubSpot answered 403 to a key with crm.schemas scopes only (observed 2026-09-29), and a 200 without figures is as
// unreadable: either way the plan says it could not check its property creates, and blocks none of them.
test.each([
  ['a 403', { refused: [routes.propertyLimit] }, '403'],
  [
    'a 200 without figures',
    { bodies: { [routes.propertyLimit]: { overallPercentage: 0, byObjectType: [] } } },
    'E_HTTP',
  ],
])('an unreadable property limit (%s) with property creates warns W_LIMIT_UNREADABLE', async (_, answer, said) => {
  const { plan, issues } = await planScenario({ ...answer, edits: [plotRows] })
  for (const address of ['property:companies/harvest_window', 'property:companies/plot_rows']) {
    expect(step(plan, address), address).toMatchObject({ action: 'create', risk: 'safe' })
  }
  expect(issues.filter((i) => i.code === 'W_LIMIT_UNREADABLE')).toEqual([
    {
      code: 'W_LIMIT_UNREADABLE',
      message: expect.stringContaining(`answered ${said}`),
      fix: expect.stringContaining('crm.objects.companies.read'),
    },
  ])
  expect(plan.preflight.limits).toContainEqual(
    expect.objectContaining({ key: 'custom-properties', status: 'unreadable' }),
  )
})

test.each([
  ['a 403', { refused: [routes.propertyLimit] }],
  ['a 200 without figures', { bodies: { [routes.propertyLimit]: { overallPercentage: 0, byObjectType: [] } } }],
])('an unreadable property limit (%s) warns of nothing when no property create is planned', async (_, answer) => {
  const { plan, issues, requests } = await planScenario({
    ...answer,
    edits: [overrides("        'property:companies/harvest_window': { skip: true },")],
  })
  expect(plan.steps.filter((s) => s.action === 'create' && s.address.startsWith('property:'))).toEqual([])
  expect(codes(issues)).not.toContain('W_LIMIT_UNREADABLE')
  expect(requests).not.toContain(routes.propertyLimit)
})

// Limits Tracking lists standard objects in byObjectType too: companies is 0-2, deals 0-3.
const companiesAt = (usage: number) => ({
  overallLimit: 5000,
  overallUsage: 1000,
  byObjectType: [{ objectTypeId: '0-2', limit: 1000, usage }],
})

// A property create on harvest.
const grade: Edit = [
  files.harvest,
  '  properties: {\n',
  "  properties: {\n    grade: p.string('grade', { label: 'Grade', group: 'harvest_details', fieldType: 'text' }),\n",
]

// deals read, with no groups or properties in the portal: a group create and a property create.
const deals: Scenario = {
  bodies: { [routes.deals]: { results: [] }, [routes.dealGroups]: { results: [] } },
  files: {
    'hubspot/objects/deals.ts': `import { defineObject, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    terms: { label: 'Terms' },
  },
  properties: {
    termDays: p.number('term_days', { label: 'Term days', group: 'terms', fieldType: 'number' }),
  },
})
`,
  },
  edits: [[files.config, 'harvest: {},', 'harvest: {},\n    deals: {},']],
}

test('a standard object at its own custom property limit blocks its property creates with reason limit', async () => {
  const { plan, issues } = await planScenario({ bodies: { [routes.propertyLimit]: companiesAt(1000) } })
  const address = 'property:companies/harvest_window'
  expect(step(plan, address)).toMatchObject({
    action: 'create',
    risk: 'blocked',
    title: expect.stringContaining('limit reached'),
    expect: { exists: false },
    blocked: {
      reason: 'limit',
      detail: expect.stringContaining('on companies, with 1000 in use'),
      blocks: [],
      fix: `leave it out on this target: add { '${address}': { skip: true } } under targets.sandbox.overrides`,
    },
  })
  // A group is no custom property: the new group on companies is still a create.
  expect(step(plan, 'group:companies/legacy')).toMatchObject({ action: 'create', risk: 'safe' })
  expect(plan.preflight.limits).toContainEqual({
    key: 'custom-properties',
    status: 'read',
    limit: 5000,
    usage: 1000,
    byObjectType: [{ objectTypeId: '0-2', limit: 1000, usage: 1000 }],
  })
  expect(codes(issues)).not.toContain('W_LIMIT_HEADROOM')
})

test('a standard object with less room than its creates warns W_LIMIT_HEADROOM naming it, and blocks nothing', async () => {
  const { plan, issues } = await planScenario({
    bodies: { [routes.propertyLimit]: companiesAt(999) },
    edits: [plotRows],
  })
  for (const address of ['property:companies/harvest_window', 'property:companies/plot_rows']) {
    expect(step(plan, address), address).toMatchObject({ action: 'create', risk: 'safe' })
  }
  expect(issues.filter((i) => i.code === 'W_LIMIT_HEADROOM')).toMatchInlineSnapshot(`
    [
      {
        "code": "W_LIMIT_HEADROOM",
        "fix": "leave some of them out on this target with skip overrides under targets.sandbox.overrides",
        "message": "the plan creates 2 custom properties on companies and HubSpot reports room for 1 more (limit 1000, 999 in use)",
      },
    ]
  `)
})

test('each object meets its own entry: companies at its limit blocks only its creates, deals with room keeps its', async () => {
  const byObjectType = [
    { objectTypeId: '0-2', limit: 1000, usage: 1000 },
    { objectTypeId: '0-3', limit: 1000, usage: 10 },
  ]
  const { plan, issues } = await planScenario({
    ...deals,
    bodies: { ...deals.bodies, [routes.propertyLimit]: { overallLimit: 5000, overallUsage: 1000, byObjectType } },
  })
  expect(step(plan, 'property:companies/harvest_window').blocked).toMatchObject({
    reason: 'limit',
    detail: expect.stringContaining('on companies, with 1000 in use'),
  })
  expect(step(plan, 'group:deals/terms')).toMatchObject({ action: 'create', risk: 'safe' })
  expect(step(plan, 'property:deals/term_days')).toMatchObject({ action: 'create', risk: 'safe' })
  expect(plan.preflight.limits).toContainEqual({
    key: 'custom-properties',
    status: 'read',
    limit: 5000,
    usage: 1000,
    byObjectType,
  })
  expect(codes(issues)).not.toContain('W_LIMIT_HEADROOM')
})

test('an overall limit with no room blocks every property create, whatever the per-object entries say', async () => {
  const { plan } = await planScenario({
    ...deals,
    bodies: {
      ...deals.bodies,
      [routes.propertyLimit]: {
        overallLimit: 1000,
        overallUsage: 1000,
        byObjectType: [
          { objectTypeId: '0-2', limit: 1000, usage: 10 },
          { objectTypeId: '0-3', limit: 1000, usage: 10 },
          { objectTypeId: '2-4242001', limit: 500, usage: 10 },
        ],
      },
    },
    edits: [...(deals.edits ?? []), grade],
  })
  const creates = plan.steps.filter((s) => s.address.startsWith('property:') && s.action === 'create')
  expect(creates.map((s) => [s.address, s.blocked?.reason, s.blocked?.detail])).toEqual(
    ['property:companies/harvest_window', 'property:deals/term_days', 'property:harvest/grade'].map((address) => [
      address,
      'limit',
      expect.stringContaining('with 1000 in use'),
    ]),
  )
})

test('an unreadable custom-properties reading blocks nothing, even beside a full entry for the object', async () => {
  const refused = await planScenario({ refused: [routes.propertyLimit] })
  const figureless = await planScenario({
    bodies: { [routes.propertyLimit]: { byObjectType: [{ objectTypeId: '0-2', limit: 1000, usage: 1000 }] } },
  })
  expect(refused.plan.preflight.limits).toContainEqual({
    key: 'custom-properties',
    status: 'unreadable',
    issue: 'E_SCOPE',
  })
  expect(figureless.plan.preflight.limits).toContainEqual({
    key: 'custom-properties',
    status: 'unreadable',
    issue: 'E_HTTP',
  })
  for (const { plan, issues } of [refused, figureless]) {
    expect(step(plan, 'property:companies/harvest_window')).toMatchObject({ action: 'create', risk: 'safe' })
    expect(codes(issues)).not.toContain('W_LIMIT_HEADROOM')
  }
})

test('a standard object with no entry in byObjectType meets the overall figure only', async () => {
  const { plan, issues } = await planScenario({
    bodies: {
      [routes.propertyLimit]: {
        overallLimit: 1000,
        overallUsage: 999,
        byObjectType: [{ objectTypeId: '2-4242001', limit: 500, usage: 500 }],
      },
    },
    edits: [plotRows],
  })
  for (const address of ['property:companies/harvest_window', 'property:companies/plot_rows']) {
    expect(step(plan, address), address).toMatchObject({ action: 'create', risk: 'safe' })
  }
  expect(issues.filter((i) => i.code === 'W_LIMIT_HEADROOM')).toMatchInlineSnapshot(`
    [
      {
        "code": "W_LIMIT_HEADROOM",
        "fix": "leave some of them out on this target with skip overrides under targets.sandbox.overrides",
        "message": "the plan creates 2 custom properties and HubSpot reports room for 1 more (limit 1000, 999 in use)",
      },
    ]
  `)
})

test('an unreadable object: its config resources are blocked on scope with action unknown, never created', async () => {
  const { plan, issues } = await planScenario(scope)
  for (const address of [
    'object:harvest',
    'group:harvest/harvest_details',
    'property:harvest/batch_code',
    'property:harvest/picked_on',
  ]) {
    expect(step(plan, address), address).toMatchObject({
      action: 'unknown',
      risk: 'blocked',
      expect: {},
      blocked: { reason: 'scope', blocks: [], fix: expect.stringContaining('crm.schemas.custom.read') },
    })
  }
  expect(step(plan, 'object:harvest').title).toContain('cannot read harvest')
  expect(plan.steps.filter((s) => s.action === 'create').map((s) => s.address)).toEqual([
    'group:companies/legacy',
    'property:companies/harvest_window',
  ])
  expect(plan.coverage).toEqual({
    complete: false,
    unreadable: [{ object: 'harvest', scope: 'crm.schemas.custom.read' }],
    unsupported: ['property:companies/plot_shape'],
    excluded: [],
  })
  expect(issues.find((i) => i.code === 'W_INCOMPLETE')).toMatchInlineSnapshot(`
    {
      "code": "W_INCOMPLETE",
      "fix": "add the scope crm.schemas.custom.read to the key, then run npx kalup plan --target sandbox",
      "message": "the plan could not read harvest, so every step there is blocked",
    }
  `)
})

test('a config object the read never covered is blocked on scope, with a fix that names the objects block', async () => {
  const { plan, issues } = await planScenario({
    files: {
      'hubspot/objects/deals.ts': `import { defineObject, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    terms: { label: 'Terms' },
  },
  properties: {
    termDays: p.number('term_days', { label: 'Term days', group: 'terms', fieldType: 'number' }),
  },
})
`,
    },
  })
  expect(step(plan, 'property:deals/term_days')).toMatchObject({
    action: 'unknown',
    risk: 'blocked',
    title: expect.stringContaining('deals was not read'),
    blocked: { reason: 'scope', fix: 'add deals to objects in kalup.config.ts' },
  })
  // Blocked steps the read never covered make the plan incomplete, as compare config sandbox is.
  expect(plan.coverage).toEqual({
    complete: false,
    unreadable: [{ object: 'deals' }],
    unsupported: ['property:companies/plot_shape'],
    excluded: [],
  })
  expect(issues.find((i) => i.code === 'W_INCOMPLETE')).toMatchInlineSnapshot(`
    {
      "code": "W_INCOMPLETE",
      "fix": "add deals to objects in kalup.config.ts, then run npx kalup plan --target sandbox",
      "message": "the plan could not read deals, so every step there is blocked",
    }
  `)
  expect(planText(plan)).toContain('Coverage: incomplete, not read: deals')
})

test('name overrides: a missing portal name blocks the create, a present one is adopted under a binding', async () => {
  const { plan } = await planScenario(override)
  expect(step(plan, 'property:companies/plot_tags')).toMatchObject({
    action: 'create',
    risk: 'blocked',
    title: expect.stringContaining('the portal has no plot_labels'),
    expect: { exists: false },
    blocked: {
      reason: 'override',
      detail: 'the portal has no plot_labels',
      blocks: [],
      fix: expect.stringContaining('name override for property:companies/plot_tags'),
    },
  })
  expect(step(plan, 'group:companies/legacy')).toMatchObject({
    action: 'adopt',
    held: [{ unit: 'label', config: 'Legacy', live: 'Plots' }],
  })
  expect(plan.bindings).toEqual({ 'group:companies/legacy': { name: 'plots' }, 'object:harvest': { id: '2-4242001' } })
})

test('a held unit on a resource that names a shadowed portal name has no pull command: that pull writes nothing', async () => {
  const { plan } = await planScenario({
    edits: [overrides("        'property:harvest/batch_code': { name: 'batch_code_v2' },")],
  })
  const held = step(plan, 'object:harvest').held ?? []
  expect(held.map((h) => h.unit)).toEqual(['primaryDisplayProperty', 'requiredProperties'])
  expect(held.filter((h) => h.resolve !== undefined)).toEqual([])
  const heldLine = planText(plan)
    .split('\n')
    .find((line) => line.startsWith('  held primaryDisplayProperty'))
  expect(heldLine).not.toContain('kalup pull')
  expect(heldLine).toMatchInlineSnapshot(
    `"  held primaryDisplayProperty diverged: config "batch_code", portal "shadowed:batch_code". No pull takes the portal side while a name override shadows a name the resource refers to; correct or remove that override under targets.sandbox.overrides"`,
  )
  // A resource that names no shadowed name keeps its pull command.
  expect(step(plan, 'group:companies/orchard').held).toEqual([
    {
      unit: 'label',
      class: 'diverged',
      config: 'Orchard',
      live: 'Orchard details',
      resolve: { portal: pull('group:companies/orchard') },
    },
  ])
})

test('a kept option on a resource that names a shadowed portal name names the override, not a pull that writes nothing', async () => {
  // The portal has no orchard_v2, so its own orchard is shadowed. In plots, yield_tier does not wait on that group.
  const { plan } = await planScenario({
    edits: [
      overrides("        'group:companies/orchard': { name: 'orchard_v2' },"),
      [
        files.companies,
        "orchard: { label: 'Orchard' },",
        "orchard: { label: 'Orchard' },\n    plots: { label: 'Plots' },",
      ],
      [
        files.companies,
        "label: 'Yield tier',\n        group: 'orchard',",
        "label: 'Yield tier',\n        group: 'plots',",
      ],
    ],
  })
  const yieldTier = step(plan, 'property:companies/yield_tier')
  expect(yieldTier.action).toBe('adopt')
  expect(yieldTier.held?.find((h) => h.unit === 'group')).toEqual({
    unit: 'group',
    class: 'diverged',
    config: { $ref: 'group:companies/plots' },
    live: { $ref: 'group:companies/shadowed:orchard' },
  })
  const note =
    'kept; no pull adds it to config while a name override shadows a name the resource refers to; correct or remove that override under targets.sandbox.overrides'
  expect(yieldTier.notes?.map((n) => [n.unit, n.note])).toEqual([['options[peak]', note]])
  expect(planText(plan)).toContain(`  note options[peak]: ${note}\n`)
})

test('a config property in a portal group no address can hold is blocked, action unknown, and coverage incomplete', async () => {
  const properties = fixture('api/orchard/companies.properties.json') as { results: Record<string, unknown>[] }
  const groups = fixture('api/orchard/companies.groups.json') as { results: unknown[] }
  const { plan } = await planScenario({
    bodies: {
      [routes.companies]: {
        results: properties.results.map((p) => (p.name === 'plot_total' ? { ...p, groupName: 'odd group' } : p)),
      },
      [routes.companyGroups]: { results: [...groups.results, { name: 'odd group', label: 'Odd', archived: false }] },
    },
  })
  expect(step(plan, 'property:companies/plot_total')).toMatchObject({
    action: 'unknown',
    risk: 'blocked',
    title: expect.stringContaining('its portal group has no address'),
    expect: {},
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('holds whitespace'),
      fix: expect.stringContaining('rename the group in HubSpot'),
    },
  })
  expect(plan.coverage).toEqual({
    complete: false,
    unreadable: [],
    unsupported: ['property:companies/plot_shape'],
    excluded: [],
  })
  expect(planText(plan)).toContain('Coverage: incomplete; 1 unsupported')
})

test("definition overrides: steps plan from the target's effective config, and the digest covers its values", async () => {
  const shared = await planScenario()
  const { plan } = await planScenario({
    edits: [
      overrides(
        [
          "        'property:companies/harvest_window': { definition: { label: 'Picking window', description: '' } },",
          "        'property:companies/yield_tier': { definition: { label: 'Yield band', options: [{ value: 'peak', label: 'Peak' }, { value: 'low', label: 'Low' }] } },",
          "        'group:companies/legacy': { definition: { label: 'Old ledger' } },",
        ].join('\n'),
      ),
    ],
  })
  expect(step(plan, 'property:companies/harvest_window')).toMatchObject({
    action: 'create',
    title: 'Create property "Picking window" (harvest_window) on companies',
    desired: {
      label: 'Picking window',
      group: { $ref: 'group:companies/orchard' },
      type: 'string',
      fieldType: 'text',
      description: '',
    },
  })
  expect(step(plan, 'group:companies/legacy')).toMatchObject({ action: 'create', desired: { label: 'Old ledger' } })
  // The portal's label is the override's, so only the shared plan holds it; the options are the override's list.
  const sharedTier = step(shared.plan, 'property:companies/yield_tier')
  expect(sharedTier.held?.map((h) => h.unit)).toContain('label')
  const tier = step(plan, 'property:companies/yield_tier')
  expect((tier.held ?? []).map((h) => h.unit)).not.toContain('label')
  expect(tier.desired).toMatchObject({
    label: 'Yield band',
    options: [
      { value: 'peak', label: 'Peak' },
      { value: 'low', label: 'Low' },
    ],
  })
  expect(plan.writesHash).toBe(writesHash(plan))
  expect(plan.writesHash).not.toBe(shared.plan.writesHash)
})

test('a lookup override still blocks the resource, and says why', async () => {
  const { plan } = await planScenario({
    edits: [overrides("        'property:companies/harvest_window': { lookup: { label: 'Harvest window' } },")],
  })
  expect(step(plan, 'property:companies/harvest_window')).toMatchObject({
    action: 'create',
    risk: 'blocked',
    title: expect.stringContaining('lookup overrides are not applied'),
    blocked: {
      reason: 'override',
      detail: expect.stringContaining('lookup resources'),
      fix: expect.stringContaining('lookup override for property:companies/harvest_window'),
    },
  })
})

test('a skip wins over a definition override on the same address: no step', async () => {
  const { plan } = await planScenario({
    edits: [
      overrides(
        "        'property:companies/harvest_window': { skip: true, definition: { label: 'Picking window' } },",
      ),
    ],
  })
  expect(plan.steps.some((s) => s.address === 'property:companies/harvest_window')).toBe(false)
  expect(plan.coverage.excluded).toEqual(['property:companies/harvest_window'])
})

test('skip overrides: no step, and the skipped addresses are listed as excluded', async () => {
  const { plan } = await planScenario({
    edits: [
      overrides(
        "        'object:harvest': { skip: true },\n        'group:companies/orchard': { skip: true },\n        'property:companies/row_meta': { skip: true },",
      ),
    ],
  })
  expect(plan.steps.map((s) => s.address)).toEqual(['group:companies/legacy'])
  expect(plan.coverage.excluded).toEqual([
    'group:companies/orchard',
    'group:harvest/harvest_details',
    'object:harvest',
    'property:companies/harvest_window',
    'property:companies/plot_tags',
    'property:companies/plot_total',
    'property:companies/row_meta',
    'property:companies/yield_tier',
    'property:harvest/batch_code',
    'property:harvest/picked_on',
  ])
  expect(plan.notCovered).toEqual([])
})

test('a skip still means no step when the object it is on could not be read', async () => {
  const { plan } = await planScenario({
    refused: [routes.harvest],
    edits: [overrides("        'property:harvest/picked_on': { skip: true },")],
  })
  expect(plan.coverage.excluded).toEqual(['property:harvest/picked_on'])
  expect(plan.steps.some((s) => s.address === 'property:harvest/picked_on')).toBe(false)
  expect(step(plan, 'property:harvest/batch_code').blocked?.reason).toBe('scope')
})

test('ignoreChanges: a create sets the field and lists it; an adopt leaves it out of desired and never holds it', async () => {
  const described = (address: string, text: string): Edit[] => [
    [files.companies, address, `${address}\n      description: '${text}',`],
  ]
  const { plan } = await planScenario({
    edits: [
      ...described("label: 'Yield tier',", 'Tier from the yield sync'),
      ...described("label: 'Harvest window',", 'Weeks of the harvest'),
      [
        files.companies,
        "      fieldType: 'text',\n    }),\n    lifecyclestage",
        "      fieldType: 'text',\n      lifecycle: { ignoreChanges: ['description'] },\n    }),\n    lifecyclestage",
      ],
    ],
  })
  expect(step(plan, 'property:companies/harvest_window')).toMatchObject({
    action: 'create',
    desired: { description: 'Weeks of the harvest' },
    ignoreChanges: ['description'],
  })
  const yieldTier = step(plan, 'property:companies/yield_tier')
  expect(yieldTier.desired).not.toHaveProperty('description')
  expect(yieldTier.ignoreChanges).toBeUndefined()
  expect(yieldTier.held?.map((h) => h.unit)).toEqual(['label'])
})

test('ignoreChanges on a create is sorted by code unit and deduplicated: its order in config never changes the hash', async () => {
  const ignoring = (list: string) =>
    planScenario({
      edits: [
        [
          files.companies,
          "      fieldType: 'text',\n    }),\n    lifecyclestage",
          `      fieldType: 'text',\n      lifecycle: { ignoreChanges: ${list} },\n    }),\n    lifecyclestage`,
        ],
      ],
    })
  const address = 'property:companies/harvest_window'
  const one = (await ignoring("['label', 'description']")).plan
  const other = (await ignoring("['description', 'label', 'label']")).plan
  expect(step(one, address).ignoreChanges).toEqual(['description', 'label'])
  expect(step(other, address).ignoreChanges).toEqual(['description', 'label'])
  expect(other.writesHash).toBe(one.writesHash)
})

test('archived names: a property HubSpot holds archived is never created; a group of an archived name is', async () => {
  const { plan, requests } = await planScenario(archived)
  expect(step(plan, 'property:companies/harvest_window')).toMatchObject({
    action: 'create',
    risk: 'blocked',
    title: expect.stringContaining('archived name'),
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('archived property named harvest_window'),
      fix: expect.stringContaining('restore it in HubSpot'),
    },
  })
  // A group create of an archived group's name makes a group with the new label (observed on 2026-09-29).
  expect(step(plan, 'group:companies/old_ledger')).toMatchObject({ action: 'create', risk: 'safe' })
  expect(step(plan, 'property:companies/ledger_code')).toMatchObject({ action: 'create', risk: 'safe' })
  // One archived list per data sensitivity, as for the live properties.
  expect(requests.filter((r) => r.includes('?archived=true'))).toEqual([
    `${routes.companies}?archived=true`,
    `${routes.companies}?archived=true&dataSensitivity=sensitive`,
    `${routes.companies}?archived=true&dataSensitivity=highly_sensitive`,
  ])
})

test('an archived name only the sensitive archived list holds blocks the create too', async () => {
  const archivedSensitive = {
    results: [
      { ...(fixture('plans/api/companies.archived.json').results as object[])[0], dataSensitivity: 'sensitive' },
    ],
  }
  const { plan } = await planScenario({
    bodies: { [`${routes.companies}?archived=true&dataSensitivity=sensitive`]: archivedSensitive },
  })
  expect(step(plan, 'property:companies/harvest_window')).toMatchObject({
    action: 'create',
    risk: 'blocked',
    blocked: { reason: 'unsupported', detail: expect.stringContaining('an archived property named harvest_window') },
  })
})

test('unsupported: a HubSpot-defined or calculated property, a portal type no builder carries, a diverged type', async () => {
  const { plan } = await planScenario(unsupported)
  expect(step(plan, 'property:companies/soil_ph')).toMatchObject({
    action: 'adopt',
    risk: 'blocked',
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('run kalup pull'),
      fix: 'run kalup pull --target sandbox --only property:companies/soil_ph',
    },
  })
  expect(step(plan, 'property:companies/plot_shape')).toMatchObject({
    action: 'adopt',
    risk: 'blocked',
    title: expect.stringContaining('unsupported type'),
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('type object_coordinates and fieldType text'),
    },
  })
  const plotTags = step(plan, 'property:companies/plot_tags')
  expect(plotTags).toMatchObject({
    action: 'adopt',
    risk: 'blocked',
    blocked: {
      reason: 'unsupported',
      detail: expect.stringContaining('type "number" and the portal "string"'),
      // The migration recipe: HubSpot changes neither type nor hasUniqueValue in place.
      fix: expect.stringContaining('then run kalup rm on this one'),
    },
  })
  expect(plotTags.changes).toBeUndefined()
  expect(step(plan, 'property:harvest/batch_code').blocked?.detail).toContain(
    'hasUniqueValue false and the portal true',
  )
})

test('owner, rich text and phone properties: p.owner and p.phoneNumber adopt them, another builder is blocked', async () => {
  const listed = fixture('api/orchard/companies.properties.json') as { results: unknown[] }
  const unwritable = fixture('api/orchard/companies.unwritable.json') as { results: unknown[] }
  const scenario = (lines: string[]) =>
    planScenario({
      bodies: { [routes.companies]: { results: [...listed.results, ...unwritable.results] } },
      edits: [[files.companies, "    name: p.string('name'),", [...lines, "    name: p.string('name'),"].join('\n')]],
    })
  const { plan } = await scenario([
    "    groveManager: p.enum('grove_manager', { label: 'Grove manager', group: 'orchard', fieldType: 'select' }),",
    "    groveStewards: p.string('grove_stewards', { label: 'Grove stewards', group: 'orchard', fieldType: 'text' }),",
    "    growerPhone: p.string('grower_phone').readonly(),",
  ])
  expect(step(plan, 'property:companies/grove_manager')).toMatchObject({
    action: 'adopt',
    risk: 'blocked',
    blocked: {
      reason: 'unsupported',
      detail: 'the portal property is a HubSpot user property, which p.enum does not manage',
      fix: 'change the builder to p.owner',
    },
  })
  expect(step(plan, 'property:companies/grove_stewards').blocked).toMatchObject({
    reason: 'unsupported',
    detail: 'the portal property is a HubSpot user property with fieldType checkbox, which Kalup does not write',
  })
  const addresses = plan.steps.map((s) => s.address)
  for (const name of ['grower_phone', 'grove_notes', 'grove_crew', 'hubspot_owner_id']) {
    expect(addresses, name).not.toContain(`property:companies/${name}`)
  }
  expect(plan.coverage.unsupported).toEqual([
    'property:companies/grove_crew',
    'property:companies/grove_stewards',
    'property:companies/plot_shape',
  ])
  const managed = await scenario([
    "    groveManager: p.owner('grove_manager', { label: 'Grove manager', group: 'orchard', fieldType: 'select', formField: true }),",
    "    groveNotes: p.string('grove_notes', { label: 'Grove notes', group: 'orchard', fieldType: 'html' }),",
    "    growerPhone: p.phoneNumber('grower_phone', { label: 'Grower phone', group: 'orchard', fieldType: 'phonenumber' }),",
  ])
  for (const name of ['grove_manager', 'grove_notes', 'grower_phone']) {
    expect(step(managed.plan, `property:companies/${name}`), name).toMatchObject({ action: 'adopt', risk: 'safe' })
  }
})

// A property the files define is in the pull scope whatever include and custom say, so the printed pull makes it a
// reference.
test('HubSpot-defined or calculated in the files: the fix is the pull that makes it a reference, whatever the scope', async () => {
  const domain = 'property:companies/domain'
  const managesDomain: Edit = [
    files.companies,
    "    name: p.string('name'),",
    "    domain: p.string('domain', { label: 'Domain', group: 'orchard', fieldType: 'text' }),\n    name: p.string('name'),",
  ]
  const { plan } = await planScenario({ edits: [managesDomain] })
  expect(step(plan, domain)).toMatchObject({
    action: 'adopt',
    risk: 'blocked',
    title: expect.stringContaining('HubSpot-defined or calculated'),
    blocked: { reason: 'unsupported', fix: `run ${pull(domain)}` },
  })
  // A calculated custom property, soil_ph, keeps the pull once custom is off.
  const customOff: Edit = [files.config, 'companies: { include:', 'companies: { custom: false, include:']
  const off = await planScenario({ edits: [...(unsupported.edits ?? []), customOff] })
  expect(step(off.plan, 'property:companies/soil_ph').blocked?.fix).toBe(`run ${pull('property:companies/soil_ph')}`)
})

// exclude leaves out portal properties the files lack; a property the files define stays in the pull scope.
test('a managed property exclude names keeps the pull that takes the portal side of a held unit', async () => {
  const check = async (patterns: string) => {
    const excluded: Edit = [files.config, 'companies: { include:', `companies: { exclude: [${patterns}], include:`]
    const { plan } = await planScenario({ edits: [excluded] })
    const yieldTier = step(plan, 'property:companies/yield_tier')
    expect(yieldTier.held?.[0]).toMatchObject({ unit: 'label', resolve: { portal: expect.stringContaining('pull') } })
    expect(yieldTier.notes?.find((n) => n.unit === 'label')).toBeUndefined()
  }
  await check("'yield_tier'")
  await check("'yield_*'")
})

test('bindings: an existing custom object by id and a renamed referenced group by name, both in writesHash', async () => {
  const moved: Edit = [
    files.companies,
    "label: 'Harvest window',\n      group: 'orchard',",
    "label: 'Harvest window',\n      group: 'legacy',",
  ]
  const named = (name: string) =>
    planScenario({ edits: [moved, overrides(`        'group:companies/legacy': { name: '${name}' },`)] })
  const plots = (await named('plots')).plan
  const info = (await named('companyinformation')).plan
  const address = 'property:companies/harvest_window'
  expect(step(plots, address).desired).toEqual(step(info, address).desired)
  expect(step(plots, address).desired?.group).toEqual({ $ref: 'group:companies/legacy' })
  expect(plots.bindings).toEqual({ 'group:companies/legacy': { name: 'plots' }, 'object:harvest': { id: '2-4242001' } })
  expect(info.bindings['group:companies/legacy']).toEqual({ name: 'companyinformation' })
  expect(plots.writesHash).not.toBe(info.writesHash)
  // A planned create keeps its logical identity: no binding for it.
  expect(Object.hasOwn(plots.bindings, address)).toBe(false)
})

test('an owned field that already matches the portal still changes desired and writesHash', async () => {
  const base = (await planScenario()).plan
  const described = (
    await planScenario({
      edits: [[files.companies, "label: 'Row meta',", "label: 'Row meta',\n      description: 'Row layout as JSON',"]],
    })
  ).plan
  const address = 'property:companies/row_meta'
  expect(step(described, address).desired?.description).toBe('Row layout as JSON')
  expect(step(described, address).changes).toBeUndefined()
  expect(step(described, address).held).toBeUndefined()
  expect(described.writesHash).not.toBe(base.writesHash)
})

test('policy: protected defaults to a STANDARD account, config sets it, drift and allowDestroy; permanent names on STANDARD only', async () => {
  const developer = (await planScenario()).plan
  expect(developer.target).toEqual({
    name: 'sandbox',
    portalId: 1_111_111,
    accountType: 'DEVELOPER_TEST',
    uiDomain: 'app-eu1.hubspot.com',
    protected: false,
    drift: 'hold',
    adopt: 'hold',
    allowDestroy: false,
    yesLimit: 25,
    takeover: [],
  })
  expect(developer.permanentNames).toBe(0)
  const standard = (await planScenario({ accountType: 'STANDARD' })).plan
  expect(standard.target).toMatchObject({ protected: true, drift: 'hold', allowDestroy: false })
  expect(standard.permanentNames).toBe(2)
  const set = (
    await planScenario({
      accountType: 'STANDARD',
      edits: [
        [files.config, 'portalId: 1111111,', "portalId: 1111111,\n      protected: false,\n      drift: 'overwrite',"],
      ],
    })
  ).plan
  expect(set.target).toMatchObject({ protected: false, drift: 'overwrite', allowDestroy: false })
  expect(set.writesHash).not.toBe(standard.writesHash)
  const destroys = (
    await planScenario({
      accountType: 'STANDARD',
      edits: [[files.config, 'portalId: 1111111,', 'portalId: 1111111,\n      allowDestroy: true,']],
    })
  ).plan
  expect(destroys.target).toMatchObject({ protected: true, drift: 'hold', allowDestroy: true })
  expect(destroys.writesHash).not.toBe(standard.writesHash)
})

test('without state a plan has no serial, the normalizer versions of the registry, and no orphans or missing resources', async () => {
  const { plan } = await planScenario()
  expect(plan).toMatchObject({
    stateLineage: null,
    stateSerial: null,
    normVersions: NORM_VERSIONS,
    orphans: [],
    missing: [],
  })
})

test('budget: three calls per write plus the observation apply makes; the daily figure, or null with W_RATE_HEADERS', async () => {
  const quiet = await planScenario()
  // Two creates and one adopt that writes an option: 9. Then apply's observation: four lists for each of companies and
  // harvest, the three archived lists of companies (a create), the schemas list for the harvest binding, and
  // account-info: 13. Adopts with nothing to write make no call of their own.
  expect(quiet.plan.budget).toEqual({ estimatedCalls: 22, dailyRemaining: null })
  expect(codes(quiet.issues)).toEqual(['W_RATE_HEADERS'])
  const told = await planScenario({ daily: 412_000 })
  expect(told.plan.budget).toEqual({ estimatedCalls: 22, dailyRemaining: 412_000 })
  expect(codes(told.issues)).toEqual([])
})

test('notCovered: once per type with steps, sorted by type', async () => {
  const { plan } = await planScenario()
  expect(plan.notCovered.map((entry) => entry.type)).toEqual(['object', 'property'])
  expect(plan.notCovered).toMatchInlineSnapshot(`
    [
      {
        "lines": [
          "Not copied, HubSpot has no API: record page layouts, saved views.",
        ],
        "type": "object",
      },
      {
        "lines": [
          "Not copied, HubSpot has no API: conditional property logic, field-level permissions.",
        ],
        "type": "property",
      },
    ]
  `)
})

test('planReads: the limits a plan needs and the objects whose archived property names it must know', async () => {
  const { input } = await planScenario(crate)
  expect(planReads(input)).toEqual({
    // crate does not exist yet, so it has no archived properties to list and no type ID.
    archived: { companies: 'companies' },
    // Every object read has its type ID, a standard object its documented one, for the custom-properties entries. The
    // custom object create is blocked, so no custom-object-types reading.
    limits: { objectTypes: false, properties: true, objectTypeIds: { companies: '0-2', harvest: '2-4242001' } },
  })
  const onHarvest = await planScenario({
    edits: [
      [
        files.harvest,
        '  properties: {\n',
        "  properties: {\n    grade: p.string('grade', { label: 'Grade', group: 'harvest_details', fieldType: 'text' }),\n",
      ],
    ],
  })
  expect(planReads(onHarvest.input).archived).toEqual({ companies: 'companies', harvest: '2-4242001' })
  expect(onHarvest.requests).toContain(`${routes.harvest}?archived=true`)
  const none = await planScenario({
    edits: [overrides("        'property:companies/harvest_window': { skip: true },")],
  })
  expect(planReads(none.input)).toEqual({
    archived: {},
    limits: { objectTypes: false, properties: false, objectTypeIds: { companies: '0-2', harvest: '2-4242001' } },
  })
  // An object the key could not read has no type ID.
  const unread = await planScenario(scope)
  expect(planReads(unread.input).limits.objectTypeIds).toEqual({ companies: '0-2' })
  expect(none.plan.preflight.limits).toEqual([])
})

test('W_PIN_EXPIRES: once per API family of the registry rows the steps use, within 90 days of expiry', async () => {
  expect(codes((await planScenario({ daily: 412_000 })).issues)).toEqual([])
  vi.setSystemTime(new Date('2028-01-15T00:00:00Z'))
  const expiring = (await planScenario({ daily: 412_000 })).issues
  expect(codes(expiring)).toEqual(['W_PIN_EXPIRES', 'W_PIN_EXPIRES'])
  expect(expiring).toMatchInlineSnapshot(`
    [
      {
        "code": "W_PIN_EXPIRES",
        "fix": "upgrade kalup to a release that pins a newer version",
        "message": "the crm-object-schemas API pin 2026-09 expires 2028-03",
      },
      {
        "code": "W_PIN_EXPIRES",
        "fix": "upgrade kalup to a release that pins a newer version",
        "message": "the crm.properties API pin 2026-09 expires 2028-03",
      },
    ]
  `)
  // Without an object step the schemas pin is not the plan's to warn about.
  const noObject = await planScenario({
    daily: 412_000,
    edits: [overrides("        'object:harvest': { skip: true },")],
  })
  expect(codes(noObject.issues)).toEqual(['W_PIN_EXPIRES'])
  expect(noObject.issues[0]?.message).toContain('crm.properties API pin 2026-09')
  // The rows a plan steps through go to the public API: every one is ga with a write path.
  for (const row of [registry.object, registry.group, registry.property]) {
    expect(row.status).toBe('ga')
    expect(Object.values(row.paths).some((endpoint) => endpoint.tag === 'write')).toBe(true)
  }
})

test('human text: portal and config strings are stripped of control characters, structured values stay exact', async () => {
  const esc = String.fromCodePoint(0x1b)
  const csi = String.fromCodePoint(0x9b)
  const live = `Yield${csi}2J band${String.fromCodePoint(0x20_28)}`
  const { plan } = await planScenario({
    bodies: {
      [routes.companies]: {
        results: (fixture('api/orchard/companies.properties.json').results as { name: string }[]).map((p) =>
          p.name === 'yield_tier' ? { ...p, label: live } : p,
        ),
      },
    },
    edits: [[files.companies, "label: 'Yield tier',", "label: 'Yield\\u001b[31m tier',"]],
  })
  const yieldTier = step(plan, 'property:companies/yield_tier')
  expect(yieldTier.title).toContain('"Yield tier" (yield_tier)')
  expect(yieldTier.held?.[0]).toMatchObject({ config: `Yield${esc}[31m tier`, live })
  const text = planText(plan)
  expect(Array.from(text).filter((c) => c !== '\n' && CONTROL.test(c))).toEqual([])
  expect(text).toContain('s9 safe Adopt property "Yield tier" (yield_tier)')
  // Values print as JSON with every control escaped, so a person sees what the portal holds.
  expect(text).toContain('config "Yield\\u001b[31m tier", portal "Yield\\u009b2J band\\u2028"')
})

// A pull writes the file every target shares, so taking one portal's side changes the others' plans.
test('human text with several targets names the override that keeps a diverged value on this target alone', async () => {
  const { plan } = await planScenario(limit)
  const yieldTier = 'property:companies/yield_tier'
  const sharedLines = (given = {}, targets = ['sandbox', 'client']) =>
    planText(plan, { targets, overrides: given })
      .split('\n')
      .filter((line) => line.startsWith('  shared:'))
  expect(sharedLines()).toContain(
    `  shared: a pull writes the portal's values into the file every target shares; to keep them on target sandbox alone, add a definition override for ${yieldTier} under targets.sandbox.overrides`,
  )
  expect(sharedLines({ [yieldTier]: { definition: { label: 'Yield band' } } })).not.toContainEqual(
    expect.stringContaining(yieldTier),
  )
  expect(sharedLines({}, ['sandbox'])).toEqual([])
  expect(planText(plan)).not.toContain('  shared:')
})

test('human text sanitizes a plan it did not build: a saved plan can carry anything', () => {
  const doc = structuredClone(golden('limit'))
  const csi = String.fromCodePoint(0x9b)
  doc.target.name = `sand${csi}box`
  for (const s of doc.steps) {
    s.title = `${s.title}${String.fromCodePoint(0x1b)}[2J${String.fromCodePoint(0x20_29)}`
    if (s.blocked) {
      s.blocked.detail = `${s.blocked.detail}${csi}`
    }
  }
  const text = planText(doc)
  expect(Array.from(text).filter((c) => c !== '\n' && CONTROL.test(c))).toEqual([])
  expect(text).toContain('for target sandbox, portal 1111111')
})

test('human text: a header, one line per step, its held units, notes and block, then the totals', async () => {
  const { plan } = await planScenario(limit)
  const text = planText(plan)
  expect(text.split('\n')[0]).toContain(plan.planId)
  // A held unit names both ways out: the portal side, and config's.
  expect(text).toContain(pull('property:companies/yield_tier'))
  expect(text).toContain("kalup plan --target sandbox --take config 'property:companies/yield_tier#label'")
  expect(normalise(text)).toMatchInlineSnapshot(`
    "Plan pl_<id> for target sandbox, portal 1111111 (DEVELOPER_TEST, not protected)
    Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    s1 blocked Cannot plan object crate: schema writes not supported
      the portal has no custom object crate, and custom object schema writes are not supported in this release
      fix: create it in HubSpot, or leave it out on this target: add { 'object:crate': { skip: true } } under targets.sandbox.overrides
    s2 safe Adopt custom object "Harvest" (harvest)
    s3 safe Create property group "Legacy" (legacy) on companies
      label "Legacy"
    s4 safe Adopt property group "Orchard" (orchard) on companies
      held label diverged: config "Orchard", portal "Orchard details". Take the portal side: kalup pull --target sandbox --only group:companies/orchard; take config: kalup plan --target sandbox --take config 'group:companies/orchard#label'
    s5 blocked Cannot plan group crate_details on crate: object:crate is blocked
      object:crate is blocked
    s6 safe Adopt property group "Harvest details" (harvest_details) on harvest
    s7 safe Create property "Harvest window" (harvest_window) on companies
      label "Harvest window", group orchard, fieldType "text"
    s8 safe Adopt property "Plot tags" (plot_tags) on companies
    s9 safe Adopt property "Plot total" (plot_total) on companies
    s10 safe Adopt property "Row meta" (row_meta) on companies
    s11 safe Adopt property "Yield tier" (yield_tier) on companies, add option "Trial"
      + option "Trial" ("trial")
      held label diverged: config "Yield tier", portal "Yield band". Take the portal side: kalup pull --target sandbox --only property:companies/yield_tier; take config: kalup plan --target sandbox --take config 'property:companies/yield_tier#label'
      note options[peak]: kept; to add it to config, run kalup pull --target sandbox --only property:companies/yield_tier
    s12 blocked Cannot plan property crate_code on crate: group:crate/crate_details is blocked
      group:crate/crate_details is blocked
    s13 safe Adopt property "Batch code" (batch_code) on harvest
    s14 safe Adopt property "Picked on" (picked_on) on harvest
    2 values config and HubSpot never agreed on (diverged): set adopt: 'overwrite' under targets.sandbox in kalup.config.ts to write config over them, or run kalup plan --target sandbox --take config '<address glob>'
    11 safe, 0 risky, 0 destructive, 3 blocked, 0 manual; 2 held
    Coverage: complete; 1 unsupported, 0 skipped.
    About 22 API calls; the daily remainder is unknown.
    Not copied, HubSpot has no API: record page layouts, saved views.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    "
  `)
})

test('human text: one permanent name is singular, more are plural, and none prints no line', () => {
  const doc = golden('orchard')
  const line = (permanentNames: number) =>
    planText({ ...doc, permanentNames })
      .split('\n')
      .filter((l) => l.endsWith('can never be renamed.'))
  expect(line(0)).toEqual([])
  expect(line(1)).toEqual([expect.stringContaining('1 internal name ')])
  expect(line(2)).toEqual([expect.stringContaining('2 internal names ')])
})

test('a plan that does not conform to plan/1 never leaves the engine: it throws E_PLAN_SCHEMA, exit 1', async () => {
  const { input } = await planScenario()
  const thrown = (() => {
    try {
      buildPlan({ ...input, portal: { ...input.portal, portalId: 0 } })
    } catch (error) {
      return error
    }
    return undefined
  })()
  expect(thrown).toBeInstanceOf(KalupError)
  expect((thrown as KalupError).exitCode).toBe(1)
  expect((thrown as KalupError).issues).toEqual([
    { code: 'E_PLAN_SCHEMA', message: expect.any(String), configPath: 'target.portalId' },
  ])
})

test('loadScenario refuses an edit that does not apply, so a scenario never passes by accident', () => {
  expect(() => loadScenario({ edits: [[files.config, 'no such text', '']] })).toThrow('kalup.config.ts has no')
})

test('human text: an option removal and a relabel show their values, and blocked steps count as pending', async () => {
  const { plan } = await planScenario(exact)
  const text = planText(plan)
  expect(text).toContain('  - option "Peak" ("peak")\n')
  const { plan: limited } = await planScenario(limit)
  expect(planPending(limited)).toBe(
    'Changes pending: 11 steps to apply, 3 blocked steps, which count as pending, 2 held values.',
  )
})
