// Key hygiene: every failing path runs with known keys, a read key and a write key, and nothing that comes out carries
// either of them.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import {
  createBucket,
  createHttp,
  createWriteHttp,
  type Fetch,
  guardPortal,
  type HttpRequest,
  KalupError,
  MILESTONE_3_WRITES,
  type SendOutcome,
  sanitize,
  type WriteRequest,
} from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fakeFetch, fixture, jsonResponse } from '../../../engine/test/support/testing.js'
import { resolveReadKey, resolveWriteKey } from '../../src/lib/auth.js'
import { openJournal } from '../../src/lib/journal.js'
import { envelope, printEnvelope } from '../../src/lib/output.js'

const key = 'kalup-test-secret-9f2c'
const writeKey = 'kalup-test-write-secret-4b1d'
const list: HttpRequest = { type: 'property', path: 'list', params: { objectType: 'companies' } }
const create: WriteRequest = {
  type: 'property',
  path: 'create',
  params: { objectType: 'companies' },
  body: { name: 'plot_count', label: 'Plot count', type: 'number', fieldType: 'number', groupName: 'orchard' },
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
afterEach(() => vi.useRealTimers())

type Warn = (message: string) => void

function http(fetch: Fetch, warn: Warn) {
  return createHttp({ key, fetch, warn })
}

function writer(fetch: Fetch, warn: Warn) {
  return createWriteHttp({ key: writeKey, fetch, warn, allow: MILESTONE_3_WRITES })
}

async function exhausted<T>(pending: Promise<T>) {
  // The caller handles the rejection; this only keeps it from counting as unhandled while the timers run.
  pending.catch(() => undefined)
  await vi.advanceTimersByTimeAsync(200_000)
  return pending
}

// A fetch that answers every request, any method, with a fresh copy of one answer.
function always(status: number, body?: unknown, headers: Record<string, string> = {}): Fetch {
  return () => Promise.resolve(jsonResponse(status, body, headers))
}

function project(dotenv: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-hygiene-'))
  writeFileSync(join(dir, '.env'), dotenv)
  return dir
}

const separate = { credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' }, write: { env: 'HUBSPOT_PROD_WRITE_KEY' } } }

const failures: Record<string, (warn: Warn) => Promise<unknown>> = {
  'write in read mode': (warn) =>
    // A write path is not a read request at the type level; this checks the refusal at run time.
    http(fakeFetch().fetch, warn).request({ ...list, path: 'create', body: {} } as unknown as HttpRequest),
  '401': (warn) => http(fakeFetch(jsonResponse(401, fixture('errors/unauthorized.json'))).fetch, warn).request(list),
  '403': (warn) => http(fakeFetch(jsonResponse(403, fixture('errors/missing-scope.json'))).fetch, warn).request(list),
  'daily 429': (warn) =>
    http(fakeFetch(jsonResponse(429, fixture('errors/rate-limit-daily.json'))).fetch, warn).request(list),
  '429 exhausted': (warn) => {
    const limited = () => jsonResponse(429, fixture('errors/rate-limit-secondly.json'), { 'retry-after': '1' })
    return exhausted(http(fakeFetch(limited(), limited(), limited(), limited()).fetch, warn).request(list))
  },
  '5xx exhausted': (warn) =>
    exhausted(
      http(fakeFetch(jsonResponse(503), jsonResponse(503), jsonResponse(503), jsonResponse(503)).fetch, warn).request(
        list,
      ),
    ),
  '404': (warn) => http(fakeFetch(jsonResponse(404, { message: 'Not found' })).fetch, warn).request(list),
  'an error body that echoes the key': (warn) =>
    http(fakeFetch(jsonResponse(401, { message: `Token ${key} is not valid` })).fetch, warn).request(list),
  'network failure': (warn) => exhausted(http(() => Promise.reject(new TypeError('fetch failed')), warn).request(list)),
  'network failure that echoes the key': (warn) =>
    exhausted(http(() => Promise.reject(new TypeError(`connect failed for Bearer ${key}`)), warn).request(list)),
  'read timeout': (warn) => exhausted(http(() => new Promise(() => undefined), warn).request(list)),
  'portal mismatch': (warn) => {
    const { fetch } = fakeFetch(jsonResponse(200, { ...fixture('account-info.json'), portalId: 2_222_222 }))
    return guardPortal(http(fetch, warn), { name: 'sandbox', portalId: 1_111_111, variable: 'HUBSPOT_SERVICE_KEY' })
  },
  'missing key': () => {
    const dir = project(`HUBSPOT_OTHER_KEY=${key}\n`)
    return Promise.resolve().then(() =>
      resolveReadKey({ credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } } }, dir, { HUBSPOT_OTHER_KEY: key }),
    )
  },
  'write not allowed': (warn) =>
    writer(always(201), warn).send({ type: 'object', path: 'create', body: { labels: writeKey } }),
  'read through the write client, echoing the write key': (warn) =>
    writer(always(401, { message: `Token ${writeKey} is not valid` }), warn).request(list),
  'a read error whose category and message hold the key JSON-escaped': (warn) =>
    http(
      () => Promise.resolve(new Response(`{"category":${escaped(key)},"message":${escaped(key)}}`, { status: 400 })),
      warn,
    ).request(list),
  'missing write key': () =>
    Promise.resolve().then(() =>
      resolveWriteKey(separate, project(`HUBSPOT_OTHER_KEY=${writeKey}\n`), { HUBSPOT_OTHER_KEY: writeKey }),
    ),
  '--approve with no separate write key': () =>
    Promise.resolve().then(() =>
      resolveWriteKey({}, project(''), { HUBSPOT_SERVICE_KEY: writeKey }, { envOnly: true }),
    ),
  '--approve with the write key in .env': () =>
    Promise.resolve().then(() =>
      resolveWriteKey(separate, project(`HUBSPOT_PROD_WRITE_KEY=${writeKey}\n`), {}, { envOnly: true }),
    ),
  'both keys, one bucket: a read and a write whose answers echo the key each was sent': async (warn) => {
    const bucket = createBucket()
    const echo: Fetch = (_, init) => {
      const sent = new Headers(init.headers).get('authorization') ?? ''
      return Promise.resolve(jsonResponse(400, { message: `rejected ${sent}`, category: sent, correlationId: sent }))
    }
    const read = createHttp({ key, fetch: echo, warn, bucket })
    const write = createWriteHttp({ key: writeKey, fetch: echo, warn, bucket, allow: MILESTONE_3_WRITES })
    const outcome = await write.send(create)
    warn(JSON.stringify(outcome))
    warn(inspect(outcome, { depth: null }))
    return read.request(list)
  },
}

for (const [name, run] of Object.entries(failures)) {
  test(`${name}: neither key appears in any error, envelope or printed text`, async () => {
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
    const printed = captured.join('\n')
    expect(printed).not.toContain(key)
    expect(printed).not.toContain(writeKey)
    expect(printed.length).toBeGreaterThan(0)
  })
}

const echoes = `Token ${writeKey} is not valid`
const outcomes: Record<string, () => Fetch> = {
  ok: () => always(201, { name: 'plot_count', note: echoes }),
  rejected: () => always(400, { message: echoes, category: writeKey, correlationId: writeKey }),
  'rejected, 403': () => always(403, { message: echoes }),
  wait: () => always(429, { message: echoes, policyName: 'SECONDLY' }),
  'daily wait': () => always(429, { message: echoes, policyName: 'DAILY' }),
  'uncertain, 5xx': () => always(502, { message: echoes }),
  'uncertain, unreadable': () => () => Promise.resolve(new Response(`<html>${writeKey}</html>`, { status: 200 })),
  'uncertain, network': () => () => Promise.reject(new TypeError(`connect failed for Bearer ${writeKey}`)),
  // The key spelled with a JSON escape, or split by a control character that sanitizing removes.
  'ok, the key JSON-escaped': () => () =>
    Promise.resolve(new Response(`{"label":${escaped(writeKey)},${escaped(writeKey)}:1}`, { status: 201 })),
  'rejected, the key JSON-escaped': () => () =>
    Promise.resolve(new Response(`{"message":${escaped(writeKey)},"category":${escaped(writeKey)}}`, { status: 400 })),
  'rejected, the key split by a control character': () =>
    always(400, { message: `Token ${split(writeKey)}`, category: split(writeKey), correlationId: split(writeKey) }),
}

// A JSON string literal of `text` with every character written as a \u escape.
function escaped(text: string): string {
  return `"${Array.from(text, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')}"`
}

// `text` with a bell character and an ANSI colour in its middle.
function split(text: string): string {
  const half = Math.floor(text.length / 2)
  return `${text.slice(0, half)}\u0007\u001b[31m${text.slice(half)}`
}

for (const [name, fetch] of Object.entries(outcomes)) {
  test(`a send outcome (${name}) carries no key`, async () => {
    const outcome: SendOutcome = await writer(fetch(), () => undefined).send(create)
    const text = [JSON.stringify(outcome), inspect(outcome, { depth: null })].join('\n')
    expect(text).not.toContain(writeKey)
    expect(text).toContain(outcome.kind)
    // Nor does any string in it, once a terminal's sanitizing has removed its control characters.
    for (const value of strings(outcome)) {
      expect(sanitize(value, Number.POSITIVE_INFINITY)).not.toContain(writeKey)
    }
  })
}

// Every string in a value, object keys included.
function strings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (typeof value !== 'object' || value === null) {
    return []
  }
  return Object.entries(value).flatMap(([name, item]) => [name, ...strings(item)])
}

test('a send that times out carries no key', async () => {
  const pending = writer(
    () => new Promise(() => undefined),
    () => undefined,
  ).send(create)
  await vi.advanceTimersByTimeAsync(30_000)
  const outcome = await pending
  expect(outcome).toEqual({ kind: 'uncertain', reason: 'timeout' })
})

test('inspecting either client shows no key', () => {
  const read = createHttp({ key, fetch: fakeFetch().fetch, warn: () => undefined })
  const write = createWriteHttp({ key: writeKey, fetch: always(200), warn: () => undefined, allow: MILESTONE_3_WRITES })
  const text = [inspect(read, { depth: null, showHidden: true }), inspect(write, { depth: null, showHidden: true })]
  expect(text.join('\n')).not.toContain(key)
  expect(text.join('\n')).not.toContain(writeKey)
})

test('the journal refuses a line that holds either key, and its file never holds one', () => {
  const state = join(mkdtempSync(join(tmpdir(), 'kalup-hygiene-')), 'state')
  const journal = openJournal(state, {
    planId: 'pl_7f3a1c07b2e4',
    writesHash: `sha256:${'a'.repeat(64)}`,
    portalId: 1_111_111,
    approval: 'terminal',
    keys: [key, writeKey],
  })
  const entry = {
    at: '2026-09-24T10:00:00.000Z',
    step: 's1',
    address: 'property:companies/plot_count',
    method: 'POST',
    path: '/crm/properties/2026-09/{objectType}',
    status: 201,
    outcome: 'ok' as const,
    ms: 12,
  }
  expect(() => journal.append({ ...entry, correlationId: writeKey })).toThrow(
    'refusing to journal a line that holds a key',
  )
  expect(() => journal.append({ ...entry, category: `x${key}y` })).toThrow(
    'refusing to journal a line that holds a key',
  )
  expect(existsSync(journal.path)).toBe(false)
  journal.append(entry)
  const text = readFileSync(journal.path, 'utf8')
  expect(text).not.toContain(key)
  expect(text).not.toContain(writeKey)
})

test('the fallback warning carries no key', async () => {
  const warn = vi.fn()
  await createHttp({ key, fetch: fakeFetch().fetch, warn }).request(list)
  expect(JSON.stringify(warn.mock.calls)).not.toContain(key)
  expect(warn).toHaveBeenCalledTimes(1)
})
