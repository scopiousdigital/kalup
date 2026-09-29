// The write client: `send` sends an allowed write once and reports its outcome; its reads are the read client's.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createBucket,
  createHttp,
  createWriteHttp,
  type Fetch,
  MILESTONE_3_WRITES,
  type WriteRequest,
  type WriteRoute,
} from '../../src/lib/http.js'
import { KalupError } from '../../src/lib/output.js'
import { registry } from '../../src/lib/registry.js'
import { fixture, jsonResponse } from '../../src/lib/testing.js'

const key = 'kalup-test-write-secret-4b1d'
const create: WriteRequest = {
  type: 'property',
  path: 'create',
  params: { objectType: 'companies' },
  body: { name: 'plot_count', label: 'Plot count', type: 'number', fieldType: 'number', groupName: 'orchard' },
}
const rate = {
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}
const importsWriteHttp = /\b(createWriteHttp|resolveWriteKey)\b/
const futureWriters = [
  /^engine\/apply[^/]*\.ts$/,
  /^commands\/apply\.ts$/,
  /^commands\/state\.ts$/,
  /^commands\/target-rebind\.ts$/,
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-09-22T10:00:00Z'))
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Scripted = Response | Error | 'never'

// A fetch that answers each call with the next scripted answer (then 200 {}), and records every call.
function scripted(...answers: Scripted[]): { fetch: Fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init })
      const next = answers.shift() ?? jsonResponse(200)
      if (next === 'never') {
        return new Promise(() => undefined)
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    },
  }
}

function writer(fetch: Fetch, allow: readonly WriteRoute[] = MILESTONE_3_WRITES) {
  return createWriteHttp({ key, fetch, warn: vi.fn(), allow })
}

test('a 201 is ok with the body, and the request carries the write key, the method and the JSON body', async () => {
  const property = { name: 'plot_count', label: 'Plot count', groupName: 'orchard' }
  const { fetch, calls } = scripted(jsonResponse(201, property))
  await expect(writer(fetch).send(create)).resolves.toEqual({ kind: 'ok', status: 201, body: property })
  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toBe('https://api.hubapi.com/crm/properties/2026-09/companies')
  expect(calls[0]?.init.method).toBe('POST')
  expect(calls[0]?.init.headers).toEqual({
    authorization: `Bearer ${key}`,
    accept: 'application/json',
    'content-type': 'application/json',
  })
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual(create.body)
  expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
})

test('a 204 is ok with no body', async () => {
  const { fetch } = scripted(jsonResponse(204))
  const remove: WriteRequest = { type: 'group', path: 'delete', params: { objectType: 'companies', name: 'orchard' } }
  await expect(writer(fetch).send(remove)).resolves.toEqual({ kind: 'ok', status: 204, body: undefined })
})

test('a POST answered 502 is sent exactly once and is uncertain', async () => {
  const { fetch, calls } = scripted(jsonResponse(502), jsonResponse(201, {}))
  await expect(writer(fetch).send(create)).resolves.toEqual({ kind: 'uncertain', reason: 'server', status: 502 })
  await vi.advanceTimersByTimeAsync(120_000)
  expect(calls).toHaveLength(1)
})

test('a request that never settles is uncertain at the timeout, and is not sent again', async () => {
  const { fetch, calls } = scripted('never', jsonResponse(201, {}))
  let settled: unknown
  const pending = writer(fetch)
    .send(create)
    .then((outcome) => {
      settled = outcome
    })
  await vi.advanceTimersByTimeAsync(29_999)
  expect(settled).toBeUndefined()
  await vi.advanceTimersByTimeAsync(1)
  await pending
  expect(settled).toEqual({ kind: 'uncertain', reason: 'timeout' })
  expect(calls[0]?.init.signal?.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(120_000)
  expect(calls).toHaveLength(1)
})

test('the write timeout is injectable', async () => {
  const { fetch } = scripted('never')
  const pending = createWriteHttp({ key, fetch, warn: vi.fn(), allow: MILESTONE_3_WRITES, timeoutMs: 5000 }).send(
    create,
  )
  await vi.advanceTimersByTimeAsync(5000)
  await expect(pending).resolves.toEqual({ kind: 'uncertain', reason: 'timeout' })
})

test('a fetch that throws is uncertain, and is not sent again', async () => {
  const { fetch, calls } = scripted(new TypeError('fetch failed'))
  await expect(writer(fetch).send(create)).resolves.toEqual({ kind: 'uncertain', reason: 'network' })
  await vi.advanceTimersByTimeAsync(120_000)
  expect(calls).toHaveLength(1)
})

test('a 2xx whose body is not JSON is uncertain', async () => {
  const html = new Response('<html>Proxy error</html>', { status: 200, headers: { 'content-type': 'text/html' } })
  const { fetch } = scripted(html)
  await expect(writer(fetch).send(create)).resolves.toEqual({ kind: 'uncertain', reason: 'unreadable', status: 200 })
})

test.each([
  ['a 429 with Retry-After', 429, fixture('errors/rate-limit-secondly.json'), { 'retry-after': '5' }, false, 5000],
  ['a 429 without Retry-After', 429, fixture('errors/rate-limit-secondly.json'), {}, false, 1000],
  [
    'a 429 with a Retry-After over the cap',
    429,
    fixture('errors/rate-limit-secondly.json'),
    { 'retry-after': '600' },
    false,
    60_000,
  ],
  [
    'a daily 429, until midnight in the portal time zone',
    429,
    fixture('errors/rate-limit-daily.json'),
    {},
    true,
    12 * 3_600_000,
  ],
  ['a 423', 423, { status: 'error', message: 'Locked' }, {}, false, 2000],
  [
    'a 477 with Retry-After',
    477,
    { status: 'error', message: 'Migration in progress' },
    { 'retry-after': '3' },
    false,
    3000,
  ],
  ['a 477 without Retry-After', 477, { status: 'error', message: 'Migration in progress' }, {}, false, 1000],
])('%s is a wait', async (_, status, body, headers, daily, waitMs) => {
  const { fetch, calls } = scripted(jsonResponse(status, body, headers))
  const http = writer(fetch)
  http.timeZone = 'Europe/Ljubljana'
  await expect(http.send(create)).resolves.toEqual({ kind: 'wait', status, daily, waitMs })
  expect(calls).toHaveLength(1)
})

test.each([
  [400, 'VALIDATION_ERROR', 'Property values were not valid'],
  [409, 'CONFLICT', 'A property named plot_count already exists'],
])(
  'a %i is rejected with the category, the correlation ID and the sanitized message alone',
  async (status, category, said) => {
    const correlationId = '9d0c3b1a-2f4e-4a6b-8c7d-1e2f3a4b5c6d'
    const body = {
      status: 'error',
      category,
      correlationId,
      message: `${said}\u001b[31m\n`,
      errors: [{ message: 'body-detail-that-stays-out', code: 'INVALID' }],
      context: { name: ['body-context-that-stays-out'] },
    }
    const { fetch } = scripted(jsonResponse(status, body))
    const outcome = await writer(fetch).send(create)
    expect(outcome).toEqual({
      kind: 'rejected',
      status,
      category,
      correlationId,
      message: `HubSpot returned ${status} for POST /crm/properties/2026-09/companies. HubSpot said: ${said}`,
    })
    expect(JSON.stringify(outcome)).not.toContain('stays-out')
  },
)

test("a rejection keeps HubSpot's subCategory, sanitized, capped and with the key cut out, as the category is", async () => {
  const remove: WriteRequest = {
    type: 'property',
    path: 'delete',
    params: { objectType: 'companies', name: 'plot_count' },
  }
  const body = {
    status: 'error',
    category: 'VALIDATION_ERROR',
    subCategory: 'PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE',
    correlationId: '01a0ec0d-f3d8-7355-ad88-97dc138530a7',
    message: 'Property: plot_count of object type 0-2 is currently used in 1 places and cannot be deleted',
  }
  const outcome = await writer(scripted(jsonResponse(400, body)).fetch).send(remove)
  expect(outcome).toMatchObject({
    kind: 'rejected',
    status: 400,
    category: 'VALIDATION_ERROR',
    subCategory: 'PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE',
  })
  const hostile = { ...body, subCategory: `Echo.${key}\u001b[31m\n${'X'.repeat(200)}` }
  const echoed = await writer(scripted(jsonResponse(400, hostile)).fetch).send(remove)
  const subCategory = echoed.kind === 'rejected' ? (echoed.subCategory ?? '') : ''
  expect(subCategory.startsWith('Echo.[key]XXX')).toBe(true)
  expect(subCategory).not.toContain(key)
  expect(subCategory).not.toContain('\u001b')
  expect(Array.from(subCategory)).toHaveLength(120)
  // No subCategory in the body, none in the outcome.
  const plain = await writer(scripted(jsonResponse(400, { ...body, subCategory: 7 })).fetch).send(remove)
  expect(plain).not.toHaveProperty('subCategory')
})

test('an error body HubSpot nests, as JSON text, in message fills in the fields and the message, as observed', async () => {
  const correlationId = '01a0ec0d-ea13-7c1b-8aba-8df265916001'
  const nested = {
    status: 'error',
    message: "Can't delete or purge a group with active properties",
    correlationId,
    category: 'VALIDATION_ERROR',
    subCategory: 'PropertyGroupError.GROUP_WITH_ACTIVE_PROPERTIES',
  }
  const body = { status: 'error', message: JSON.stringify(nested), correlationId }
  const remove: WriteRequest = { type: 'group', path: 'delete', params: { objectType: 'companies', name: 'orchard' } }
  await expect(writer(scripted(jsonResponse(400, body)).fetch).send(remove)).resolves.toEqual({
    kind: 'rejected',
    status: 400,
    category: 'VALIDATION_ERROR',
    subCategory: 'PropertyGroupError.GROUP_WITH_ACTIVE_PROPERTIES',
    correlationId,
    message:
      "HubSpot returned 400 for DELETE /crm/properties/2026-09/companies/groups/orchard. HubSpot said: Can't delete or purge a group with active properties",
  })
})

test('a 4xx without an error body is rejected with a message of its own', async () => {
  const { fetch } = scripted(new Response('', { status: 404 }))
  await expect(writer(fetch).send(create)).resolves.toEqual({
    kind: 'rejected',
    status: 404,
    message: 'HubSpot returned 404 for POST /crm/properties/2026-09/companies.',
  })
})

test.each([
  ['an object', { message: { detail: 'x' }, category: 7, correlationId: ['x'] }],
  ['a number', { message: 42 }],
  ['null', { message: null, category: null }],
])('a 4xx whose message is %s is rejected, not thrown, and quotes no field that is not a string', async (_, body) => {
  const { fetch } = scripted(jsonResponse(400, body))
  await expect(writer(fetch).send(create)).resolves.toEqual({
    kind: 'rejected',
    status: 400,
    message: 'HubSpot returned 400 for POST /crm/properties/2026-09/companies.',
  })
})

test('a read whose error body has a message that is not a string is E_HTTP, not a TypeError', async () => {
  const { fetch } = scripted(jsonResponse(400, { message: { detail: 'x' }, category: 7 }))
  const error = await writer(fetch)
    .request({ type: 'property', path: 'list', params: { objectType: 'companies' } })
    .catch((e: unknown) => e)
  expect(error).toBeInstanceOf(KalupError)
  expect(error).toMatchObject({ category: undefined, issues: [{ code: 'E_HTTP' }] })
})

test.each([
  ['companies', 'crm.schemas.companies.write'],
  ['products', 'e-commerce'],
  ['2-4242001', 'crm.schemas.custom.write'],
])('a 403 on a write to %s names the write scope %s', async (objectType, scope) => {
  const { fetch } = scripted(jsonResponse(403, fixture('errors/missing-scope.json')))
  const outcome = await writer(fetch).send({ ...create, params: { objectType } })
  expect(outcome).toMatchObject({ kind: 'rejected', status: 403, category: 'MISSING_SCOPES' })
  expect(outcome.kind === 'rejected' && outcome.message).toContain(`lacks the scope ${scope}`)
})

test('a write the allowlist does not name is E_WRITE_NOT_ALLOWED before any request, object writes included', async () => {
  const { fetch, calls } = scripted()
  const params = { objectType: 'companies', name: 'orchard' }
  const writes = Object.entries(registry).flatMap(([type, row]) =>
    Object.entries(row.paths)
      .filter(([, endpoint]) => endpoint.tag === 'write')
      .map(([path]) => ({ type, path, params, body: {} }) as WriteRequest),
  )
  const allowed = new Set(MILESTONE_3_WRITES.map((route) => `${route.type}.${route.path}`))
  const refused = writes.filter((req) => !allowed.has(`${req.type}.${req.path}`))
  expect(refused.map((req) => `${req.type}.${req.path}`)).toEqual(['object.create', 'object.update', 'object.delete'])
  const noneAllowed = writer(fetch, [])
  const cases = [
    ...refused.map((req) => writer(fetch).send(req)),
    ...writes.map((req) => noneAllowed.send(req)),
    // A read path smuggled into send.
    writer(fetch).send({ type: 'property', path: 'list', params } as unknown as WriteRequest),
  ]
  const errors = await Promise.all(cases.map((pending) => pending.catch((e: unknown) => e)))
  for (const error of errors) {
    expect(error).toBeInstanceOf(KalupError)
    expect((error as KalupError).issues[0]?.code).toBe('E_WRITE_NOT_ALLOWED')
  }
  expect(errors).toHaveLength(refused.length + writes.length + 1)
  expect(calls).toHaveLength(0)
})

test('apply allows the six property and group writes and nothing else', () => {
  expect(MILESTONE_3_WRITES.map((route) => `${route.type}.${route.path}`)).toEqual([
    'property.create',
    'property.update',
    'property.delete',
    'group.create',
    'group.update',
    'group.delete',
  ])
})

test('reads through the write client use the write key and keep the read retries', async () => {
  const { fetch, calls } = scripted(
    jsonResponse(503),
    new TypeError('fetch failed'),
    jsonResponse(200, { results: [] }),
  )
  const pending = writer(fetch).request({ type: 'property', path: 'list', params: { objectType: 'companies' } })
  await vi.advanceTimersByTimeAsync(5000)
  await expect(pending).resolves.toEqual({ results: [] })
  expect(calls).toHaveLength(3)
  expect(calls.map((call) => (call.init.headers as Record<string, string>).authorization)).toEqual(
    Array.from({ length: 3 }, () => `Bearer ${key}`),
  )
})

test('a shared bucket paces the reads and writes of one portal together and reports the daily figure to both', async () => {
  const bucket = createBucket()
  const drained = { ...rate, 'x-hubspot-ratelimit-max': '1', 'x-hubspot-ratelimit-remaining': '0' }
  const reads = scripted(
    jsonResponse(200, { results: [] }, { ...drained, 'x-hubspot-ratelimit-daily-remaining': '500' }),
  )
  const writes = scripted(jsonResponse(201, {}, { ...rate, 'x-hubspot-ratelimit-daily-remaining': '499' }))
  const read = createHttp({ key, fetch: reads.fetch, warn: vi.fn(), bucket })
  const write = createWriteHttp({ key, fetch: writes.fetch, warn: vi.fn(), bucket, allow: MILESTONE_3_WRITES })
  await read.request({ type: 'property', path: 'list', params: { objectType: 'companies' } })
  expect(write.dailyRemaining).toBe(500)
  // The read's answer left no token for one request per 10 s, so the write waits for the refill.
  const sent = write.send(create)
  await vi.advanceTimersByTimeAsync(9999)
  expect(writes.calls).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(writes.calls).toHaveLength(1)
  await sent
  expect(read.dailyRemaining).toBe(499)
})

test('only the future writers import createWriteHttp or resolveWriteKey', () => {
  const src = fileURLToPath(new URL('../../src/', import.meta.url))
  const defining = new Set(['lib/http.ts', 'lib/auth.ts'])
  const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file.endsWith('.ts') && !defining.has(file))
    .filter((file) => importsWriteHttp.test(readFileSync(join(src, file), 'utf8')))
    .filter((file) => !futureWriters.some((allowed) => allowed.test(file)))
  expect(offenders).toEqual([])
})
