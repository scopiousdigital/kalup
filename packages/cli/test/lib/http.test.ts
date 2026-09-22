import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { baseUrl, createHttp, type HttpRequest, HubSpotApiError, portalMidnight } from '../../src/lib/http.js'
import { KalupError } from '../../src/lib/output.js'
import { registry } from '../../src/lib/registry.js'
import { fakeFetch, fixture, jsonResponse } from '../../src/lib/testing.js'

const key = 'kalup-test-secret-9f2c'
const fetchWord = /\bfetch\b/
const list: HttpRequest = { type: 'property', path: 'list', params: { objectType: 'companies' } }
const rateHeaders = {
  'x-hubspot-ratelimit-max': '10',
  'x-hubspot-ratelimit-remaining': '0',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-09-22T10:00:00Z'))
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function client(fetch: ReturnType<typeof fakeFetch>['fetch'], warn = vi.fn()) {
  return createHttp({ key, fetch, warn })
}

test('sends a read request with the key as a bearer token and returns JSON', async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(200, { results: [{ name: 'billing_status' }] }))
  const http = client(fetch)
  const body = await http.request({ ...list, query: { archived: 'false' } })
  expect(body).toEqual({ results: [{ name: 'billing_status' }] })
  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toBe('https://api.hubapi.com/crm/properties/2026-09/companies?archived=false')
  expect(calls[0]?.init.method).toBe('GET')
  expect(calls[0]?.init.headers).toEqual({ authorization: `Bearer ${key}`, accept: 'application/json' })
  expect(calls[0]?.init.body).toBeUndefined()
})

test('a 204 resolves to undefined', async () => {
  const { fetch } = fakeFetch(jsonResponse(204))
  await expect(client(fetch).request(list)).resolves.toBeUndefined()
})

test('http.ts is the one file in the CLI that references fetch', () => {
  const src = fileURLToPath(new URL('../../src/', import.meta.url))
  const allowed = new Set(['lib/http.ts', 'lib/testing.ts'])
  const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !allowed.has(file))
    .filter((file) => fetchWord.test(readFileSync(join(src, file), 'utf8')))
  expect(offenders).toEqual([])
})

test('fakeFetch refuses a request that matches no read-tagged registry path', async () => {
  const { fetch, calls } = fakeFetch()
  const companies = `${baseUrl}/crm/properties/2026-09/companies`
  await expect(fetch(companies, { method: 'POST' })).rejects.toThrow('matches no read-tagged registry path')
  await expect(fetch(`${baseUrl}/crm/objects/2026-09/companies`, { method: 'GET' })).rejects.toThrow('matches no')
  await expect(fetch(companies, { method: 'GET' })).resolves.toHaveProperty('status', 200)
  expect(calls).toHaveLength(1)
})

test('read mode refuses every write-tagged path before sending', async () => {
  const { fetch, calls } = fakeFetch()
  const http = client(fetch)
  const params = { objectType: 'companies', name: 'billing_status' }
  const writes = Object.entries(registry).flatMap(([type, row]) =>
    Object.entries(row.paths)
      .filter(([, endpoint]) => endpoint.tag === 'write')
      .map(([path]) => ({ type, path, params, body: {} }) as HttpRequest),
  )
  await Promise.all(
    writes.map(async (req) => {
      const error = await http.request(req).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(KalupError)
      expect((error as KalupError).issues[0]?.code).toBe('E_WRITE_IN_READ_MODE')
    }),
  )
  expect(writes.length).toBeGreaterThan(0)
  expect(calls).toHaveLength(0)
})

test('429 waits for Retry-After seconds, then retries', async () => {
  const { fetch, calls } = fakeFetch(
    jsonResponse(429, fixture('errors/rate-limit-secondly.json'), { 'retry-after': '2' }),
    jsonResponse(200, { results: [] }),
  )
  const pending = client(fetch).request(list)
  await vi.advanceTimersByTimeAsync(1999)
  expect(calls).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(2)
  await expect(pending).resolves.toEqual({ results: [] })
})

test('429 without Retry-After backs off exponentially', async () => {
  const { fetch, calls } = fakeFetch(
    jsonResponse(429, fixture('errors/rate-limit-secondly.json')),
    jsonResponse(429, fixture('errors/rate-limit-secondly.json')),
    jsonResponse(200, { results: [] }),
  )
  const pending = client(fetch).request(list)
  await vi.advanceTimersByTimeAsync(249)
  expect(calls).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(499)
  expect(calls).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(3)
  await expect(pending).resolves.toEqual({ results: [] })
})

test('the jitter keeps attempt 0 under 500 ms, so it never overlaps the minimum of attempt 1', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999)
  const { fetch, calls } = fakeFetch(
    jsonResponse(429, fixture('errors/rate-limit-secondly.json')),
    jsonResponse(429, fixture('errors/rate-limit-secondly.json')),
    jsonResponse(200, { results: [] }),
  )
  const pending = client(fetch).request(list)
  await vi.advanceTimersByTimeAsync(498)
  expect(calls).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(748)
  expect(calls).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(3)
  await expect(pending).resolves.toEqual({ results: [] })
})

test('a Retry-After that is an HTTP-date falls back to backoff', async () => {
  const { fetch, calls } = fakeFetch(
    jsonResponse(429, fixture('errors/rate-limit-secondly.json'), { 'retry-after': 'Wed, 23 Sep 2026 10:00:00 GMT' }),
    jsonResponse(200, { results: [] }),
  )
  const pending = client(fetch).request(list)
  await vi.advanceTimersByTimeAsync(249)
  expect(calls).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(2)
  await expect(pending).resolves.toEqual({ results: [] })
})

test('a 429 with rate headers waits for the longer of Retry-After and the bucket refill', async () => {
  const limited = (headers: Record<string, string>) =>
    jsonResponse(429, fixture('errors/rate-limit-secondly.json'), { ...rateHeaders, ...headers })
  // Retry-After 2 s; the bucket refills one token per second, so the retry goes out at 2 s.
  const fast = fakeFetch(limited({ 'retry-after': '2' }), jsonResponse(200, { results: [] }))
  const first = client(fast.fetch).request(list)
  await vi.advanceTimersByTimeAsync(1999)
  expect(fast.calls).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(fast.calls).toHaveLength(2)
  await expect(first).resolves.toEqual({ results: [] })
  // Retry-After 1 s, but the bucket refills one token per 4 s, so the retry waits for the bucket.
  const slow = fakeFetch(
    limited({
      'retry-after': '1',
      'x-hubspot-ratelimit-max': '1',
      'x-hubspot-ratelimit-interval-milliseconds': '4000',
    }),
    jsonResponse(200, { results: [] }),
  )
  const second = client(slow.fetch).request(list)
  await vi.advanceTimersByTimeAsync(3999)
  expect(slow.calls).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(slow.calls).toHaveLength(2)
  await expect(second).resolves.toEqual({ results: [] })
})

test('429 gives up after three retries with E_RATE_LIMIT', async () => {
  const limited = () => jsonResponse(429, fixture('errors/rate-limit-secondly.json'), { 'retry-after': '1' })
  const { fetch, calls } = fakeFetch(limited(), limited(), limited(), limited())
  const pending = client(fetch)
    .request(list)
    .catch((e: unknown) => e)
  await vi.advanceTimersByTimeAsync(10_000)
  const error = await pending
  expect(error).toBeInstanceOf(HubSpotApiError)
  expect((error as HubSpotApiError).issues[0]?.code).toBe('E_RATE_LIMIT')
  expect((error as HubSpotApiError).status).toBe(429)
  expect(calls).toHaveLength(4)
})

test('a DAILY 429 is not retried and names the portal midnight', async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(429, fixture('errors/rate-limit-daily.json')))
  const http = client(fetch)
  http.timeZone = 'Europe/Ljubljana'
  const error = await http.request(list).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(HubSpotApiError)
  const api = error as HubSpotApiError
  expect(api.issues[0]?.code).toBe('E_DAILY_LIMIT')
  expect(api.retryAfter).toBe('2026-09-22T22:00:00.000Z')
  expect(api.category).toBe('RATE_LIMITS')
  expect(api.correlationId).toBe('5e2f1c0a-7b3d-4e8a-9f61-2c4d8b0a1e77')
  expect(calls).toHaveLength(1)
})

test('portalMidnight is the next local midnight as UTC', () => {
  const now = new Date('2026-09-22T10:00:00Z')
  expect(portalMidnight(now, 'UTC')).toBe('2026-09-23T00:00:00.000Z')
  expect(portalMidnight(now, 'Europe/Ljubljana')).toBe('2026-09-22T22:00:00.000Z')
  expect(portalMidnight(now, 'America/New_York')).toBe('2026-09-23T04:00:00.000Z')
})

test('5xx is retried up to three times', async () => {
  const { fetch, calls } = fakeFetch(
    jsonResponse(500),
    jsonResponse(502),
    jsonResponse(503),
    jsonResponse(200, { results: [] }),
  )
  const pending = client(fetch).request(list)
  await vi.advanceTimersByTimeAsync(5000)
  await expect(pending).resolves.toEqual({ results: [] })
  expect(calls).toHaveLength(4)
})

test('5xx fails after the retry cap with E_HTTP', async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(503), jsonResponse(503), jsonResponse(503), jsonResponse(503))
  const pending = client(fetch)
    .request(list)
    .catch((e: unknown) => e)
  await vi.advanceTimersByTimeAsync(5000)
  const error = (await pending) as HubSpotApiError
  expect(error.issues[0]?.code).toBe('E_HTTP')
  expect(error.status).toBe(503)
  expect(calls).toHaveLength(4)
})

test('the bucket follows the rate-limit headers', async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(200, {}, rateHeaders))
  const warn = vi.fn()
  const http = client(fetch, warn)
  await http.request(list)
  const second = http.request(list)
  await vi.advanceTimersByTimeAsync(999)
  expect(calls).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(2)
  await second
  expect(warn).not.toHaveBeenCalled()
})

test('a remaining count above zero lets that many requests go at once', async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(200, {}, { ...rateHeaders, 'x-hubspot-ratelimit-remaining': '3' }))
  const http = client(fetch)
  await http.request(list)
  const pending = Array.from({ length: 4 }, () => http.request(list))
  await vi.advanceTimersByTimeAsync(0)
  expect(calls).toHaveLength(4)
  await vi.advanceTimersByTimeAsync(999)
  expect(calls).toHaveLength(4)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(5)
  await Promise.all(pending)
})

test('without headers the bucket allows 8 requests per second and warns once', async () => {
  const { fetch, calls } = fakeFetch()
  const warn = vi.fn()
  const http = client(fetch, warn)
  const pending = Array.from({ length: 9 }, () => http.request(list))
  await vi.advanceTimersByTimeAsync(124)
  expect(calls).toHaveLength(8)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(9)
  await Promise.all(pending)
  expect(warn).toHaveBeenCalledTimes(1)
  expect(warn.mock.calls[0]?.[0]).toContain('8 requests per second')
})

test('daily remaining comes from the header or stays null', async () => {
  const { fetch } = fakeFetch(
    jsonResponse(200),
    jsonResponse(200, {}, { 'x-hubspot-ratelimit-daily-remaining': '4990' }),
  )
  const http = client(fetch)
  await http.request(list)
  expect(http.dailyRemaining).toBeNull()
  await http.request(list)
  expect(http.dailyRemaining).toBe(4990)
})

test('401 is E_AUTH and names the scope for the object, the exception where HubSpot has one', async () => {
  const { fetch } = fakeFetch(jsonResponse(401, fixture('errors/unauthorized.json')))
  const error = (await client(fetch)
    .request(list)
    .catch((e: unknown) => e)) as HubSpotApiError
  expect(error).toBeInstanceOf(HubSpotApiError)
  expect(error.issues[0]?.code).toBe('E_AUTH')
  expect(error.issues[0]?.fix).toContain('crm.schemas.companies.read')
  expect(error.status).toBe(401)
  expect(error.category).toBe('INVALID_AUTHENTICATION')
  const products = fakeFetch(jsonResponse(401, fixture('errors/unauthorized.json')))
  const again = (await client(products.fetch)
    .request({ type: 'property', path: 'list', params: { objectType: 'products' } })
    .catch((e: unknown) => e)) as HubSpotApiError
  expect(again.issues[0]?.fix).toContain('It needs the scope e-commerce.')
})

test('403 is E_SCOPE and names the standard, exception or custom scope', async () => {
  const cases: [HttpRequest, string][] = [
    [list, 'crm.schemas.companies.read'],
    [{ type: 'group', path: 'list', params: { objectType: 'deals' } }, 'crm.schemas.deals.read'],
    [{ type: 'property', path: 'list', params: { objectType: 'products' } }, 'e-commerce'],
    [{ type: 'group', path: 'list', params: { objectType: 'leads' } }, 'crm.objects.leads.read'],
    [{ type: 'property', path: 'list', params: { objectType: '2-12345' } }, 'crm.schemas.custom.read'],
    [{ type: 'object', path: 'list' }, 'crm.schemas.custom.read'],
  ]
  await Promise.all(
    cases.map(async ([req, scope]) => {
      const { fetch } = fakeFetch(jsonResponse(403, fixture('errors/missing-scope.json')))
      const error = (await client(fetch)
        .request(req)
        .catch((e: unknown) => e)) as HubSpotApiError
      expect(error.issues[0]?.code).toBe('E_SCOPE')
      expect(error.issues[0]?.message).toContain(scope)
      expect(error.issues[0]?.fix).toContain(scope)
      expect(error.category).toBe('MISSING_SCOPES')
    }),
  )
})

test('a 403 on account-info names no scope', async () => {
  const { fetch } = fakeFetch(jsonResponse(403, fixture('errors/missing-scope.json')))
  const error = (await client(fetch)
    .request({ type: 'accountInfo', path: 'read' })
    .catch((e: unknown) => e)) as HubSpotApiError
  expect(error.issues[0]?.code).toBe('E_SCOPE')
  expect(error.issues[0]?.message).not.toContain('crm.schemas')
})

test('a 2xx with a body that is not JSON is E_HTTP, not a SyntaxError', async () => {
  const html = new Response('<html><body>Proxy error</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })
  const { fetch } = fakeFetch(html)
  const error = (await client(fetch)
    .request(list)
    .catch((e: unknown) => e)) as HubSpotApiError
  expect(error).toBeInstanceOf(HubSpotApiError)
  expect(error.status).toBe(200)
  expect(error.issues).toEqual([
    {
      code: 'E_HTTP',
      message: 'HubSpot returned 200 for GET /crm/properties/2026-09/companies with a body that is not JSON.',
    },
  ])
})

test('HubSpotApiError carries status, category and correlationId and nothing else from the body', async () => {
  const body = { ...fixture('errors/unauthorized.json'), token: 'body-field-that-must-not-leak' }
  const { fetch } = fakeFetch(jsonResponse(401, body))
  const error = (await client(fetch)
    .request(list)
    .catch((e: unknown) => e)) as HubSpotApiError
  expect(error.category).toBe('INVALID_AUTHENTICATION')
  expect(error.correlationId).toBe('0f8e7d6c-5b4a-4321-9abc-def012345678')
  for (const text of [JSON.stringify(error), inspect(error, { depth: null }), error.stack ?? '']) {
    expect(text).not.toContain('body-field-that-must-not-leak')
  }
})

test('other 4xx fail at once with E_HTTP and the sanitized HubSpot message', async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(404, { message: 'Property \u001b[31mnot found\nreally' }))
  const error = (await client(fetch)
    .request(list)
    .catch((e: unknown) => e)) as HubSpotApiError
  expect(error.issues[0]?.code).toBe('E_HTTP')
  expect(error.issues[0]?.message).toContain('HubSpot said: Property not foundreally')
  expect(calls).toHaveLength(1)
})
