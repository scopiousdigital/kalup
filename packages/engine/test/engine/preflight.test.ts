import { expect, test, vi } from 'vitest'
import { headroom, preflight } from '../../src/engine/preflight.js'
import { createHttp, type Fetch } from '../../src/lib/http.js'
import type { LimitReading } from '../../src/plan/types.js'
import { fakeFetch, fixture, jsonResponse } from '../support/testing.js'

// What the property limit reading answered, and how many creates it could not check.
const refusedForTwo = /answered 403, .*for 2 creates$/
const figurelessForOne = /answered E_HTTP, .*for 1 create$/
const pressRunRoom = /on press_run .*room for 1 more \(limit 500, 499 in use\)/

const rate = {
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}
const objectTypes = 'https://api.hubapi.com/crm/limits/2026-09/custom-object-types'
const properties = 'https://api.hubapi.com/crm/limits/2026-09/custom-properties'

function http(...responses: Response[]) {
  const fake = fakeFetch(...responses)
  return {
    calls: fake.calls,
    http: createHttp({ key: 'kalup-test-secret-9f2c', fetch: fake.fetch, warn: () => undefined }),
  }
}

const harvest = { harvest: '2-4242001' }

test('preflight reads both limits through their registry paths, keeping the observed objects entries', async () => {
  const { http: client, calls } = http(
    jsonResponse(200, fixture('api/orchard/limits.custom-object-types.json'), rate),
    jsonResponse(200, fixture('api/orchard/limits.custom-properties.json'), rate),
  )
  const result = await preflight(client, { objectTypes: true, properties: true, objectTypeIds: harvest })
  expect(calls.map((c) => c.url)).toEqual([objectTypes, properties])
  expect(result).toEqual({
    limits: [
      { key: 'custom-object-types', status: 'read', limit: 10, usage: 2 },
      {
        key: 'custom-properties',
        status: 'read',
        limit: 1000,
        usage: 412,
        byObjectType: [{ objectTypeId: '2-4242001', limit: 500, usage: 20 }],
      },
    ],
  })
})

test('preflight reads only what the plan asks for, and byObjectType is left out when nothing was observed', async () => {
  const { http: client, calls } = http(jsonResponse(200, fixture('api/orchard/limits.custom-properties.json'), rate))
  const result = await preflight(client, { objectTypes: false, properties: true, objectTypeIds: {} })
  expect(calls.map((c) => c.url)).toEqual([properties])
  expect(result.limits).toEqual([{ key: 'custom-properties', status: 'read', limit: 1000, usage: 412 }])

  const idle = http()
  expect(await preflight(idle.http, { objectTypes: false, properties: false, objectTypeIds: harvest })).toEqual({
    limits: [],
  })
  expect(idle.calls).toEqual([])
})

test('byObjectType entries are sorted by objectTypeId', async () => {
  const { http: client } = http(jsonResponse(200, fixture('api/orchard/limits.custom-properties.json'), rate))
  const result = await preflight(client, {
    objectTypes: false,
    properties: true,
    objectTypeIds: { press_run: '2-4242002', harvest: '2-4242001' },
  })
  const [reading] = result.limits
  expect(reading?.status === 'read' && reading.byObjectType?.map((e) => e.objectTypeId)).toEqual([
    '2-4242001',
    '2-4242002',
  ])
})

test('preflight keeps a standard object entry when its type ID is requested', async () => {
  const { http: client } = http(jsonResponse(200, fixture('api/orchard/limits.custom-properties.json'), rate))
  const result = await preflight(client, {
    objectTypes: false,
    properties: true,
    objectTypeIds: { companies: '0-2', ...harvest },
  })
  expect(result.limits).toEqual([
    {
      key: 'custom-properties',
      status: 'read',
      limit: 1000,
      usage: 412,
      byObjectType: [
        { objectTypeId: '0-2', limit: 1000, usage: 388 },
        { objectTypeId: '2-4242001', limit: 500, usage: 20 },
      ],
    },
  ])
})

test('a 403 on custom-properties is an unreadable reading, not a failure', async () => {
  const { http: client } = http(
    jsonResponse(200, fixture('api/orchard/limits.custom-object-types.json'), rate),
    jsonResponse(403, fixture('errors/missing-scope.json')),
  )
  const result = await preflight(client, { objectTypes: true, properties: true, objectTypeIds: harvest })
  expect(result.limits).toEqual([
    { key: 'custom-object-types', status: 'read', limit: 10, usage: 2 },
    { key: 'custom-properties', status: 'unreadable', issue: 'E_SCOPE' },
  ])
})

test('any other HubSpot error, or a body without limit and usage, is unreadable too', async () => {
  const { http: client } = http(
    jsonResponse(404, { message: 'Not found' }),
    jsonResponse(200, { overallPercentage: 0, byObjectType: [] }, rate),
  )
  const result = await preflight(client, { objectTypes: true, properties: true, objectTypeIds: harvest })
  expect(result.limits).toEqual([
    { key: 'custom-object-types', status: 'unreadable', issue: 'E_HTTP' },
    { key: 'custom-properties', status: 'unreadable', issue: 'E_HTTP' },
  ])
})

test('a 200 whose body is null is unreadable, never a failure', async () => {
  const { http: client } = http(jsonResponse(200, null, rate), jsonResponse(200, null, rate))
  const result = await preflight(client, { objectTypes: true, properties: true, objectTypeIds: harvest })
  expect(result.limits).toEqual([
    { key: 'custom-object-types', status: 'unreadable', issue: 'E_HTTP' },
    { key: 'custom-properties', status: 'unreadable', issue: 'E_HTTP' },
  ])
})

test('a byObjectType that is not a list, or an entry that is not an object, is left out of the reading', async () => {
  const overall = { overallLimit: 1000, overallUsage: 412 }
  const entry = { objectTypeId: '2-4242001', limit: 500, usage: 20 }
  const { http: client } = http(
    jsonResponse(200, { ...overall, byObjectType: {} }, rate),
    jsonResponse(200, { ...overall, byObjectType: [null, 7, 'x', entry] }, rate),
  )
  const request = { objectTypes: false, properties: true, objectTypeIds: harvest }
  expect((await preflight(client, request)).limits).toEqual([
    { key: 'custom-properties', status: 'read', limit: 1000, usage: 412 },
  ])
  expect((await preflight(client, request)).limits).toEqual([
    {
      key: 'custom-properties',
      status: 'read',
      limit: 1000,
      usage: 412,
      byObjectType: [{ objectTypeId: '2-4242001', limit: 500, usage: 20 }],
    },
  ])
})

test('a network failure still fails the command', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const fetch: Fetch = () => Promise.reject(new TypeError('fetch failed'))
  const client = createHttp({ key: 'kalup-test-secret-9f2c', fetch, warn: () => undefined })
  const pending = expect(
    preflight(client, { objectTypes: true, properties: false, objectTypeIds: {} }),
  ).rejects.toThrow('fetch failed')
  await vi.advanceTimersByTimeAsync(10_000)
  await pending
  vi.useRealTimers()
})

const read = (key: string, limit: number, usage: number, extra: object = {}): LimitReading => ({
  key,
  status: 'read',
  limit,
  usage,
  ...extra,
})

test('a limit of 0 blocks every custom object create, quoting the reported limit and usage', () => {
  const result = headroom(
    [read('custom-object-types', 0, 0)],
    ['object:harvest', 'object:press_run', 'group:harvest/harvest_details'],
    {},
    'sandbox',
  )
  expect(result).toEqual({
    blocked: {
      'object:harvest': {
        reason: 'limit',
        detail: expect.stringContaining('limit of 0 custom objects'),
        fix: expect.stringContaining("{ 'object:harvest': { skip: true } }"),
      },
      'object:press_run': {
        reason: 'limit',
        detail: expect.stringContaining('limit of 0 custom objects'),
        fix: expect.stringContaining("{ 'object:press_run': { skip: true } }"),
      },
    },
    issues: [],
  })
})

test('usage above the limit blocks every property create', () => {
  const result = headroom(
    [read('custom-properties', 1000, 1004)],
    ['property:companies/plot_rows', 'property:harvest/crate_count'],
    harvest,
    'sandbox',
  )
  expect(Object.keys(result.blocked)).toEqual(['property:companies/plot_rows', 'property:harvest/crate_count'])
  expect(result.blocked['property:harvest/crate_count']?.detail).toContain('with 1004 in use')
  expect(result.issues).toEqual([])
})

test('headroom smaller than the planned creates warns and blocks nothing', () => {
  const result = headroom(
    [read('custom-object-types', 10, 9), read('custom-properties', 1000, 998)],
    ['object:harvest', 'object:press_run', 'property:companies/a', 'property:companies/b', 'property:companies/c'],
    {},
    'sandbox',
  )
  expect(result.blocked).toEqual({})
  expect(result.issues).toEqual([
    {
      code: 'W_LIMIT_HEADROOM',
      message: expect.stringContaining('room for 1 more (limit 10, 9 in use)'),
      fix: expect.stringContaining('skip overrides'),
    },
    {
      code: 'W_LIMIT_HEADROOM',
      message: expect.stringContaining('room for 2 more (limit 1000, 998 in use)'),
      fix: expect.stringContaining('skip overrides'),
    },
  ])
})

test('enough headroom, or no creates of that kind, is quiet', () => {
  const limits = [read('custom-object-types', 10, 8), read('custom-properties', 0, 0)]
  expect(headroom(limits, ['object:harvest', 'object:press_run'], {}, 'sandbox')).toEqual({ blocked: {}, issues: [] })
})

test('an unreadable or missing reading blocks nothing', () => {
  const unreadable: LimitReading[] = [
    { key: 'custom-object-types', status: 'unreadable', issue: 'E_SCOPE' },
    { key: 'custom-properties', status: 'unreadable', issue: 'E_HTTP' },
  ]
  const creates = ['object:harvest', 'property:companies/plot_rows']
  expect(headroom(unreadable, creates, harvest, 'sandbox').blocked).toEqual({})
  expect(headroom([], creates, harvest, 'sandbox')).toEqual({ blocked: {}, issues: [] })
})

test('an unreadable property limit with property creates warns W_LIMIT_UNREADABLE, with the answer and the count', () => {
  const refused: LimitReading[] = [{ key: 'custom-properties', status: 'unreadable', issue: 'E_SCOPE' }]
  const creates = ['property:harvest/crate_count', 'property:deals/term_days', 'object:harvest']
  expect(headroom(refused, creates, harvest, 'sandbox')).toEqual({
    blocked: {},
    issues: [
      {
        code: 'W_LIMIT_UNREADABLE',
        message: expect.stringMatching(refusedForTwo),
        fix: expect.stringContaining('crm.objects.deals.read'),
      },
    ],
  })
  // A 200 without figures is E_HTTP, as any other error is.
  const figureless: LimitReading[] = [{ key: 'custom-properties', status: 'unreadable', issue: 'E_HTTP' }]
  expect(headroom(figureless, ['property:harvest/crate_count'], harvest, 'sandbox').issues).toEqual([
    {
      code: 'W_LIMIT_UNREADABLE',
      message: expect.stringMatching(figurelessForOne),
      fix: expect.stringContaining('crm.objects.companies.read'),
    },
  ])
})

test('an unreadable property limit warns of nothing without a property create, and an object limit never warns', () => {
  const unreadable: LimitReading[] = [
    { key: 'custom-object-types', status: 'unreadable', issue: 'E_SCOPE' },
    { key: 'custom-properties', status: 'unreadable', issue: 'E_SCOPE' },
  ]
  expect(headroom(unreadable, ['object:harvest', 'group:companies/orchard'], harvest, 'sandbox')).toEqual({
    blocked: {},
    issues: [],
  })
})

test('a custom object entry limits the property creates on that object only, when its type ID was observed', () => {
  const limits = [
    read('custom-properties', 1000, 412, {
      byObjectType: [
        { objectTypeId: '2-4242001', limit: 500, usage: 500 },
        { objectTypeId: '2-4242002', limit: 500, usage: 499 },
      ],
    }),
  ]
  const creates = [
    'property:companies/plot_rows',
    'property:harvest/crate_count',
    'property:press_run/a',
    'property:press_run/b',
    'property:cellar/c',
  ]
  const result = headroom(limits, creates, { harvest: '2-4242001', press_run: '2-4242002' }, 'sandbox')
  expect(result.blocked).toEqual({
    'property:harvest/crate_count': {
      reason: 'limit',
      detail: expect.stringContaining('on harvest, with 500 in use'),
      fix: expect.stringContaining("{ 'property:harvest/crate_count': { skip: true } }"),
    },
  })
  expect(result.issues).toEqual([
    {
      code: 'W_LIMIT_HEADROOM',
      message: expect.stringMatching(pressRunRoom),
      fix: expect.stringContaining('skip overrides'),
    },
  ])
})

test('a standard object entry limits the property creates on that object only', () => {
  const limits = [
    read('custom-properties', 5000, 1000, {
      byObjectType: [
        { objectTypeId: '0-2', limit: 1000, usage: 1000 },
        { objectTypeId: '0-3', limit: 1000, usage: 1000 },
      ],
    }),
  ]
  // deals is not in the map, so its full entry is not its: deals meets the overall figure only.
  const creates = ['property:companies/plot_rows', 'property:deals/term_days', 'property:harvest/crate_count']
  expect(headroom(limits, creates, { companies: '0-2' }, 'sandbox')).toEqual({
    blocked: {
      'property:companies/plot_rows': {
        reason: 'limit',
        detail: expect.stringContaining('on companies, with 1000 in use'),
        fix: expect.stringContaining("{ 'property:companies/plot_rows': { skip: true } }"),
      },
    },
    issues: [],
  })
})

test('a zero-limit fixture read through preflight blocks the custom object create', async () => {
  const { http: client } = http(jsonResponse(200, fixture('api/orchard/limits.custom-object-types.zero.json'), rate))
  const { limits } = await preflight(client, { objectTypes: true, properties: false, objectTypeIds: {} })
  expect(Object.keys(headroom(limits, ['object:harvest'], {}, 'sandbox').blocked)).toEqual(['object:harvest'])
})
