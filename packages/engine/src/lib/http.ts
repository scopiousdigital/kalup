// The one choke point for HubSpot requests. createHttp reads: a write-tagged path never leaves it. createWriteHttp adds
// `send`, which sends a write its allowlist names exactly once and reports what is known of the outcome.
import { type Issue, KalupError } from './errors.js'
import {
  type Endpoint,
  fillPath,
  type Registry,
  type RegistryRow,
  type RegistryType,
  readScope,
  registry,
  type Tag,
  writeScope,
} from './registry.js'
import { sanitize } from './sanitize.js'

export const baseUrl = 'https://api.hubapi.com'

// Rate-limit header names, in one table. A service key's answers carry all of them (live runs, 2026-09-29 and 2026-10-01).
const rateHeaders = {
  max: 'x-hubspot-ratelimit-max',
  remaining: 'x-hubspot-ratelimit-remaining',
  interval: 'x-hubspot-ratelimit-interval-milliseconds',
  daily: 'x-hubspot-ratelimit-daily-remaining',
} as const

// A count of requests left today. Anything else in the daily header (empty, fractional, negative) counts as absent.
const COUNT = /^\d+$/

const maxRetries = 3
/** How long one attempt may take, answer and body, before it counts as unanswered. */
export const defaultTimeoutMs = 30_000
/** The longest Retry-After Kalup waits out. */
const maxRetryAfterMs = 60_000
/** HubSpot's error handling page: "Locks will last for 2 seconds". */
const lockWaitMs = 2000
/** A 429 or 477 that names no Retry-After. */
const defaultWaitMs = 1000
const fallback = { capacity: 8, intervalMs: 1000 }
const fallbackWarning = 'HubSpot sent no rate-limit headers. Sending at most 8 requests per second.'

// The path names of one registry row that carry the tag, taken from the `as const` registry.
type PathOf<K extends RegistryType, T extends Tag> = {
  [P in keyof Registry[K]['paths']]: Registry[K]['paths'][P] extends { tag: T } ? P : never
}[keyof Registry[K]['paths']] &
  string

type RequestOf<T extends Tag> = {
  [K in RegistryType]: {
    type: K
    path: PathOf<K, T>
    params?: Record<string, string>
    query?: Record<string, string>
    body?: unknown
  }
}[RegistryType]

/** A request to a read-tagged path. A write-tagged path does not type-check, and `request` refuses it at run time. */
export type HttpRequest = RequestOf<'read'>
/** A request to a write-tagged path, for `send`. */
export type WriteRequest = RequestOf<'write'>
/** One write a write client may send: a registry type and one of its write-tagged path names. */
export type WriteRoute = { [K in RegistryType]: { type: K; path: PathOf<K, 'write'> } }[RegistryType]

/**
 * The writes apply sends: custom object schemas (create, update, archive), properties, property groups, pipelines and
 * stages. No schema purge, and no pipeline or stage PUT, which the registry does not name.
 */
export const MILESTONE_3_WRITES: readonly WriteRoute[] = [
  { type: 'object', path: 'create' },
  { type: 'object', path: 'update' },
  { type: 'object', path: 'delete' },
  { type: 'property', path: 'create' },
  { type: 'property', path: 'update' },
  { type: 'property', path: 'delete' },
  { type: 'group', path: 'create' },
  { type: 'group', path: 'update' },
  { type: 'group', path: 'delete' },
  { type: 'pipeline', path: 'create' },
  { type: 'pipeline', path: 'update' },
  { type: 'pipeline', path: 'delete' },
  { type: 'stage', path: 'create' },
  { type: 'stage', path: 'update' },
  { type: 'stage', path: 'delete' },
]

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** The pacing of one portal's requests and the daily figure its answers report. Clients of one portal share one. */
export interface Bucket {
  /** From X-HubSpot-RateLimit-Daily-Remaining on any answer, or null while no answer reported it. */
  dailyRemaining: number | null
  /** Follows the rate-limit headers of an answer. The first answer without them warns, once per bucket. */
  observe: (headers: Headers, warn: (message: string) => void) => void
  /** Waits until a request may go. */
  take: () => Promise<void>
}

export interface HttpOptions {
  /** Shared with the other clients of the same portal, so their requests are paced together. */
  bucket?: Bucket
  /** How requests go out. Default: the runtime's global fetch. */
  fetch?: Fetch
  key: string
  /** Per attempt, answer and body included. Default 30 s. */
  timeoutMs?: number
  /** Where the rate-limit fallback warning goes. The host decides: the engine never writes to stderr itself. */
  warn: (message: string) => void
}

export interface WriteHttpOptions extends HttpOptions {
  /** The writes `send` may send. Any other path is refused before anything is sent. */
  allow: readonly WriteRoute[]
}

export interface HttpClient {
  /** From X-HubSpot-RateLimit-Daily-Remaining, or null when the key does not report it. */
  readonly dailyRemaining: number | null
  request: <T = unknown>(req: HttpRequest) => Promise<T>
  /** The account's time zone, set by the portal guard. Sets the daily limit reset time. */
  timeZone: string
}

/**
 * What one write request is known to have done. `ok`: a 2xx with a readable body (none for a 204). `rejected`: a
 * definite 4xx, with HubSpot's category and subCategory when it sent them. `wait`: a rate limit (429), a lock (423)
 * or HubSpot's 477, to wait out before reading and trying again. `uncertain`: a timeout, a network failure, a 5xx or a
 * 2xx whose body is not JSON, which may or may not have landed.
 */
export type SendOutcome =
  | { kind: 'ok'; status: number; body: unknown }
  | {
      kind: 'rejected'
      status: number
      category?: string
      correlationId?: string
      message: string
      subCategory?: string
      /** HubSpot's `context`, string lists by name, such as `usageCount` on a property in use. */
      context?: ErrorContext
      /** HubSpot's `errors`, one per cause, such as each use of a property in use (at most 50). */
      errors?: ErrorDetail[]
    }
  | { kind: 'wait'; status: number; daily: boolean; waitMs: number }
  | { kind: 'uncertain'; reason: 'timeout' | 'network' | 'server' | 'unreadable'; status?: number }

/**
 * One attempt of a read. `done` with the body; `retry` when a 429, a 5xx, a timeout or a network failure may clear
 * after `waitMs`, with the status when HubSpot answered. Past the retries `request` makes, the error `request` throws.
 */
export type ReadAttempt<T> = { kind: 'done'; value: T } | { kind: 'retry'; status?: number; waitMs: number }

export interface WriteHttpClient extends HttpClient {
  /**
   * One attempt of the read `request` makes; `attempt` counts those before it. Apply waits and tries again itself, so
   * it journals every attempt and checks its signal between them.
   */
  readOnce: <T = unknown>(req: HttpRequest, attempt: number) => Promise<ReadAttempt<T>>
  /** Sends one allowed write once. Never resends, and never throws for an HTTP outcome. */
  send: (req: WriteRequest) => Promise<SendOutcome>
}

/** HubSpot's `context` on an error body: string lists by name, every string quoted and the key cut out. */
export type ErrorContext = Record<string, string[]>

/** One entry of HubSpot's `errors` on an error body, the fields Kalup reads, quoted. */
export interface ErrorDetail {
  context?: ErrorContext
  message?: string
  subCategory?: string
}

interface ErrorBody {
  category?: string
  context?: ErrorContext
  correlationId?: string
  errors?: ErrorDetail[]
  message?: string
  policyName?: string
  subCategory?: string
}

/** How many `errors` entries an outcome keeps: a property used in hundreds of places must not balloon it. */
const ERRORS_MAX = 50

export class HubSpotApiError extends KalupError {
  readonly status: number
  readonly category: string | undefined
  readonly correlationId: string | undefined
  /** ISO time after which the request may succeed. Set for E_DAILY_LIMIT. */
  readonly retryAfter: string | undefined

  constructor(issue: Issue, status: number, body: ErrorBody, retryAfter?: string) {
    super(issue)
    this.name = 'HubSpotApiError'
    this.status = status
    this.category = body.category
    this.correlationId = body.correlationId
    this.retryAfter = retryAfter
  }
}

/**
 * Creates a read-mode client. Refuses write-tagged paths, retries 429, 5xx, timeouts and network failures, and paces
 * requests with a token bucket.
 */
export function createHttp(options: HttpOptions): HttpClient {
  return readClient(options).client
}

// The read client and its single attempt, which a write client exposes as readOnce.
function readClient(options: HttpOptions): {
  client: HttpClient
  readOnce: <T>(req: HttpRequest, attempt: number) => Promise<ReadAttempt<T>>
} {
  const { key, fetch = globalThis.fetch, warn, bucket = createBucket() } = options
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs

  async function readOnce<T>(req: HttpRequest, attempt: number): Promise<ReadAttempt<T>> {
    const endpoint = endpointOf(req)
    if (endpoint.tag !== 'read') {
      throw new KalupError({
        code: 'E_WRITE_IN_READ_MODE',
        message: `${endpoint.method} ${endpoint.path} is a write path and this client only reads.`,
      })
    }
    const { url, init } = build(endpoint, req, key)
    const context: ReadContext = {
      method: endpoint.method,
      path: url.pathname,
      key,
      timeoutMs,
      timeZone: client.timeZone,
      scope: readScope(registry[req.type], req.params?.objectType),
    }
    await bucket.take()
    const answer = await exchange(fetch, url.toString(), init, timeoutMs, key)
    if (answer.kind === 'answered') {
      bucket.observe(answer.headers, warn)
    }
    const step = readStep(answer, attempt, context)
    if (step.kind === 'done') {
      return { kind: 'done', value: step.value as T }
    }
    return answer.kind === 'answered' ? { ...step, status: answer.status } : step
  }

  const client: HttpClient = {
    timeZone: 'UTC',
    get dailyRemaining() {
      return bucket.dailyRemaining
    },

    async request<T>(req: HttpRequest): Promise<T> {
      for (let attempt = 0; ; attempt += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: retries to HubSpot are serial on purpose, each one waits out the rate limit or error of the last
        const step = await readOnce<T>(req, attempt)
        if (step.kind === 'done') {
          return step.value
        }
        // A 429 that also carried rate headers drained the bucket, which refills during this sleep, so the retry
        // waits for the longer.
        await sleep(step.waitMs)
      }
    },
  }
  return { client, readOnce }
}

/**
 * Creates a client for a run that writes: the read `request` of createHttp, sent with the same key, and `send` for
 * the writes `allow` names. Anything else, a read path included, is E_WRITE_NOT_ALLOWED before anything is sent.
 */
export function createWriteHttp(options: WriteHttpOptions): WriteHttpClient {
  const { key, fetch = globalThis.fetch, warn, bucket = createBucket(), allow } = options
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  const { client, readOnce } = readClient({ key, fetch, warn, bucket, timeoutMs })
  const allowed = new Set(allow.map((route) => `${route.type}.${route.path}`))

  async function send(req: WriteRequest): Promise<SendOutcome> {
    const endpoint = endpointOf(req)
    if (!(endpoint.tag === 'write' && allowed.has(`${req.type}.${req.path}`))) {
      throw new KalupError({
        code: 'E_WRITE_NOT_ALLOWED',
        message: `${endpoint.method} ${endpoint.path} (${req.type} ${req.path}) is not a write this run may send. Nothing was sent.`,
      })
    }
    // No write Kalup sends takes a query: one would purge an archived schema (archived=true) or delete a pipeline or a
    // stage records sit in (validate...BeforeDelete=false).
    if (Object.keys(req.query ?? {}).length > 0) {
      throw new KalupError({
        code: 'E_WRITE_NOT_ALLOWED',
        message: `${endpoint.method} ${endpoint.path} (${req.type} ${req.path}) carries a query, and no write this run sends takes one. Nothing was sent.`,
      })
    }
    const { url, init } = build(endpoint, req, key)
    await bucket.take()
    const answer = await exchange(fetch, url.toString(), init, timeoutMs, key)
    if (answer.kind !== 'answered') {
      return { kind: 'uncertain', reason: answer.kind }
    }
    bucket.observe(answer.headers, warn)
    const scope = writeScope(registry[req.type], req.params?.objectType)
    return outcomeOf(answer, { method: endpoint.method, path: url.pathname, key, scope, timeZone: client.timeZone })
  }

  return Object.assign(client, { readOnce, send })
}

/** A token bucket at 8 requests per second until HubSpot's rate-limit headers say otherwise. */
export function createBucket(): Bucket {
  let { capacity, intervalMs } = fallback
  let tokens = capacity
  let last = Date.now()
  let informed = false

  function refill(): void {
    const now = Date.now()
    tokens = Math.min(capacity, tokens + ((now - last) * capacity) / intervalMs)
    last = now
  }

  const bucket: Bucket = {
    dailyRemaining: null,
    async take(): Promise<void> {
      refill()
      while (tokens < 1) {
        // biome-ignore lint/performance/noAwaitInLoops: requests to HubSpot are paced on purpose, a caller waits here until the rate-limit bucket refills
        await sleep(Math.ceil(((1 - tokens) * intervalMs) / capacity))
        refill()
      }
      tokens -= 1
    },
    observe(headers, warn): void {
      const daily = headers.get(rateHeaders.daily)?.trim() ?? ''
      if (COUNT.test(daily) && Number.isSafeInteger(Number(daily))) {
        bucket.dailyRemaining = Number(daily)
      }
      const max = Number(headers.get(rateHeaders.max))
      const remaining = Number(headers.get(rateHeaders.remaining))
      const interval = Number(headers.get(rateHeaders.interval))
      if (max > 0 && interval > 0 && Number.isFinite(remaining)) {
        capacity = max
        intervalMs = interval
        tokens = remaining
        last = Date.now()
        informed = true
      } else if (!informed) {
        informed = true
        warn(fallbackWarning)
      }
    },
  }
  return bucket
}

interface AnyRequest {
  body?: unknown
  params?: Record<string, string>
  path: string
  query?: Record<string, string>
  type: RegistryType
}

function endpointOf(req: AnyRequest): Endpoint {
  const row: RegistryRow = registry[req.type]
  const endpoint = row.paths[req.path]
  if (!endpoint) {
    throw new Error(`Unknown path ${req.path} on ${req.type}`)
  }
  return endpoint
}

function build(endpoint: Endpoint, req: AnyRequest, key: string): { url: URL; init: RequestInit } {
  const url = new URL(fillPath(endpoint.path, req.params ?? {}), baseUrl)
  for (const [name, value] of Object.entries(req.query ?? {})) {
    url.searchParams.set(name, value)
  }
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: 'application/json' }
  if (req.body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  const init: RequestInit = { method: endpoint.method, headers }
  if (req.body !== undefined) {
    init.body = JSON.stringify(req.body)
  }
  return { url, init }
}

interface Answered {
  headers: Headers
  kind: 'answered'
  status: number
  text: string
}
type Exchange = Answered | { kind: 'timeout' } | { kind: 'network'; message: string }

// One attempt, answer and body, within the timeout. The signal aborts the request; the race settles even when the
// request ignores it. The key is cut out of the body and of any network error's text, so nothing downstream holds it;
// parseJson cuts it again from the decoded strings, where a JSON escape could have hidden it.
async function exchange(
  fetch: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  key: string,
): Promise<Exchange> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<Exchange>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'timeout' })
      controller.abort()
    }, timeoutMs)
  })
  const answered = (async (): Promise<Exchange> => {
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      return { kind: 'answered', status: res.status, headers: res.headers, text: scrub(await res.text(), key) }
    } catch (error) {
      return { kind: 'network', message: quote(error instanceof Error ? error.message : String(error), key) }
    }
  })()
  try {
    return await Promise.race([answered, expired])
  } finally {
    clearTimeout(timer)
  }
}

function scrub(text: string, key: string): string {
  return key === '' ? text : text.split(key).join('[key]')
}

// Portal or network text for a message: the key cut out as it is, then the control characters stripped, then the key
// cut out again both as it is and as sanitizing leaves it, so neither a control character inside the key, one the text
// splits it with, nor the length cap can let it through.
function quote(text: string, key: string, max = 120): string {
  const clean = sanitize(scrub(text, key), Number.POSITIVE_INFINITY)
  return sanitize(scrub(scrub(clean, key), sanitize(key, Number.POSITIVE_INFINITY)), max)
}

// Every string of a decoded body, object keys included, with the key cut out.
function scrubJson(value: unknown, key: string): unknown {
  if (typeof value === 'string') {
    return scrub(value, key)
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubJson(item, key))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [scrub(name, key), scrubJson(item, key)]))
  }
  return value
}

interface ReadContext {
  key: string
  method: string
  path: string
  scope: string | undefined
  timeoutMs: number
  timeZone: string
}

type ReadStep = { kind: 'done'; value: unknown } | { kind: 'retry'; waitMs: number }

// What one read attempt comes to: the body, a retry after a wait, or the error it throws. A 429, a 5xx, a timeout and
// a network failure are retried up to maxRetries times; a daily 429 never is.
function readStep(answer: Exchange, attempt: number, context: ReadContext): ReadStep {
  const { method, path, key } = context
  const retry = attempt < maxRetries
  if (answer.kind !== 'answered') {
    if (retry) {
      return { kind: 'retry', waitMs: backoff(attempt) }
    }
    throw unreachable(method, path, answer, context.timeoutMs)
  }
  const { status } = answer
  if (status >= 200 && status < 300) {
    return { kind: 'done', value: status === 204 ? undefined : readJson(answer, method, path, key) }
  }
  const body = errorBody(answer.text, key)
  if (status === 429 && body.policyName === 'DAILY') {
    const retryAfter = portalMidnight(new Date(), context.timeZone)
    const issue = {
      code: 'E_DAILY_LIMIT',
      message: 'The portal has used its daily API limit.',
      fix: `Try again after ${retryAfter}.`,
    } satisfies Issue
    throw new HubSpotApiError(issue, status, body, retryAfter)
  }
  if ((status === 429 || status >= 500) && retry) {
    return { kind: 'retry', waitMs: retryAfterMs(answer.headers) ?? backoff(attempt) }
  }
  throw new HubSpotApiError(issueOf(status, body, method, path, key, context.scope), status, body)
}

// E_UNREACHABLE after the retries. The cause is not kept.
function unreachable(
  method: string,
  path: string,
  failure: Exclude<Exchange, Answered>,
  timeoutMs: number,
): KalupError {
  const why = failure.kind === 'timeout' ? `no answer within ${timeoutMs / 1000} s` : sanitize(failure.message)
  return new KalupError({
    code: 'E_UNREACHABLE',
    message: `${method} ${path} got no answer from HubSpot in ${maxRetries + 1} attempts: ${why}`,
    fix: 'Check the network connection and any proxy, then run the command again.',
  })
}

interface OutcomeContext {
  key: string
  method: string
  path: string
  scope: string | undefined
  timeZone: string
}

function outcomeOf(answer: Answered, context: OutcomeContext): SendOutcome {
  const { status, headers, text } = answer
  if (status >= 200 && status < 300) {
    if (status === 204) {
      return { kind: 'ok', status, body: undefined }
    }
    const body = parseJson(text, context.key)
    return body === notJson ? { kind: 'uncertain', reason: 'unreadable', status } : { kind: 'ok', status, body }
  }
  const body = errorBody(text, context.key)
  if (status === 429) {
    const daily = body.policyName === 'DAILY'
    const midnight = Date.parse(portalMidnight(new Date(), context.timeZone))
    const waitMs = daily ? Math.max(0, midnight - Date.now()) : (retryAfterMs(headers) ?? defaultWaitMs)
    return { kind: 'wait', status, daily, waitMs }
  }
  if (status === 423) {
    return { kind: 'wait', status, daily: false, waitMs: lockWaitMs }
  }
  if (status === 477) {
    return { kind: 'wait', status, daily: false, waitMs: retryAfterMs(headers) ?? defaultWaitMs }
  }
  if (status >= 400 && status < 500) {
    return rejectedOf(status, body, context)
  }
  return { kind: 'uncertain', reason: 'server', status }
}

// HubSpot's message in a rejected outcome runs to the length apply caps its issue message at, so a count at its end,
// such as the uses of a property in use, survives a long property name.
const REJECTED_MESSAGE_MAX = 400

// A definite 4xx: HubSpot's category, subCategory and correlation ID when it sent them, and the issue's message.
function rejectedOf(status: number, body: ErrorBody, context: OutcomeContext): SendOutcome {
  const { key, method, path, scope } = context
  const { category, correlationId, subCategory, context: fields, errors } = body
  return {
    kind: 'rejected',
    status,
    ...(category === undefined ? {} : { category }),
    ...(subCategory === undefined ? {} : { subCategory }),
    ...(correlationId === undefined ? {} : { correlationId }),
    message: issueOf(status, body, method, path, key, scope, REJECTED_MESSAGE_MAX).message,
    ...(fields === undefined ? {} : { context: fields }),
    ...(errors === undefined ? {} : { errors }),
  }
}

// Retry-After in seconds, capped; an HTTP-date is NaN and counts as absent.
function retryAfterMs(headers: Headers): number | undefined {
  const seconds = Number(headers.get('retry-after'))
  return seconds > 0 ? Math.min(seconds * 1000, maxRetryAfterMs) : undefined
}

function backoff(attempt: number): number {
  return 250 * 2 ** attempt + Math.floor(Math.random() * 250)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const notJson = Symbol('not JSON')

// A 2xx whose body is not JSON (an HTML page from a proxy) is E_HTTP, not a bare SyntaxError. The SyntaxError is not
// kept as the cause: its message quotes the start of the body, and nothing from the body rides on the error.
function readJson(answer: Answered, method: string, path: string, key: string): unknown {
  const body = parseJson(answer.text, key)
  if (body === notJson) {
    const message = `HubSpot returned ${answer.status} for ${method} ${path} with a body that is not JSON.`
    throw new HubSpotApiError({ code: 'E_HTTP', message }, answer.status, {})
  }
  return body
}

function parseJson(text: string, key: string): unknown {
  try {
    return scrubJson(JSON.parse(text), key)
  } catch {
    return notJson
  }
}

// The error fields that are strings. HubSpot's error handling page says to treat every field as optional, and a proxy
// can send any shape. The category, subCategory and correlation ID are quoted here; the message where it is used.
// HubSpot refused a group archive with its error body nested, as JSON text, in `message` (observed on 2026-09-29): the
// nested fields fill in what the outer body lacks, and the nested message replaces the JSON text.
function errorBody(text: string, key: string): ErrorBody {
  const outer = fieldsOf(parseJson(text, key), key)
  const inner = outer.message === undefined ? {} : fieldsOf(parseJson(outer.message, key), key)
  return { ...inner, ...outer, ...(inner.message === undefined ? {} : { message: inner.message }) }
}

function fieldsOf(body: unknown, key: string): ErrorBody {
  if (typeof body !== 'object' || body === null) {
    return {}
  }
  const { category, context, correlationId, errors, message, policyName, subCategory } = body as Record<string, unknown>
  const fields = contextOf(context, key)
  const details = Array.isArray(errors) ? errors.slice(0, ERRORS_MAX).map((item) => detailOf(item, key)) : undefined
  return {
    ...(typeof category === 'string' ? { category: quote(category, key) } : {}),
    ...(typeof subCategory === 'string' ? { subCategory: quote(subCategory, key) } : {}),
    ...(typeof correlationId === 'string' ? { correlationId: quote(correlationId, key) } : {}),
    ...(typeof message === 'string' ? { message } : {}),
    ...(typeof policyName === 'string' ? { policyName } : {}),
    ...(fields === undefined ? {} : { context: fields }),
    ...(details === undefined ? {} : { errors: details }),
  }
}

// HubSpot's `context`: only the entries that are lists of strings, each string and each name quoted.
function contextOf(context: unknown, key: string): ErrorContext | undefined {
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    return undefined
  }
  const out: ErrorContext = {}
  for (const [name, value] of Object.entries(context)) {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      out[quote(name, key)] = value.map((item) => quote(item, key))
    }
  }
  return out
}

// One `errors` entry: its subCategory, message and context, quoted; anything else is dropped.
function detailOf(item: unknown, key: string): ErrorDetail {
  if (typeof item !== 'object' || item === null) {
    return {}
  }
  const { context, message, subCategory } = item as Record<string, unknown>
  const fields = contextOf(context, key)
  return {
    ...(typeof subCategory === 'string' ? { subCategory: quote(subCategory, key) } : {}),
    ...(typeof message === 'string' ? { message: quote(message, key) } : {}),
    ...(fields === undefined ? {} : { context: fields }),
  }
}

// HubSpot's own message is quoted, with the key cut out in case the body echoes it back, up to `max` characters.
function issueOf(
  status: number,
  body: ErrorBody,
  method: string,
  path: string,
  key: string,
  scope?: string,
  max?: number,
): Issue {
  const said = body.message ? ` HubSpot said: ${quote(body.message, key, max)}` : ''
  const needs = scope ? ` It needs the scope ${scope}.` : ''
  if (status === 401) {
    return {
      code: 'E_AUTH',
      message: `HubSpot rejected the key (401).${said}`,
      fix: `Check that the key is valid and not expired.${needs}`,
    }
  }
  if (status === 403) {
    return {
      code: 'E_SCOPE',
      message: `HubSpot refused ${method} ${path} (403).${scope ? ` The key likely lacks the scope ${scope}.` : ''}${said}`,
      fix: scope ? `Add the scope ${scope} to the key.` : 'Check the scopes of the key.',
    }
  }
  if (status === 429) {
    return { code: 'E_RATE_LIMIT', message: `HubSpot rate limit hit and ${maxRetries} retries did not clear it.` }
  }
  return { code: 'E_HTTP', message: `HubSpot returned ${status} for ${method} ${path}.${said}` }
}

/** The next midnight in the given time zone, as an ISO string. */
export function portalMidnight(now: Date, timeZone: string): string {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const part = Object.fromEntries(format.formatToParts(now).map((p) => [p.type, Number(p.value)]))
  const local = Date.UTC(part.year ?? 0, (part.month ?? 1) - 1, part.day, part.hour, part.minute, part.second)
  const offset = local - Math.floor(now.getTime() / 1000) * 1000
  return new Date(Date.UTC(part.year ?? 0, (part.month ?? 1) - 1, (part.day ?? 1) + 1) - offset).toISOString()
}
