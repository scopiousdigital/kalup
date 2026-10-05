import { expect, test } from 'vitest'
import type { Observation } from '../../src/engine/observe.js'
import { keptByRead, schemaNames, takeoverCandidates, takeoverRefusal } from '../../src/engine/takeover.js'
import type { ConfigFile } from '../../src/grammar/types.js'
import type { IR, IRResource } from '../../src/ir/types.js'

const property = (groupName: string, managed = true): IRResource => ({
  type: 'property',
  managed,
  definition: { label: 'x', group: { $ref: `group:companies/${groupName}` }, type: 'string', fieldType: 'text' },
})
const group: IRResource = { type: 'group', managed: true, definition: { label: 'x' } }

const config = (fields: Partial<ConfigFile> = {}): ConfigFile => ({
  imports: [],
  mode: 'takeover',
  objects: { companies: {} },
  targets: { sandbox: { portalId: 1_111_111 } },
  ...fields,
})

const ir = (fields: Partial<IR> = {}): IR => ({
  irVersion: 1,
  project: 'orchard',
  generator: { name: 'kalup', version: '0.0.0', frontend: 'ts' },
  resources: { 'group:companies/orchard': group, 'property:companies/soil_ph': property('orchard') },
  targets: {},
  tombstones: {},
  ...fields,
})

// The portal: orchard (config's) with soil_ph (config's), soil_notes and zi_score; harvest_log holding only
// log_entry; companyinformation holding HubSpot's name and a custom rootstock; the calculated yield_double.
function observation(complete = true): Observation {
  return {
    side: { kind: 'target', name: 'sandbox', portalId: 1_111_111 },
    resources: {
      'group:companies/companyinformation': group,
      'group:companies/harvest_log': group,
      'group:companies/orchard': group,
      'property:companies/log_entry': property('harvest_log'),
      'property:companies/name': property('companyinformation', false),
      'property:companies/rootstock': property('companyinformation'),
      'property:companies/soil_notes': property('orchard'),
      'property:companies/soil_ph': property('orchard'),
      'property:companies/yield_double': property('orchard', false),
      'property:companies/zi_score': property('orchard'),
    },
    meta: { 'property:companies/name': { hubspotDefined: true } as never },
    members: {
      companies: {
        companyinformation: ['name', 'rootstock'],
        harvest_log: ['log_entry'],
        orchard: ['soil_notes', 'soil_ph', 'yield_double', 'zi_score'],
      },
    },
    coverage: {
      complete,
      objects: { companies: { status: 'read' } },
      otherObjects: [],
      notCaptured: { property: [], group: [], object: [] },
    },
  }
}

test('takeover takes the custom properties config lacks, and a group only once every property it holds goes', () => {
  expect(takeoverCandidates({ config: config(), ir: ir() }, observation(), 'sandbox')).toEqual({
    properties: [
      'property:companies/log_entry',
      'property:companies/rootstock',
      'property:companies/soil_notes',
      'property:companies/zi_score',
    ],
    groups: ['group:companies/harvest_log'],
  })
})

test.each(['release', 'destroy'] as const)(
  'takeover takes nothing on a custom object a %s tombstone covers',
  (action) => {
    // kalup rm object:crate took its group and property out of config; under takeover they would otherwise go.
    const crate: Observation = {
      ...observation(),
      resources: {
        'group:crate/crate_details': group,
        'property:crate/crate_code': {
          ...property('crate_details'),
          definition: { label: 'x', group: { $ref: 'group:crate/crate_details' }, type: 'string', fieldType: 'text' },
        },
      },
      members: { crate: { crate_details: ['crate_code'] } },
      coverage: {
        ...(observation().coverage as NonNullable<Observation['coverage']>),
        objects: { crate: { status: 'read' } },
      },
    }
    const loaded = {
      config: config({ objects: { crate: {} } }),
      ir: ir({ resources: {}, tombstones: { 'object:crate': { action } } }),
    }
    expect(takeoverCandidates(loaded, crate, 'sandbox')).toEqual({ properties: [], groups: [] })
    expect(takeoverRefusal(loaded, 'sandbox', 'property:crate/crate_code')).toBe(
      'removed.ts names object:crate, which takes property:crate/crate_code along',
    )
  },
)

test('exclude, a tombstone, a name override and addon each keep a resource out of takeover', () => {
  const kept = config({ objects: { companies: { exclude: ['zi_*', 'log_entry'] } } })
  const tombstones = { 'property:companies/rootstock': { action: 'release' as const } }
  expect(takeoverCandidates({ config: kept, ir: ir({ tombstones }) }, observation(), 'sandbox')).toEqual({
    properties: ['property:companies/soil_notes'],
    groups: [],
  })
  const addon = config({ targets: { sandbox: { portalId: 1, objects: { companies: { mode: 'addon' } } } } })
  expect(takeoverCandidates({ config: addon, ir: ir() }, observation(), 'sandbox')).toEqual({
    properties: [],
    groups: [],
  })
})

test('the properties the files define never widen takeover: custom off still takes nothing the files lack', () => {
  // soil_ph is in the files and so in the pull scope; the scope for the rest stays custom off.
  const off = config({ objects: { companies: { custom: false } } })
  expect(takeoverCandidates({ config: off, ir: ir() }, observation(), 'sandbox')).toEqual({
    properties: [],
    groups: [],
  })
  // With include, only the named property the files lack is taken: the files' own never are.
  const named = config({ objects: { companies: { custom: false, include: ['soil_notes', 'soil_ph'] } } })
  expect(takeoverCandidates({ config: named, ir: ir() }, observation(), 'sandbox')).toEqual({
    properties: ['property:companies/soil_notes'],
    groups: [],
  })
})

test.each([
  ['in config', config(), 'property:companies/soil_ph', 'property:companies/soil_ph is in config'],
  [
    'addon',
    config({ mode: 'addon' }),
    'property:companies/soil_notes',
    'the mode of companies on target sandbox is addon',
  ],
  [
    'excluded',
    config({ objects: { companies: { exclude: ['soil_*'] } } }),
    'property:companies/soil_notes',
    'objects.companies.exclude names soil_notes',
  ],
  [
    'custom off',
    config({ objects: { companies: { custom: false } } }),
    'property:companies/soil_notes',
    'soil_notes is outside the pull scope of companies',
  ],
  [
    'read through a name override',
    config({
      targets: { sandbox: { portalId: 1, overrides: { 'property:companies/soil_ph': { name: 'soil_notes' } } } },
    }),
    'property:companies/soil_notes',
    'the name override of property:companies/soil_ph reads soil_notes',
  ],
  [
    'a skipped property',
    config({ targets: { sandbox: { portalId: 1, overrides: { 'property:companies/soil_notes': { skip: true } } } } }),
    'property:companies/soil_notes',
    'a skip override leaves property:companies/soil_notes out on target sandbox',
  ],
  [
    'a skipped object',
    config({ targets: { sandbox: { portalId: 1, overrides: { 'object:companies': { skip: true } } } } }),
    'property:companies/soil_notes',
    'a skip override leaves companies out on target sandbox',
  ],
  [
    'a custom object, its name read whole',
    config({ objects: { crate: { mode: 'takeover' } } }),
    'object:crate',
    'takeover never archives a custom object',
  ],
])('takeoverRefusal: %s', (_name, settings, address, why) => {
  expect(takeoverRefusal({ config: settings, ir: ir() }, 'sandbox', address)).toBe(why)
})

test('custom off still lets takeover archive a custom property include names', () => {
  const named = config({ objects: { companies: { custom: false, include: ['soil_notes'] } } })
  expect(takeoverRefusal({ config: named, ir: ir() }, 'sandbox', 'property:companies/soil_notes')).toBeUndefined()
})

test('an incomplete observation still lists the candidates: plan blocks them, so a reviewer sees what waits', () => {
  expect(takeoverCandidates({ config: config(), ir: ir() }, observation(false), 'sandbox').properties).toHaveLength(4)
})

test('what a read found keeps a property from takeover: a skipped group, or a schema that names it', () => {
  const skipped = { 'group:companies/harvest_log': { skip: true as const } }
  const logEntry = 'property:companies/log_entry'
  expect(keptByRead(skipped, 'sandbox', logEntry, property('harvest_log'), [])).toBe(
    'HubSpot holds it in group:companies/harvest_log, which a skip override leaves out on target sandbox',
  )
  expect(keptByRead({}, 'sandbox', logEntry, property('harvest_log'), ['log_entry'])).toBe(
    'the companies schema names log_entry',
  )
  expect(keptByRead({}, 'sandbox', logEntry, property('harvest_log'), [])).toBeUndefined()
  expect(
    schemaNames({ primaryDisplayProperty: 'b', requiredProperties: ['a', 'b'], labels: { singular: 'x' } }),
  ).toEqual(['a', 'b'])
  const candidates = takeoverCandidates(
    { config: config({ targets: { sandbox: { portalId: 1, overrides: skipped } } }), ir: ir() },
    observation(),
    'sandbox',
  )
  expect(candidates.properties).not.toContain(logEntry)
  expect(candidates.groups).toEqual([])
})
