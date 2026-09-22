// Key hygiene: every failing path runs with a known key, and nothing that comes out carries it.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { resolveReadKey } from '../../src/lib/auth.js'
import { guardPortal } from '../../src/lib/guard.js'
import { createHttp, type Fetch, type HttpRequest } from '../../src/lib/http.js'
import { envelope, KalupError, printEnvelope } from '../../src/lib/output.js'
import { fakeFetch, fixture, jsonResponse } from '../../src/lib/testing.js'

const key = 'kalup-test-secret-9f2c'
const list: HttpRequest = { type: 'property', path: 'list', params: { objectType: 'companies' } }

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
afterEach(() => vi.useRealTimers())

type Warn = (message: string) => void

function http(fetch: Fetch, warn: Warn) {
  return createHttp({ key, fetch, warn })
}

async function exhausted(fetch: Fetch, warn: Warn) {
  const pending = http(fetch, warn).request(list)
  // The caller handles the rejection; this only keeps it from counting as unhandled while the timers run.
  pending.catch(() => undefined)
  await vi.advanceTimersByTimeAsync(10_000)
  return pending
}

const failures: Record<string, (warn: Warn) => Promise<unknown>> = {
  'write in read mode': (warn) => http(fakeFetch().fetch, warn).request({ ...list, path: 'create', body: {} }),
  '401': (warn) => http(fakeFetch(jsonResponse(401, fixture('errors/unauthorized.json'))).fetch, warn).request(list),
  '403': (warn) => http(fakeFetch(jsonResponse(403, fixture('errors/missing-scope.json'))).fetch, warn).request(list),
  'daily 429': (warn) =>
    http(fakeFetch(jsonResponse(429, fixture('errors/rate-limit-daily.json'))).fetch, warn).request(list),
  '429 exhausted': (warn) => {
    const limited = () => jsonResponse(429, fixture('errors/rate-limit-secondly.json'), { 'retry-after': '1' })
    return exhausted(fakeFetch(limited(), limited(), limited(), limited()).fetch, warn)
  },
  '5xx exhausted': (warn) =>
    exhausted(fakeFetch(jsonResponse(503), jsonResponse(503), jsonResponse(503), jsonResponse(503)).fetch, warn),
  '404': (warn) => http(fakeFetch(jsonResponse(404, { message: 'Not found' })).fetch, warn).request(list),
  'network failure': (warn) => http(() => Promise.reject(new TypeError('fetch failed')), warn).request(list),
  'portal mismatch': (warn) => {
    const { fetch } = fakeFetch(jsonResponse(200, { ...fixture('account-info.json'), portalId: 2_222_222 }))
    return guardPortal(http(fetch, warn), { name: 'sandbox', portalId: 1_111_111, variable: 'HUBSPOT_SERVICE_KEY' })
  },
  'missing key': () => {
    const dir = mkdtempSync(join(tmpdir(), 'kalup-hygiene-'))
    writeFileSync(join(dir, '.env'), `HUBSPOT_OTHER_KEY=${key}\n`)
    return Promise.resolve().then(() =>
      resolveReadKey({ credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } } }, dir, { HUBSPOT_OTHER_KEY: key }),
    )
  },
}

for (const [name, run] of Object.entries(failures)) {
  test(`${name}: the key appears in no error, envelope or printed text`, async () => {
    const captured: string[] = []
    const error = await run((message) => captured.push(message)).then(
      () => {
        throw new Error('expected the call to fail')
      },
      (e: unknown) => e,
    )
    captured.push(String(error), (error as Error).stack ?? '', JSON.stringify(error), inspect(error, { depth: null }))
    if (error instanceof KalupError) {
      const out = { write: (text: string) => captured.push(text) }
      printEnvelope(envelope(false, undefined, error.issues), out)
    }
    expect(captured.join('\n')).not.toContain(key)
    expect(captured.join('\n').length).toBeGreaterThan(0)
  })
}

test('the fallback warning carries no key', async () => {
  const warn = vi.fn()
  await createHttp({ key, fetch: fakeFetch().fetch, warn }).request(list)
  expect(JSON.stringify(warn.mock.calls)).not.toContain(key)
  expect(warn).toHaveBeenCalledTimes(1)
})
