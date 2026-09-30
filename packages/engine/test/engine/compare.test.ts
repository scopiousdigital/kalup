import type { Override } from '@kalup/core'
import { expect, test } from 'vitest'
import { type Comparison, compare, compareOutcome, compareText, resolveSide } from '../../src/engine/compare.js'
import { configObservation, type Observation, observeTarget } from '../../src/engine/observe.js'
import type { Coverage, IRResource, ObjectCoverage } from '../../src/ir/types.js'
import { createHttp, type Fetch } from '../../src/lib/http.js'
import { type Loaded, loadFiles } from '../../src/loader/load.js'
import { project, readProjectFiles } from '../support/project.js'
import { fakeFetch, fixture, jsonResponse, portalBody, route } from '../support/testing.js'

// A reason that names what each of two sides could not capture.
const bothSides = /holds whitespace; .*holds whitespace$/

const routes = {
  schemas: '/crm-object-schemas/2026-09/schemas',
  companies: '/crm/properties/2026-09/companies',
  companyGroups: '/crm/properties/2026-09/companies/groups',
  deals: '/crm/properties/2026-09/deals',
  harvest: '/crm/properties/2026-09/2-4242001',
  harvestGroups: '/crm/properties/2026-09/2-4242001/groups',
}

type Bodies = Record<string, unknown>
type Item = Record<string, unknown>

// The inited fixture project is what a first pull of the orchard portal writes: config and portal agree. These tests
// leave out the plot_shape reference it holds, so the portal's unsupported property is one only the portal holds.
const inited = withoutPlotShape()
const config = configObservation(inited)

function withoutPlotShape(): Loaded {
  const root = project('inited')
  const files = readProjectFiles(root)
  const companies = 'kalup/objects/companies.ts'
  files[companies] = (files[companies] as string).replace("    plotShape: p.string('plot_shape'),\n", '')
  return loadFiles(files, { root, version: '0.0.0' })
}

function orchard(): Bodies {
  return {
    [routes.schemas]: fixture('api/orchard/schemas.json'),
    [routes.companies]: fixture('api/orchard/companies.properties.json'),
    [routes.companyGroups]: fixture('api/orchard/companies.groups.json'),
    [routes.harvest]: fixture('api/orchard/harvest.properties.json'),
    [routes.harvestGroups]: fixture('api/orchard/harvest.groups.json'),
  }
}

function edit(bodies: Bodies, at: string, change: (item: Item) => Item | Item[]): Bodies {
  const list = bodies[at] as { results: Item[] }
  bodies[at] = { results: list.results.flatMap(change) }
  return bodies
}

function withOptions(bodies: Bodies, name: string, options: Item[]): Bodies {
  return edit(bodies, routes.companies, (p) => (p.name === name ? { ...p, options } : p))
}

interface Observe {
  bodies?: Bodies
  loaded?: Loaded
  overrides?: Record<string, Override>
  refused?: string[]
}

// Target sandbox of a project read from the orchard portal, some routes refused (403).
async function observe({ bodies = orchard(), loaded = inited, overrides, refused = [] }: Observe = {}) {
  const fetch: Fetch = (url, init) => {
    const body = refused.includes(route(url))
      ? jsonResponse(403, fixture('errors/missing-scope.json'))
      : jsonResponse(200, portalBody(bodies, url))
    return fakeFetch(body).fetch(url, init)
  }
  const http = createHttp({ key: 'kalup-test-secret-9f2c', fetch, warn: () => undefined })
  const { sandbox } = loaded.config.targets
  const overridden = overrides
    ? { ...loaded, config: { ...loaded.config, targets: { sandbox: { ...sandbox, overrides } } } }
    : loaded
  return (await observeTarget(http, overridden, 'sandbox')).observation
}

function withResources(resources: Record<string, IRResource>): Loaded {
  return { ...inited, ir: { ...inited.ir, resources: { ...inited.ir.resources, ...resources } } }
}

function configResource(address: string): IRResource {
  return inited.ir.resources[address] as IRResource
}

// The keep note names the command that brings a portal-only option into config, from the side that holds it.
const kept = expect.stringContaining('kalup pull --target sandbox --only property:companies/yield_tier')

// C0 and C1 control characters, which no text kalup prints may hold.
function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

// A snapshot of a read, which keeps no members and no meta.
function snapshot(observation: Observation, file: string, observedAt: string): Observation {
  const { members: _members, meta: _meta, ...rest } = observation
  return { ...rest, side: { kind: 'snapshot', file, name: 'sandbox', portalId: 1_111_111, observedAt } }
}

const unmanaged = [
  { address: 'group:companies/companyinformation', status: 'unmanaged' },
  { address: 'group:harvest/harvestinformation', status: 'unmanaged' },
  { address: 'property:companies/plot_shape', status: 'unmanaged' },
]

// The yield_tier options as the orchard portal holds them, in display order.
const yieldOptions = [
  { label: 'Peak', value: 'peak', displayOrder: -1, hidden: true },
  { label: 'Low', value: 'low', displayOrder: 0, hidden: false },
  { label: 'High', value: 'HIGH', displayOrder: 1, hidden: false },
]

test('golden: a clean first pull compares complete and equal; built-in groups and the unsupported property are unmanaged', async () => {
  const target = await observe()
  const comparison = compare(config, target)
  expect(comparison).toEqual({
    a: { kind: 'config' },
    b: { kind: 'target', name: 'sandbox', portalId: 1_111_111 },
    complete: true,
    counts: { equal: 16, differs: 0, onlyA: 0, onlyB: 0, unmanaged: 3, unknown: 0, excluded: 0 },
    differences: unmanaged,
  })
  expect(compareOutcome(comparison, config, target, true)).toEqual({ exitCode: 0, issues: [] })
  expect(compareText(comparison)).toMatchInlineSnapshot(`
    "a: config
    b: target sandbox, portal 1111111
    16 equal, 0 differ, 0 only in a, 0 only in b, 3 unmanaged, 0 unknown, 0 skipped
    unmanaged: group:companies/companyinformation
    unmanaged: group:harvest/harvestinformation
    unmanaged: property:companies/plot_shape
    "
  `)
})

test('equal inputs: config against a portal holding exactly it, and an observation against itself', async () => {
  let bodies = edit(orchard(), routes.companyGroups, (g) => (g.name === 'companyinformation' ? [] : g))
  bodies = edit(bodies, routes.harvestGroups, (g) => (g.name === 'harvestinformation' ? [] : g))
  bodies = edit(bodies, routes.companies, (p) => (p.name === 'plot_shape' ? [] : p))
  expect(compare(config, await observe({ bodies }))).toMatchObject({
    complete: true,
    counts: { equal: 16, differs: 0, onlyA: 0, onlyB: 0, unmanaged: 0, unknown: 0, excluded: 0 },
    differences: [],
  })
  const target = await observe()
  const same = compare(target, target)
  // 18 resources and the unsupported property.
  expect(same).toMatchObject({ complete: true, differences: [] })
  expect(same.counts.equal).toBe(19)
})

test('a resource only config holds is only-a; between two observations a one-sided resource is only-a or only-b', async () => {
  const lacking = await observe({ bodies: edit(orchard(), routes.harvest, (p) => (p.name === 'weight_kg' ? [] : p)) })
  const comparison = compare(config, lacking)
  expect(comparison.differences).toContainEqual({ address: 'property:harvest/weight_kg', status: 'only-a' })
  expect(comparison.counts).toMatchObject({ equal: 15, onlyA: 1 })
  expect(compareOutcome(comparison, config, lacking, true)).toEqual({ exitCode: 2, issues: [] })
  expect(compareOutcome(comparison, config, lacking, false)).toEqual({ exitCode: 0, issues: [] })

  const full = await observe()
  expect(compare(full, lacking).differences).toEqual([{ address: 'property:harvest/weight_kg', status: 'only-a' }])
  expect(compare(lacking, full).differences).toEqual([{ address: 'property:harvest/weight_kg', status: 'only-b' }])
})

test('a scalar that differs with no base is held, with the value on each side', async () => {
  const bodies = edit(orchard(), routes.companies, (p) => (p.name === 'plot_total' ? { ...p, label: 'Plot sum' } : p))
  const comparison = compare(config, await observe({ bodies }))
  expect(comparison.differences).toEqual([
    ...unmanaged,
    {
      address: 'property:companies/plot_total',
      status: 'differs',
      held: [{ unit: 'label', class: 'diverged', a: 'Plot total', b: 'Plot sum' }],
    },
  ])
  expect(comparison.counts).toMatchObject({ equal: 15, differs: 1 })
})

test('an option only config holds is a change: before is b, after is a', async () => {
  const bodies = withOptions(
    orchard(),
    'yield_tier',
    yieldOptions.filter((o) => o.value !== 'HIGH'),
  )
  expect(compare(config, await observe({ bodies })).differences).toContainEqual({
    address: 'property:companies/yield_tier',
    status: 'differs',
    changes: [
      { unit: 'options[HIGH]', class: 'add', op: 'add', before: null, after: { value: 'HIGH', label: 'High' } },
    ],
  })
})

test('an option only the portal holds is kept and noted; exact or removedOptions make it a removal', async () => {
  const bodies = withOptions(orchard(), 'yield_tier', [
    ...yieldOptions,
    { label: 'Mid', value: 'mid', displayOrder: 2, hidden: false },
  ])
  const target = await observe({ bodies })
  const mid = { value: 'mid', label: 'Mid', hidden: false, description: '' }
  expect(compare(config, target).differences).toContainEqual({
    address: 'property:companies/yield_tier',
    status: 'differs',
    notes: [{ unit: 'options[mid]', b: mid, note: kept }],
  })
  // A snapshot shows the portal as it was: the note offers a new snapshot, or a pull from the target it read.
  const old = snapshot(target, '.kalup/snapshots/sandbox/a.json', '2026-09-01T10:00:00.000Z')
  expect(compare(config, old).differences).toContainEqual({
    address: 'property:companies/yield_tier',
    status: 'differs',
    notes: [
      {
        unit: 'options[mid]',
        b: mid,
        note: expect.stringContaining('take a new snapshot'),
      },
    ],
  })

  const removal = {
    address: 'property:companies/yield_tier',
    status: 'differs',
    changes: [{ unit: 'options[mid]', class: 'remove', op: 'remove', before: mid, after: null }],
  }
  const yieldTier = configResource('property:companies/yield_tier')
  for (const lifecycle of [{ options: 'exact' as const }, { options: 'additive' as const, removedOptions: ['mid'] }]) {
    const loaded = withResources({ 'property:companies/yield_tier': { ...yieldTier, lifecycle } })
    expect(compare(configObservation(loaded), target).differences).toContainEqual(removal)
  }
})

// The kept notes on one address, in unit order.
function notesOn(comparison: Comparison, address: string): string[] | undefined {
  return comparison.differences.find((d) => d.address === address)?.notes?.map((n) => n.note)
}

// pull keeps a property outside its object's pull scope as written, so `pull --only` would bring nothing into config:
// the note names include instead.
const include = (name: string) => expect.stringContaining(`add '${name}' to objects.companies.include`)

test('a kept option on a property outside the pull scope names include, never a pull that would do nothing', async () => {
  const bodies = withOptions(orchard(), 'yield_tier', [
    ...yieldOptions,
    { label: 'Mid', value: 'mid', displayOrder: 2, hidden: false },
  ])
  const target = await observe({ bodies })
  const yieldTier = 'property:companies/yield_tier'
  const off = { companies: { custom: false } }
  expect(notesOn(compare(config, target, { objects: off }), yieldTier)).toEqual([include('yield_tier')])
  // include brings it into the scope, and the project's own scope has custom on: the pull command it prints works.
  const included = { companies: { custom: false, include: ['yield_tier'] } }
  expect(notesOn(compare(config, target, { objects: included }), yieldTier)).toEqual([kept])
  expect(notesOn(compare(config, target, { objects: inited.config.objects }), yieldTier)).toEqual([kept])
  // Without a project there is no scope to go by, so the pull command stays.
  expect(notesOn(compare(config, target), yieldTier)).toEqual([kept])
  const old = snapshot(target, '.kalup/snapshots/sandbox/a.json', '2026-09-01T10:00:00.000Z')
  const fromSnapshot = notesOn(compare(config, old, { objects: off }), yieldTier)
  expect(fromSnapshot).toEqual([include('yield_tier')])
  expect(fromSnapshot).toMatchInlineSnapshot(`
    [
      "kept; the snapshot shows the portal as it was, and no pull refreshes it: it is outside the pull scope of companies; add 'yield_tier' to objects.companies.include in kalup.config.ts to take the portal side with pull",
    ]
  `)
  // A managed property is never HubSpot-defined, so a snapshot with custom on keeps the pull command.
  expect(notesOn(compare(config, old, { objects: inited.config.objects }), yieldTier)).toEqual([kept])
})

test('a HubSpot-defined property is outside the pull scope unless include names it: a read says which it is, a snapshot cannot', async () => {
  // Config names lifecyclestage as a reference, so both reads capture it; the second portal has one more option.
  const loaded = withResources({ 'property:companies/lifecyclestage': { type: 'property', managed: false } })
  const stages = [
    { label: 'Subscriber', value: 'subscriber', displayOrder: 0, hidden: false },
    { label: 'Lead', value: 'lead', displayOrder: 1, hidden: false },
    { label: 'Customer', value: 'customer', displayOrder: 2, hidden: false },
  ]
  const a = await observe({ loaded })
  const b = await observe({
    loaded,
    bodies: withOptions(orchard(), 'lifecyclestage', [
      ...stages,
      { label: 'Evangelist', value: 'evangelist', displayOrder: 3, hidden: false },
    ]),
  })
  expect(b.meta?.['property:companies/lifecyclestage']?.hubspotDefined).toBe(true)
  const address = 'property:companies/lifecyclestage'
  const pull = expect.stringContaining(`kalup pull --target sandbox --only ${address}`)
  expect(notesOn(compare(a, b, { objects: loaded.config.objects }), address)).toEqual([include('lifecyclestage')])
  const included = { ...loaded.config.objects, companies: { include: ['lifecyclestage'] } }
  expect(notesOn(compare(a, b, { objects: included }), address)).toEqual([pull])
  // A snapshot keeps no meta: with custom on, a reference include does not name gets include, never a pull command.
  const old = snapshot(b, '.kalup/snapshots/sandbox/a.json', '2026-09-01T10:00:00.000Z')
  const unsure = notesOn(compare(a, old, { objects: loaded.config.objects }), address)
  expect(unsure).toEqual([include('lifecyclestage')])
  expect(unsure).toMatchInlineSnapshot(`
    [
      "kept; the snapshot shows the portal as it was, and it may be outside the pull scope of companies, since a snapshot does not record whether HubSpot defines it; add 'lifecyclestage' to objects.companies.include in kalup.config.ts to take the portal side with pull",
    ]
  `)
  expect(notesOn(compare(a, old, { objects: { companies: { custom: false } } }), address)).toEqual([
    include('lifecyclestage'),
  ])
  expect(notesOn(compare(a, old, { objects: included }), address)).toEqual([pull])
})

test('unmanaged: what only the portal holds is listed and counted in either direction, never a difference', async () => {
  const target = await observe()
  const backward = compare(target, config)
  expect(backward).toMatchObject({
    complete: true,
    counts: { equal: 16, differs: 0, onlyA: 0, onlyB: 0, unmanaged: 3, unknown: 0, excluded: 0 },
    differences: unmanaged,
  })
  expect(compareOutcome(backward, target, config, true)).toEqual({ exitCode: 0, issues: [] })
})

test('a skip override is excluded with its reason, and excluded is not a difference', async () => {
  const target = await observe({
    overrides: { 'property:companies/plot_total': { skip: true }, 'object:harvest': { skip: true } },
  })
  const comparison = compare(config, target)
  const skipped = expect.stringContaining('leaves out object:harvest')
  expect(comparison.differences).toEqual([
    { address: 'group:companies/companyinformation', status: 'unmanaged' },
    { address: 'group:harvest/harvest_details', status: 'excluded', reason: skipped },
    { address: 'object:harvest', status: 'excluded', reason: skipped },
    { address: 'property:companies/plot_shape', status: 'unmanaged' },
    {
      address: 'property:companies/plot_total',
      status: 'excluded',
      reason: expect.stringContaining('skip override'),
    },
    { address: 'property:harvest/batch_code', status: 'excluded', reason: skipped },
    { address: 'property:harvest/orchard_ref', status: 'excluded', reason: skipped },
    { address: 'property:harvest/picked_on', status: 'excluded', reason: skipped },
    { address: 'property:harvest/weight_kg', status: 'excluded', reason: skipped },
  ])
  expect(comparison).toMatchObject({ complete: true, counts: { equal: 9, excluded: 7, unmanaged: 2 } })
  expect(compareOutcome(comparison, config, target, true)).toEqual({ exitCode: 0, issues: [] })
})

test('a property outside the read scope of a side is excluded there', async () => {
  const target = await observe()
  const loaded = withResources({ 'property:companies/domain': { type: 'property', managed: false } })
  expect(compare(configObservation(loaded), target).differences).toContainEqual({
    address: 'property:companies/domain',
    status: 'excluded',
    reason: 'outside the read scope of target sandbox',
  })
})

test('a config property in a portal group no address can hold is unknown, never excluded: compare is incomplete', async () => {
  const bodies = edit(orchard(), routes.companies, (p) =>
    p.name === 'plot_total' ? { ...p, groupName: 'odd group' } : p,
  )
  edit(bodies, routes.companyGroups, (g) => (g.name === 'plots' ? [g, { name: 'odd group', label: 'Odd' }] : g))
  const target = await observe({ bodies })
  const reason = expect.stringContaining('holds whitespace')
  const unknown = { address: 'property:companies/plot_total', status: 'unknown', reason }
  const comparison = compare(config, target)
  expect(comparison.differences).toEqual([...unmanaged, unknown])
  const outcome = compareOutcome(comparison, config, target, true)
  expect(outcome).toMatchObject({ exitCode: 1, issues: [{ code: 'E_INCOMPLETE' }] })
  expect(outcome.issues).toMatchInlineSnapshot(`
    [
      {
        "code": "E_INCOMPLETE",
        "fix": "rename the group of property:companies/plot_total in HubSpot to a name without spaces, then read the portal again",
        "message": "compare is incomplete: property:companies/plot_total: target sandbox could not capture it: its group's name in the portal holds whitespace. Nothing there was compared.",
      },
    ]
  `)
  // Two reads that both leave it out never prove it equal either: the reason names each side.
  expect(compare(target, target)).toMatchObject({
    complete: false,
    differences: [{ ...unknown, reason: expect.stringMatching(bothSides) }],
  })
})

test('a name override: the portal resource it names is compared at the local address', async () => {
  const bodies = edit(orchard(), routes.companies, (p) => (p.name === 'plot_tags' ? { ...p, name: 'plot_labels' } : p))
  const renamed = await observe({ bodies, overrides: { 'property:companies/plot_tags': { name: 'plot_labels' } } })
  expect(compare(config, renamed).differences).toEqual(unmanaged)
  // Without the override the same portal holds plot_labels, which config does not name, and no plot_tags.
  expect(compare(config, await observe({ bodies })).differences).toEqual([
    { address: 'group:companies/companyinformation', status: 'unmanaged' },
    { address: 'group:harvest/harvestinformation', status: 'unmanaged' },
    { address: 'property:companies/plot_labels', status: 'unmanaged' },
    { address: 'property:companies/plot_shape', status: 'unmanaged' },
    { address: 'property:companies/plot_tags', status: 'only-a' },
  ])
})

test('a scope failure: what could not be read is unknown, the comparison incomplete and the exit 1', async () => {
  const bodies = edit(orchard(), routes.harvest, (p) => (p.name === 'weight_kg' ? [] : p))
  const target = await observe({ bodies, refused: [routes.companies] })
  const comparison = compare(config, target)
  const unknown = comparison.differences.filter((d) => d.status === 'unknown')
  expect(unknown.map((d) => d.address)).toEqual([
    'group:companies/orchard',
    'group:companies/plots',
    'property:companies/irrigation_notes',
    'property:companies/plot_count',
    'property:companies/plot_tags',
    'property:companies/plot_total',
    'property:companies/pruned',
    'property:companies/row_meta',
    'property:companies/soil_ph',
    'property:companies/yield_tier',
  ])
  expect(unknown.every((d) => d.reason?.includes('lacks crm.schemas.companies.read'))).toBe(true)
  expect(comparison).toMatchObject({ complete: false, counts: { unknown: 10, onlyA: 1 } })
  // Incomplete wins over differences: never 0 or 2.
  const outcome = compareOutcome(comparison, config, target, true)
  expect(outcome).toMatchObject({ exitCode: 1, issues: [{ code: 'E_INCOMPLETE' }] })
  expect(outcome.issues[0]?.fix).toContain('crm.schemas.companies.read')
  expect(outcome.issues).toMatchInlineSnapshot(`
    [
      {
        "code": "E_INCOMPLETE",
        "fix": "add the scope crm.schemas.companies.read to the read key, then read the portal again",
        "message": "compare is incomplete: companies on target sandbox, whose key lacks crm.schemas.companies.read. Nothing there was compared.",
      },
    ]
  `)
})

test('an unreadable object with no config resources under it still leaves the comparison incomplete', async () => {
  const loaded = { ...inited, config: { ...inited.config, objects: { ...inited.config.objects, deals: {} } } }
  const target = await observe({ loaded, refused: [routes.deals] })
  const comparison = compare(configObservation(loaded), target)
  expect(comparison).toMatchObject({ complete: false, counts: { unknown: 0 }, differences: unmanaged })
  const outcome = compareOutcome(comparison, configObservation(loaded), target, false)
  expect(outcome).toMatchObject({ exitCode: 1, issues: [{ code: 'E_INCOMPLETE' }] })
  expect(outcome.issues[0]?.fix).toContain('crm.schemas.deals.read')
})

test('a snapshot that never read an object config names: unknown there, and the fix asks for a new snapshot', async () => {
  const target = await observe()
  const coverage = target.coverage as Coverage
  const { harvest: _harvest, ...objects } = coverage.objects
  const resources = Object.fromEntries(Object.entries(target.resources).filter(([a]) => !a.includes(':harvest')))
  const old = snapshot(
    { ...target, resources, coverage: { ...coverage, objects } },
    'old.json',
    '2026-06-01T10:00:00.000Z',
  )
  const comparison = compare(config, old)
  const unknown = comparison.differences.filter((d) => d.status === 'unknown')
  expect(unknown.map((d) => d.address)).toEqual([
    'group:harvest/harvest_details',
    'object:harvest',
    'property:harvest/batch_code',
    'property:harvest/orchard_ref',
    'property:harvest/picked_on',
    'property:harvest/weight_kg',
  ])
  expect(unknown.every((d) => d.reason === 'snapshot old.json did not read harvest')).toBe(true)
  const outcome = compareOutcome(comparison, config, old, false)
  expect(outcome).toMatchObject({ exitCode: 1, issues: [{ code: 'E_INCOMPLETE' }] })
  expect(outcome.issues[0]?.fix).toContain('take a new snapshot')
  expect(outcome.issues).toMatchInlineSnapshot(`
    [
      {
        "code": "E_INCOMPLETE",
        "fix": "add harvest to objects in kalup.config.ts if it is not there, then take a new snapshot",
        "message": "compare is incomplete: harvest, which snapshot old.json did not read. Nothing there was compared.",
      },
    ]
  `)
})

test('a target that never read an object config names: the fix adds it to objects, since a snapshot cannot help', async () => {
  const loaded = withResources({
    'group:deals/terms': { type: 'group', managed: true, definition: { label: 'Terms' } },
    'property:deals/term_days': {
      type: 'property',
      managed: true,
      definition: { label: 'Term days', group: { $ref: 'group:deals/terms' }, type: 'number', fieldType: 'number' },
      lifecycle: { options: 'additive' },
    },
  })
  const target = await observe({ loaded })
  const comparison = compare(configObservation(loaded), target)
  expect(comparison.differences.filter((d) => d.status === 'unknown')).toEqual([
    { address: 'group:deals/terms', status: 'unknown', reason: 'target sandbox did not read deals' },
    { address: 'property:deals/term_days', status: 'unknown', reason: 'target sandbox did not read deals' },
  ])
  const outcome = compareOutcome(comparison, configObservation(loaded), target, false)
  expect(outcome).toMatchObject({ exitCode: 1, issues: [{ code: 'E_INCOMPLETE' }] })
  expect(outcome.issues).toMatchInlineSnapshot(`
    [
      {
        "code": "E_INCOMPLETE",
        "fix": "add deals to objects in kalup.config.ts",
        "message": "compare is incomplete: deals, which target sandbox did not read. Nothing there was compared.",
      },
    ]
  `)
})

test('an object key named like an Object.prototype member that one side never read leaves compare incomplete', async () => {
  const target = await observe()
  const coverage = target.coverage as Coverage
  for (const key of ['constructor', 'toString']) {
    const named: Observation = {
      ...target,
      coverage: { ...coverage, objects: { ...coverage.objects, [key]: { status: 'absent' } } },
    }
    const comparison = compare(named, target)
    expect(comparison.complete, key).toBe(false)
    expect(compareOutcome(comparison, named, target, true).issues, key).toEqual([
      {
        code: 'E_INCOMPLETE',
        message: expect.stringContaining(`${key}, which target sandbox did not read`),
        fix: expect.stringContaining(`add ${key} to objects`),
      },
    ])
  }
})

test('E_INCOMPLETE strips control characters from the addresses it names', async () => {
  const hostile = `pipeline:companies/p${String.fromCodePoint(0x1b)}]0;pwned${String.fromCodePoint(0x07)}${String.fromCodePoint(0x9b)}2J`
  const loaded = withResources({ [hostile]: { type: 'pipeline', managed: false } })
  const target = await observe()
  const comparison = compare(configObservation(loaded), target)
  const [issue] = compareOutcome(comparison, configObservation(loaded), target, false).issues
  expect(issue?.message).toContain('pipeline:companies/p]0;pwned2J:')
  expect([...String(issue?.message)].some((c) => isControl(c.codePointAt(0) ?? 0))).toBe(false)
  // The data keeps the address exact.
  expect(comparison.differences.map((d) => d.address)).toContain(hostile)
})

test('a portal resource in a shadowed group, or a schema naming a shadowed property, never compares equal', async () => {
  const group = compare(config, await observe({ overrides: { 'group:companies/orchard': { name: 'orchard_v2' } } }))
  expect(group.differences).toContainEqual({ address: 'group:companies/orchard', status: 'only-a' })
  expect(group.differences).toContainEqual({
    address: 'property:companies/plot_total',
    status: 'differs',
    held: [
      {
        unit: 'group',
        class: 'diverged',
        a: { $ref: 'group:companies/orchard' },
        b: { $ref: 'group:companies/shadowed:orchard' },
      },
    ],
  })

  const property = compare(
    config,
    await observe({ overrides: { 'property:harvest/batch_code': { name: 'batch_code_v2' } } }),
  )
  expect(property.differences).toContainEqual({ address: 'property:harvest/batch_code', status: 'only-a' })
  expect(property.differences).toContainEqual({
    address: 'object:harvest',
    status: 'differs',
    held: [
      { unit: 'primaryDisplayProperty', class: 'diverged', a: 'batch_code', b: 'shadowed:batch_code' },
      { unit: 'requiredProperties', class: 'diverged', a: ['batch_code'], b: ['shadowed:batch_code'] },
      {
        unit: 'searchableProperties',
        class: 'diverged',
        a: ['batch_code', 'orchard_ref'],
        b: ['shadowed:batch_code', 'orchard_ref'],
      },
    ],
  })
})

test('a kept option on a resource that names a shadowed portal name: the note names the override, since pull writes nothing', async () => {
  const bodies = withOptions(orchard(), 'yield_tier', [
    ...yieldOptions,
    { label: 'Mid', value: 'mid', displayOrder: 2, hidden: false },
  ])
  const target = await observe({ bodies, overrides: { 'group:companies/orchard': { name: 'orchard_v2' } } })
  const mid = { value: 'mid', label: 'Mid', hidden: false, description: '' }
  const noPull = expect.stringContaining('remove that override under targets.sandbox.overrides')
  const held = [
    {
      unit: 'group',
      class: 'diverged',
      a: { $ref: 'group:companies/orchard' },
      b: { $ref: 'group:companies/shadowed:orchard' },
    },
  ]
  expect(compare(config, target).differences).toContainEqual({
    address: 'property:companies/yield_tier',
    status: 'differs',
    held,
    notes: [{ unit: 'options[mid]', b: mid, note: noPull }],
  })
  const old = snapshot(target, '.kalup/snapshots/sandbox/a.json', '2026-09-01T10:00:00.000Z')
  expect(compare(config, old).differences).toContainEqual({
    address: 'property:companies/yield_tier',
    status: 'differs',
    held,
    notes: [{ unit: 'options[mid]', b: mid, note: noPull }],
  })
})

test('a schema HubSpot returned without a label compares as unsupported on the fields it has', async () => {
  const bodies = edit(orchard(), routes.schemas, (s) =>
    s.name === 'harvest' ? { ...s, labels: { plural: 'Harvests' } } : s,
  )
  expect(compare(config, await observe({ bodies })).differences).toContainEqual({
    address: 'object:harvest',
    status: 'differs',
    held: [
      { unit: 'labels', class: 'diverged', a: { singular: 'Harvest', plural: 'Harvests' }, b: { plural: 'Harvests' } },
    ],
  })
})

test('an unsupported property compares with a present one on the fields both carry', async () => {
  // Config declares plot_shape as text; the portal's is object_coordinates, which no builder carries.
  const plotShape: IRResource = {
    type: 'property',
    managed: true,
    definition: { label: 'Plot shape', group: { $ref: 'group:companies/orchard' }, type: 'string', fieldType: 'text' },
    lifecycle: { options: 'additive' },
  }
  const loaded = withResources({ 'property:companies/plot_shape': plotShape })
  const target = await observe({ loaded })
  const differs = {
    address: 'property:companies/plot_shape',
    status: 'differs',
    held: [{ unit: 'type', class: 'diverged', a: 'string', b: 'object_coordinates' }],
  }
  expect(compare(configObservation(loaded), target).differences).toContainEqual(differs)

  // Between observations: hasUniqueValue and formField are not recorded for an unsupported property, so not compared.
  const coverage = target.coverage as Coverage
  const { unsupported: _unsupported, ...companies } = coverage.objects.companies as ObjectCoverage
  const present: Observation = {
    ...target,
    resources: {
      ...target.resources,
      'property:companies/plot_shape': { ...plotShape, definition: { ...plotShape.definition, hasUniqueValue: true } },
    },
    coverage: { ...coverage, objects: { ...coverage.objects, companies } },
  }
  expect(compare(present, target).differences).toEqual([differs])
  expect(compare(target, present).differences).toEqual([
    { ...differs, held: [{ unit: 'type', class: 'diverged', a: 'object_coordinates', b: 'string' }] },
  ])
})

test('config managing a property the portal holds as a reference differs in the unit managed alone', async () => {
  const loaded = withResources({
    'property:companies/name': {
      type: 'property',
      managed: true,
      definition: {
        label: 'Name',
        group: { $ref: 'group:companies/companyinformation' },
        type: 'string',
        fieldType: 'text',
      },
      lifecycle: { options: 'additive' },
    },
    // A reference in config owns nothing: present on both sides is equal, whatever the portal holds.
    'property:companies/plot_total': { type: 'property', managed: false },
  })
  const comparison = compare(configObservation(loaded), await observe({ loaded }))
  expect(comparison.differences).toEqual([
    ...unmanaged.slice(0, 2),
    {
      address: 'property:companies/name',
      status: 'differs',
      held: [{ unit: 'managed', class: 'diverged', a: true, b: false }],
    },
    unmanaged[2],
  ])
  expect(comparison.counts.equal).toBe(16)
})

test('a lookup override on a target side is unknown there, never compared against config', async () => {
  const target = await observe()
  const comparison = compare(config, target, { overridden: { b: ['property:companies/plot_total'] } })
  const reason = expect.stringContaining('lookup override')
  expect(comparison.differences).toContainEqual({ address: 'property:companies/plot_total', status: 'unknown', reason })
  expect(comparison.complete).toBe(false)
  const outcome = compareOutcome(comparison, config, target, true)
  expect(outcome).toEqual({ exitCode: 1, issues: [{ code: 'E_INCOMPLETE', message: expect.any(String) }] })
  expect(outcome.issues).toMatchInlineSnapshot(`
    [
      {
        "code": "E_INCOMPLETE",
        "message": "compare is incomplete: property:companies/plot_total: target sandbox has a lookup override for it; this version manages no lookup resources. Nothing there was compared.",
      },
    ]
  `)
})

test('unknown on one side wins over excluded on the other; a skip wins over a lookup override on its own side', async () => {
  const full = await observe()
  const skipped = await observe({ overrides: { 'property:companies/plot_total': { skip: true } } })
  const plotTotal = ['property:companies/plot_total']
  expect(compare(full, skipped, { overridden: { a: plotTotal } }).differences).toEqual([
    {
      address: 'property:companies/plot_total',
      status: 'unknown',
      reason: expect.stringContaining('lookup override'),
    },
  ])
  const comparison = compare(config, skipped, { overridden: { b: plotTotal } })
  expect(comparison.differences).toContainEqual({
    address: 'property:companies/plot_total',
    status: 'excluded',
    reason: expect.stringContaining('skip override'),
  })
  expect(comparison.complete).toBe(true)
})

test('fields and options in ignoreChanges belong to the portal once the resource exists, in either direction', async () => {
  let bodies = edit(orchard(), routes.companies, (p) =>
    p.name === 'yield_tier' ? { ...p, label: 'Yield grade', description: 'Edited in HubSpot' } : p,
  )
  bodies = withOptions(
    bodies,
    'yield_tier',
    yieldOptions.filter((o) => o.value !== 'HIGH'),
  )
  const target = await observe({ bodies })
  const yieldTier = configResource('property:companies/yield_tier')
  const loaded = withResources({
    'property:companies/yield_tier': {
      ...yieldTier,
      lifecycle: { options: 'additive', ignoreChanges: ['description', 'options'] },
    },
  })
  const held = [{ unit: 'label', class: 'diverged', a: 'Yield band', b: 'Yield grade' }]
  expect(compare(configObservation(loaded), target).differences).toContainEqual({
    address: 'property:companies/yield_tier',
    status: 'differs',
    held,
  })
  expect(compare(target, configObservation(loaded)).differences).toContainEqual({
    address: 'property:companies/yield_tier',
    status: 'differs',
    held: [{ unit: 'label', class: 'diverged', a: 'Yield grade', b: 'Yield band' }],
  })
})

test('config as side b: only the fields config states are compared, the same fields as in the other direction', async () => {
  let bodies = edit(orchard(), routes.companies, (p) =>
    p.name === 'irrigation_notes' ? { ...p, label: 'Watering notes', description: 'Kept by the field team' } : p,
  )
  // low gains a description config does not state; HIGH is gone; mid is new.
  bodies = withOptions(bodies, 'yield_tier', [
    { label: 'Peak', value: 'peak', displayOrder: -1, hidden: true },
    { label: 'Low', value: 'low', displayOrder: 0, hidden: false, description: 'Lowest band' },
    { label: 'Mid', value: 'mid', displayOrder: 2, hidden: false },
  ])
  const target = await observe({ bodies })
  const mid = { value: 'mid', label: 'Mid', hidden: false, description: '' }
  const high = { value: 'HIGH', label: 'High' }
  const differs = (comparison: ReturnType<typeof compare>) =>
    comparison.differences.filter((d) => d.status === 'differs')

  expect(differs(compare(target, config))).toEqual([
    {
      address: 'property:companies/irrigation_notes',
      status: 'differs',
      held: [{ unit: 'label', class: 'diverged', a: 'Watering notes', b: 'Irrigation notes' }],
    },
    {
      address: 'property:companies/yield_tier',
      status: 'differs',
      changes: [{ unit: 'options[mid]', class: 'add', op: 'add', before: null, after: mid }],
      // Config as b already holds the option: there is nothing to pull.
      notes: [{ unit: 'options[HIGH]', b: high, note: 'kept, since options are additive' }],
    },
  ])
  expect(differs(compare(config, target))).toEqual([
    {
      address: 'property:companies/irrigation_notes',
      status: 'differs',
      held: [{ unit: 'label', class: 'diverged', a: 'Irrigation notes', b: 'Watering notes' }],
    },
    {
      address: 'property:companies/yield_tier',
      status: 'differs',
      changes: [{ unit: 'options[HIGH]', class: 'add', op: 'add', before: null, after: high }],
      notes: [{ unit: 'options[mid]', b: mid, note: kept }],
    },
  ])
})

test('two snapshots of one target: every captured field compares, defaults filled, options always', async () => {
  const before = snapshot(await observe(), '.kalup/snapshots/sandbox/a.json', '2026-09-01T10:00:00.000Z')
  let bodies = edit(orchard(), routes.companyGroups, (g) => (g.name === 'plots' ? [g, { ...g, name: 'soil' }] : g))
  bodies = edit(bodies, routes.companies, (p) => {
    if (p.name === 'irrigation_notes') {
      return { ...p, formField: false }
    }
    return p.name === 'plot_count' ? { ...p, description: '' } : p
  })
  bodies = withOptions(bodies, 'yield_tier', [
    yieldOptions[0] as Item,
    { ...yieldOptions[1], description: 'Lowest band' },
    yieldOptions[2] as Item,
  ])
  const after = snapshot(await observe({ bodies }), '.kalup/snapshots/sandbox/b.json', '2026-09-20T10:00:00.000Z')
  const comparison = compare(before, after)
  expect(comparison).toEqual({
    a: before.side,
    b: after.side,
    complete: true,
    counts: { equal: 16, differs: 3, onlyA: 0, onlyB: 1, unmanaged: 0, unknown: 0, excluded: 0 },
    differences: [
      { address: 'group:companies/soil', status: 'only-b' },
      {
        address: 'property:companies/irrigation_notes',
        status: 'differs',
        held: [{ unit: 'formField', class: 'diverged', a: true, b: false }],
      },
      {
        address: 'property:companies/plot_count',
        status: 'differs',
        held: [{ unit: 'description', class: 'diverged', a: 'Number of plots on the estate', b: '' }],
      },
      {
        address: 'property:companies/yield_tier',
        status: 'differs',
        held: [{ unit: 'options[low].description', class: 'diverged', a: '', b: 'Lowest band' }],
      },
    ],
  })
  expect(compareOutcome(comparison, before, after, true)).toEqual({ exitCode: 2, issues: [] })
  expect(compareText(comparison)).toMatchInlineSnapshot(`
    "a: snapshot .kalup/snapshots/sandbox/a.json of target sandbox, portal 1111111, observed 2026-09-01T10:00:00.000Z
    b: snapshot .kalup/snapshots/sandbox/b.json of target sandbox, portal 1111111, observed 2026-09-20T10:00:00.000Z
    16 equal, 3 differ, 0 only in a, 1 only in b, 0 unmanaged, 0 unknown, 0 skipped
    only in b: group:companies/soil
    differs: property:companies/irrigation_notes
      held formField: a true, b false
    differs: property:companies/plot_count
      held description: a "Number of plots on the estate", b ""
    differs: property:companies/yield_tier
      held options[low].description: a "", b "Lowest band"
    "
  `)
})

test('the text lists changes, notes, unknown and excluded, and strips control characters from portal strings', async () => {
  const hostile = `Orchard ${String.fromCodePoint(0x1b)}[31mred${String.fromCodePoint(0x9b)}2J${String.fromCodePoint(0x20_28)}`
  let bodies = edit(orchard(), routes.companyGroups, (g) => (g.name === 'orchard' ? { ...g, label: hostile } : g))
  bodies = withOptions(bodies, 'yield_tier', [
    ...yieldOptions.filter((o) => o.value !== 'HIGH'),
    { label: 'Mid', value: 'mid', displayOrder: 2, hidden: false },
  ])
  const target = await observe({ bodies, overrides: { 'property:companies/plot_total': { skip: true } } })
  const comparison = compare(config, target, { overridden: { b: ['property:companies/row_meta'] } })
  // The data keeps the portal string exact.
  expect(comparison.differences).toContainEqual({
    address: 'group:companies/orchard',
    status: 'differs',
    held: [{ unit: 'label', class: 'diverged', a: 'Orchard details', b: hostile }],
  })
  const text = compareText(comparison)
  expect([...text].some((c) => c !== '\n' && isControl(c.codePointAt(0) ?? 0))).toBe(false)
  expect(text).toMatchInlineSnapshot(`
    "a: config
    b: target sandbox, portal 1111111
    12 equal, 2 differ, 0 only in a, 0 only in b, 3 unmanaged, 1 unknown, 1 skipped
    unmanaged: group:companies/companyinformation
    differs: group:companies/orchard
      held label: a "Orchard details", b "Orchard \\u001b[31mred2J"
    unmanaged: group:harvest/harvestinformation
    unmanaged: property:companies/plot_shape
    excluded: property:companies/plot_total (a skip override on target sandbox leaves it out)
    unknown: property:companies/row_meta (target sandbox has a lookup override for it; this version manages no lookup resources)
    differs: property:companies/yield_tier
      add options[HIGH]: null -> {"value":"HIGH","label":"High"}
      kept options[mid]: {"value":"mid","label":"Mid","hidden":false,"description":""}
    "
  `)
})

test.each([
  ['config', ['sandbox'], 'config'],
  ['sandbox', ['sandbox'], 'target'],
  ['production', ['sandbox'], 'snapshot'],
  ['sandbox', [], 'snapshot'],
  ['.kalup/snapshots/sandbox/20260923T101530123Z.json', ['sandbox'], 'snapshot'],
])('resolveSide(%j, %j) is %s', (arg, targets, kind) => {
  expect(resolveSide(arg, targets)).toBe(kind)
})

test("a config side compared with a target is that target's effective config; alone it is the shared one", async () => {
  const address = 'property:companies/irrigation_notes'
  const sandbox = inited.ir.targets.sandbox as NonNullable<typeof inited.ir.targets.sandbox>
  const overrides = { [address]: { definition: { label: 'Watering notes' } } }
  const overridden: Loaded = {
    ...inited,
    ir: { ...inited.ir, targets: { ...inited.ir.targets, sandbox: { ...sandbox, overrides } } },
  }
  const bodies = edit(orchard(), routes.companies, (p) =>
    p.name === 'irrigation_notes' ? { ...p, label: 'Watering notes' } : p,
  )
  const target = await observe({ bodies })
  const at = (comparison: ReturnType<typeof compare>) => comparison.differences.filter((d) => d.address === address)
  expect(at(compare(configObservation(overridden, 'sandbox'), target))).toEqual([])
  expect(at(compare(target, configObservation(overridden, 'sandbox')))).toEqual([])
  expect(at(compare(configObservation(overridden), target))).toEqual([
    {
      address,
      status: 'differs',
      held: [{ unit: 'label', class: 'diverged', a: 'Irrigation notes', b: 'Watering notes' }],
    },
  ])
  expect(configObservation(overridden).resources[address]?.definition?.label).toBe('Irrigation notes')
})
