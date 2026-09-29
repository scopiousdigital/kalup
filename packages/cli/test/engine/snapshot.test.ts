import { type Override, stableStringify, type UnsupportedProperty, validateIR } from '@kalup/core'
import { expect, test } from 'vitest'
import { project } from '../../src/commands/testing.js'
import { compare } from '../../src/engine/compare.js'
import { configObservation, type Observation, observeTarget, statusOf } from '../../src/engine/observe.js'
import {
  fromSnapshot,
  incompleteIssues,
  parseSnapshot,
  type Snapshot,
  snapshotPath,
  snapshotText,
  toSnapshot,
} from '../../src/engine/snapshot.js'
import { createHttp, type Fetch } from '../../src/lib/http.js'
import { load } from '../../src/lib/load.js'
import { KalupError } from '../../src/lib/output.js'
import { fakeFetch, fixture, jsonResponse, portalBody, route } from '../../src/lib/testing.js'

// An incomplete snapshot with two gaps names both, and a fix for each.
const bothGaps = /harvest was not read, and property:companies\/plot_total is in a portal group/
const bothFixes = /crm\.schemas\.custom\.read .*rename the group of property:companies\/plot_total/

const rate = {
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}

const routes = {
  schemas: '/crm-object-schemas/2026-09/schemas',
  companies: '/crm/properties/2026-09/companies',
  companyGroups: '/crm/properties/2026-09/companies/groups',
  harvest: '/crm/properties/2026-09/2-4242001',
  harvestGroups: '/crm/properties/2026-09/2-4242001/groups',
}

type Bodies = Record<string, unknown>
type Item = Record<string, unknown>

// The pull fixture project read against the orchard portal, as in the observe tests.
const pulled = load(project('pull'))
const observedAt = '2026-09-23T10:15:30.123Z'
const meta = { project: 'orchard-crm', generator: { name: 'kalup', version: '0.3.0' }, observedAt }
const file = '.kalup/snapshots/sandbox/20260923T101530123Z.json'

function orchard(): Bodies {
  return {
    [routes.schemas]: fixture('api/orchard/schemas.json'),
    [routes.companies]: fixture('api/orchard/companies.properties.json'),
    [routes.companyGroups]: fixture('api/orchard/companies.groups.json'),
    [routes.harvest]: fixture('api/orchard/harvest.properties.json'),
    [routes.harvestGroups]: fixture('api/orchard/harvest.groups.json'),
  }
}

function edit(at: string, change: (item: Item) => Item | Item[]): Bodies {
  const bodies = orchard()
  const list = bodies[at] as { results: Item[] }
  bodies[at] = { results: list.results.flatMap(change) }
  return bodies
}

interface Read {
  bodies?: Bodies
  overrides?: Record<string, Override>
  refused?: string[]
}

async function observe({ bodies = orchard(), overrides, refused = [] }: Read = {}): Promise<Observation> {
  const fetch: Fetch = (url, init) => {
    const body = refused.includes(route(url))
      ? jsonResponse(403, fixture('errors/missing-scope.json'))
      : jsonResponse(200, portalBody(bodies, url), rate)
    return fakeFetch(body).fetch(url, init)
  }
  const http = createHttp({ key: 'kalup-test-secret-9f2c', fetch, warn: () => undefined })
  const { sandbox } = pulled.config.targets
  const loaded = overrides
    ? { ...pulled, config: { ...pulled.config, targets: { sandbox: { ...sandbox, overrides } } } }
    : pulled
  return (await observeTarget(http, loaded, 'sandbox')).observation
}

function thrown(run: () => unknown): KalupError {
  try {
    run()
  } catch (error) {
    if (error instanceof KalupError) {
      return error
    }
    throw error
  }
  throw new Error('expected a KalupError')
}

const unsafeJson = /[\u007f-\u009f\u2028\u2029]/u
const safeDir = /^[a-z0-9][a-z0-9_-]{0,63}$/
const deviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/
const notIr1 = /^the snapshot does not conform to ir\/1: resources\b/

const hostileLabel = `Orchard ${String.fromCodePoint(0x9b)}31m details${String.fromCodePoint(0x20_28)}`

test('a snapshot is an ir/1 document from the portal frontend: the captured resources and the observation block', async () => {
  const observation = await observe()
  const snapshot = toSnapshot(observation, meta)
  expect(snapshot).toEqual(fixture('snapshot/orchard.json'))
  expect(validateIR(snapshot)).toEqual([])
  expect(snapshot).toMatchObject({
    irVersion: 1,
    project: 'orchard-crm',
    generator: { name: 'kalup', version: '0.3.0', frontend: 'portal' },
    targets: {},
    tombstones: {},
  })
  expect(snapshot.resources).toStrictEqual(observation.resources)
  expect(snapshot.observation).toStrictEqual({
    target: { name: 'sandbox', portalId: 1_111_111 },
    observedAt,
    coverage: observation.coverage,
  })
  // Unsupported properties are in coverage only: no resource can carry them.
  expect(snapshot.resources['property:companies/plot_shape']).toBeUndefined()
  expect(snapshot.observation.coverage.objects.companies?.unsupported?.map((u) => u.name)).toEqual(['plot_shape'])
})

test('the config generator passed as it is still yields frontend portal', async () => {
  const snapshot = toSnapshot(await observe(), {
    project: pulled.ir.project,
    generator: pulled.ir.generator,
    observedAt,
  })
  expect(snapshot.generator).toEqual({ name: 'kalup', version: pulled.ir.generator.version, frontend: 'portal' })
})

test('only a target read becomes a snapshot', () => {
  expect(() => toSnapshot(configObservation(pulled), meta)).toThrow('only a read of a target')
})

test('a snapshot that would not read back is never returned: toSnapshot throws a plain Error, a bug', async () => {
  // A group address with a space breaks the ir/1 address pattern. The read never captures one.
  const observation = await observe()
  observation.resources['group:companies/two words'] = { type: 'group', managed: true, definition: { label: 'Two' } }
  let error: unknown
  try {
    toSnapshot(observation, meta)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(Error)
  expect(error).not.toBeInstanceOf(KalupError)
  expect((error as Error).message).toMatch(notIr1)
})

test('a read with portal names no address can hold writes a snapshot that reads back and compares equal', async () => {
  const bodies = edit(routes.companyGroups, (g) => (g.name === 'plots' ? [g, { name: 'odd group', label: 'Odd' }] : g))
  bodies[`${routes.companies}?dataSensitivity=highly_sensitive`] = fixture('api/orchard/companies.spaced.json')
  const observation = await observe({ bodies })
  const readBack = fromSnapshot(snapshotText(toSnapshot(observation, meta)), file)
  const comparison = compare(observation, readBack)
  expect(comparison.complete).toBe(true)
  expect(comparison.differences).toEqual([])
})

test.each([
  [
    'an object key',
    (s: Snapshot) => Object.assign(s.observation.coverage.objects, { 'a b': { status: 'read' } }),
    'object:a b',
  ],
  [
    'an unsupported property name',
    (s: Snapshot) => {
      const unsupported = s.observation.coverage.objects.companies?.unsupported ?? []
      unsupported.push({ ...(unsupported[0] as UnsupportedProperty), name: 'x y' })
    },
    'property:companies/x y',
  ],
  [
    'an unaddressable property name',
    (s: Snapshot) => Object.assign(s.observation.coverage.objects.companies ?? {}, { unaddressable: ['x y'] }),
    'property:companies/x y',
  ],
])('%s in coverage that forms no address is not a snapshot: E_SNAPSHOT, exit 3', async (_, change, address) => {
  const snapshot: Snapshot = toSnapshot(await observe(), meta)
  change(snapshot)
  const error = thrown(() => fromSnapshot(snapshotText(snapshot), 'odd.json'))
  expect(error.exitCode).toBe(3)
  expect(error.issues).toEqual([
    {
      code: 'E_SNAPSHOT',
      message: expect.stringContaining(`${address} is not an address`),
      file: 'odd.json',
      fix: expect.stringContaining('the snapshot command wrote'),
    },
  ])
})

test('the text: keys sorted at every level, unsafe characters escaped, one trailing newline', async () => {
  const bodies = edit(routes.companyGroups, (g) => (g.name === 'orchard' ? { ...g, label: hostileLabel } : g))
  const snapshot = toSnapshot(await observe({ bodies }), meta)
  const text = snapshotText(snapshot)
  expect(text).toBe(`${stableStringify(snapshot)}\n`)
  expect(text.endsWith('}\n')).toBe(true)
  expect(text.endsWith('\n\n')).toBe(false)
  expect(Object.keys(JSON.parse(text))).toEqual([
    'generator',
    'irVersion',
    'observation',
    'project',
    'resources',
    'targets',
    'tombstones',
  ])
  expect(text).toContain('"label": "Orchard \\u009b31m details\\u2028"')
  expect(unsafeJson.test(text)).toBe(false)
})

const scenarios: [string, Read][] = [
  ['a complete read', {}],
  ['a 403 on a properties list', { refused: [routes.companies] }],
  ['a 403 on the schemas list', { refused: [routes.schemas] }],
  [
    'skip and name overrides',
    {
      overrides: {
        'group:companies/orchard': { skip: true },
        'property:harvest/picked_on': { name: 'pickedon' },
        'group:harvest/harvest_details': { name: 'details' },
      },
    },
  ],
  ['a skipped custom object', { overrides: { 'object:harvest': { skip: true } } }],
  [
    'an unsupported enumeration with options',
    {
      bodies: edit(routes.companies, (p) =>
        p.name === 'plot_shape'
          ? {
              ...p,
              type: 'enumeration',
              fieldType: 'tags',
              description: 'Share of each grade',
              options: [
                { label: 'Second', value: 'b', displayOrder: 1, hidden: false },
                { label: 'First', value: 'a', displayOrder: 0, hidden: true, description: 'Best fruit' },
              ],
            }
          : p,
      ),
    },
  ],
  [
    'a custom object schema without a singular label',
    { bodies: edit(routes.schemas, (s) => (s.name === 'harvest' ? { ...s, labels: { plural: 'Harvests' } } : s)) },
  ],
  [
    'portal strings with control characters',
    { bodies: edit(routes.companyGroups, (g) => (g.name === 'orchard' ? { ...g, label: hostileLabel } : g)) },
  ],
]

const extraAddresses = [
  'object:companies',
  'object:harvest',
  'group:companies/old_ledger',
  'property:companies/domain',
  'property:companies/plot_shape',
  'property:companies/nope',
  'property:harvest/pickedon',
  'pipeline:deals/sales',
]

test.each(scenarios)(
  'round trip, %s: read back, the observation holds the same resources and coverage',
  async (_, read) => {
    const original = await observe(read)
    const back = fromSnapshot(snapshotText(toSnapshot(original, meta)), file)
    expect(back.side).toEqual({ kind: 'snapshot', file, name: 'sandbox', portalId: 1_111_111, observedAt })
    expect(back.resources).toStrictEqual(original.resources)
    expect(back.coverage).toStrictEqual(original.coverage)
    const addresses = new Set([
      ...Object.keys(original.resources),
      ...Object.keys(pulled.ir.resources),
      ...extraAddresses,
    ])
    for (const address of addresses) {
      expect(statusOf(back, address), address).toBe(statusOf(original, address))
    }
  },
)

test('unsupported properties survive the round trip through coverage and stay unsupported', async () => {
  const back = fromSnapshot(snapshotText(toSnapshot(await observe(), meta)), file)
  expect(back.coverage).toHaveProperty(
    ['objects', 'companies', 'unsupported'],
    [
      {
        name: 'plot_shape',
        type: 'object_coordinates',
        fieldType: 'text',
        label: 'Plot shape',
        group: { $ref: 'group:companies/orchard' },
        hubspotDefined: false,
      },
    ],
  )
  expect(statusOf(back, 'property:companies/plot_shape')).toBe('unsupported')
})

test('read back, the resources come out sorted by code unit whatever order the file holds them in', async () => {
  const snapshot = toSnapshot(await observe(), meta)
  const reversed = { ...snapshot, resources: Object.fromEntries(Object.entries(snapshot.resources).reverse()) }
  const back = fromSnapshot(JSON.stringify(reversed), file)
  expect(Object.keys(back.resources)).toEqual(Object.keys(snapshot.resources).sort())
})

test('parseSnapshot returns the checked document itself', async () => {
  const snapshot = toSnapshot(await observe(), meta)
  expect(parseSnapshot(snapshotText(snapshot), file)).toStrictEqual(snapshot)
})

test('text that is not JSON is E_SNAPSHOT, exit 1', () => {
  const error = thrown(() => fromSnapshot('{"irVersion": 1,', 'old.json'))
  expect(error.exitCode).toBe(1)
  expect(error.issues).toEqual([
    {
      code: 'E_SNAPSHOT',
      message: 'old.json is not JSON',
      file: 'old.json',
      fix: expect.stringContaining('the snapshot command wrote'),
    },
  ])
})

test.each([
  ['an array', '[]'],
  ['null', 'null'],
  ['a string', '"snapshot"'],
  ['a document with no generator', '{"irVersion":1}'],
  ['a document whose generator is null', '{"irVersion":1,"generator":null}'],
  ['the IR derived from config', stableStringify(pulled.ir)],
  [
    'a portal document without an observation block',
    JSON.stringify({ ...pulled.ir, generator: { ...pulled.ir.generator, frontend: 'portal' } }),
  ],
])('%s is not a snapshot: E_SNAPSHOT, exit 3', (_, text) => {
  const error = thrown(() => fromSnapshot(text, 'other.json'))
  expect(error.exitCode).toBe(3)
  expect(error.issues).toEqual([
    {
      code: 'E_SNAPSHOT',
      message: expect.stringContaining('not an ir/1 document from a portal read'),
      file: 'other.json',
      fix: expect.stringContaining('the snapshot command wrote'),
    },
  ])
})

test.each(['toString', 'constructor', 'pipeline'])(
  'a resource of type %s under a group address is not a snapshot: E_SNAPSHOT, exit 3',
  async (type) => {
    const snapshot: Snapshot = toSnapshot(await observe(), meta)
    snapshot.resources['group:companies/plots'] = { type, managed: true, definition: { label: 'Plots' } }
    const error = thrown(() => fromSnapshot(snapshotText(snapshot), 'odd.json'))
    expect(error.exitCode).toBe(3)
    expect(error.issues).toEqual([
      {
        code: 'E_SNAPSHOT',
        message: expect.stringContaining(`holds a resource of type ${type}`),
        file: 'odd.json',
        fix: expect.stringContaining('the snapshot command wrote'),
      },
    ])
  },
)

test.each([
  ['a newer', 2],
  ['an older', 0],
])('%s IR version is E_SNAPSHOT naming the version this one reads, exit 3, before any other check', async (_, v) => {
  const snapshot = toSnapshot(await observe(), meta)
  // Another version's snapshot may be shaped in any way: only its irVersion is read.
  const text = JSON.stringify({ ...snapshot, irVersion: v, generator: 'elsewhere' })
  const error = thrown(() => fromSnapshot(text, 'later.json'))
  expect(error.exitCode).toBe(3)
  expect(error.issues).toEqual([
    {
      code: 'E_SNAPSHOT',
      message: expect.stringContaining(`later.json is an ir/${v} document`),
      file: 'later.json',
      fix: expect.stringContaining('kalup snapshot --target <name>'),
    },
  ])
})

test('a snapshot that breaks the ir/1 schema: each E_IR_SCHEMA issue names the file, exit 3', async () => {
  const snapshot: Snapshot = toSnapshot(await observe(), meta)
  snapshot.observation.target.portalId = 0
  snapshot.resources['group:companies/orchard'] = { type: 'group', managed: true, definition: { label: 7 } }
  const error = thrown(() => fromSnapshot(snapshotText(snapshot), 'broken.json'))
  expect(error.exitCode).toBe(3)
  expect(error.issues).toEqual([
    {
      code: 'E_IR_SCHEMA',
      message: 'expected at least 1',
      configPath: 'observation.target.portalId',
      file: 'broken.json',
    },
    {
      code: 'E_IR_SCHEMA',
      message: 'expected string, got number',
      configPath: 'resources.group:companies/orchard.definition.label',
      file: 'broken.json',
    },
  ])
})

test('a field name from the file reaches the issue message without its control characters', async () => {
  const snapshot = toSnapshot(await observe(), meta)
  const text = snapshotText({ ...snapshot, observation: { ...snapshot.observation, '\u001b[31mnote': 1 } } as Snapshot)
  const [issue] = thrown(() => fromSnapshot(text, 'odd.json')).issues
  expect(issue?.message).toBe('unexpected field "note"')
})

test('the default path: .kalup/snapshots/<target>/<ISO basic time>.json', () => {
  expect(snapshotPath('sandbox', observedAt)).toBe('.kalup/snapshots/sandbox/20260923T101530123Z.json')
  expect(snapshotPath('eu-prod_2', '2027-01-02T03:04:05.006Z')).toBe(
    '.kalup/snapshots/eu-prod_2/20270102T030405006Z.json',
  )
})

function targetDir(name: string): string {
  const path = snapshotPath(name, observedAt)
  return path.slice('.kalup/snapshots/'.length, path.lastIndexOf('/'))
}

const hash = /^[0-9a-f]{8}$/

test.each([
  ['a plain name', 'sandbox', 'sandbox'],
  ['digits first', '2nd-portal', '2nd-portal'],
  ['64 characters', 'a'.repeat(64), 'a'.repeat(64)],
  ['com0, not a device name', 'com0', 'com0'],
  ['com10, not a device name', 'com10', 'com10'],
  ['console, not a device name', 'console', 'console'],
])('%s is its own directory', (_, name, dir) => {
  expect(targetDir(name)).toBe(dir)
})

test.each([
  ['a Windows device name', 'con', 'con'],
  ['a device name in capitals', 'NUL', 'nul'],
  ['a serial port', 'com1', 'com1'],
  ['a printer port', 'LPT9', 'lpt9'],
  ['aux', 'aux', 'aux'],
  ['prn', 'prn', 'prn'],
  ['capitals', 'Sandbox', 'sandbox'],
  ['a slash', 'eu/prod', 'eu_prod'],
  ['a backslash', 'eu\\prod', 'eu_prod'],
  ['a parent directory', '../etc', 'etc'],
  ['dots', 'prod.eu', 'prod_eu'],
  ['only dots', '..', 'target'],
  ['empty', '', 'target'],
  ['spaces around', '  Prod EU  ', 'prod_eu'],
  ['a leading hyphen', '-prod', 'prod'],
  ['a leading underscore', '_prod', 'prod'],
  ['accented letters', 'Ünïcode', 'n_code'],
  ['only an emoji', '🍎', 'target'],
  ['a colon, as in a drive letter', 'c:prod', 'c_prod'],
  ['65 characters', 'a'.repeat(65), 'a'.repeat(40)],
  ['a long name that breaks at a separator', `${'a'.repeat(39)}.b`, 'a'.repeat(39)],
])('%s becomes a slug plus a hash of the exact name', (_, name, slug) => {
  const dir = targetDir(name)
  expect(dir.slice(0, dir.lastIndexOf('-'))).toBe(slug)
  expect(dir.slice(dir.lastIndexOf('-') + 1)).toMatch(hash)
})

test('the hash is the first 8 hex digits of the SHA-256 of the exact name', () => {
  expect(targetDir('')).toBe('target-e3b0c442')
  expect(targetDir('con')).toBe('con-1143da2b')
  expect(targetDir('Con')).toBe('con-3b6f52aa')
})

test('different names never share a directory, and every directory is safe on every supported system', () => {
  const names = [
    'prod',
    'Prod',
    'PROD',
    'prod.',
    'prod/',
    'prod\\',
    '.prod',
    'prod ',
    'pröd',
    'prød',
    'con',
    'Con',
    'CON',
    'com1',
    'COM1',
    '',
    '.',
    '..',
    '🍎',
    '🍐',
    'a'.repeat(65),
    `${'a'.repeat(65)}b`,
    'eu/prod',
    'eu\\prod',
    'eu_prod',
    'eu-prod',
  ]
  const dirs = names.map(targetDir)
  expect(new Set(dirs).size).toBe(names.length)
  for (const dir of dirs) {
    expect(dir).toMatch(safeDir)
    expect(dir).not.toMatch(deviceName)
  }
})

test('W_INCOMPLETE: none for a complete read, one naming the unread objects and scopes otherwise', async () => {
  const complete = await observe()
  expect(incompleteIssues(complete.coverage ?? fail(), 'sandbox')).toEqual([])
  const one = await observe({ refused: [routes.companies] })
  expect(incompleteIssues(one.coverage ?? fail(), 'sandbox')).toEqual([
    {
      code: 'W_INCOMPLETE',
      message: expect.stringContaining('companies was not read'),
      fix: expect.stringContaining('crm.schemas.companies.read to the read key'),
    },
  ])
  const two = await observe({ refused: [routes.companies, routes.schemas] })
  expect(incompleteIssues(two.coverage ?? fail(), 'sandbox')).toEqual([
    {
      code: 'W_INCOMPLETE',
      message: expect.stringContaining('companies and harvest were not read'),
      fix: expect.stringContaining('crm.schemas.companies.read and crm.schemas.custom.read'),
    },
  ])
})

test('W_INCOMPLETE: a config property in a portal group no address can hold leaves the read incomplete', async () => {
  const bodies = edit(routes.companies, (p) => (p.name === 'plot_total' ? { ...p, groupName: 'odd group' } : p))
  const groups = bodies[routes.companyGroups] as { results: Item[] }
  bodies[routes.companyGroups] = { results: [...groups.results, { name: 'odd group', label: 'Odd' }] }
  const moved = await observe({ bodies })
  expect(moved.coverage?.complete).toBe(false)
  expect(incompleteIssues(moved.coverage ?? fail(), 'sandbox')).toEqual([
    {
      code: 'W_INCOMPLETE',
      message: expect.stringContaining('property:companies/plot_total is in a portal group'),
      fix: expect.stringContaining('rename the group of property:companies/plot_total'),
    },
  ])
  const both = await observe({ bodies, refused: [routes.schemas] })
  expect(incompleteIssues(both.coverage ?? fail(), 'sandbox')).toEqual([
    {
      code: 'W_INCOMPLETE',
      message: expect.stringMatching(bothGaps),
      fix: expect.stringMatching(bothFixes),
    },
  ])
  // Read back, the snapshot says what a comparison of it finds: incomplete.
  const back = fromSnapshot(snapshotText(toSnapshot(moved, meta)), file)
  expect(back.coverage?.complete).toBe(false)
  expect(compare(moved, back).complete).toBe(false)
})

function fail(): never {
  throw new Error('a target observation carries coverage')
}
