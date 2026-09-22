// The one choke point for HubSpot requests. Read mode only: a write-tagged path never leaves this file.
import { type Issue, KalupError } from './output.js'
import { fillPath, type Registry, type RegistryRow, type RegistryType, registry } from './registry.js'
import { sanitize } from './sanitize.js'

export const baseUrl = 'https://api.hubapi.com'

// Rate-limit header names, in one table. Which of them a service key returns is not confirmed.
const rateHeaders = {
  max: 'x-hubspot-ratelimit-max',
  remaining: 'x-hubspot-ratelimit-remaining',
  interval: 'x-hubspot-ratelimit-interval-milliseconds',
  daily: 'x-hubspot-ratelimit-daily-remaining',
} as const

const maxRetries = 3
const fallback = { capacity: 8, intervalMs: 1000 }
const fallbackWarning = 'HubSpot sent no rate-limit headers. Sending at most 8 requests per second.'

export type HttpRequest = {
  [K in RegistryType]: {
    type: K
    path: keyof Registry[K]['paths'] & string
    params?: Record<string, string>
    query?: Record<string, string>
    body?: unknown
  }
}[RegistryType]

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface HttpOptions {
  key: string
  fetch?: Fetch
  warn?: (message: string) => void
}

export interface HttpClient {
  request<T = unknown>(req: HttpRequest): Promise<T>
  /** The account's time zone, set by the portal guard. Sets the daily limit reset time. */
  timeZone: string
  /** From X-HubSpot-RateLimit-Daily-Remaining, or null when the key does not report it. */
  readonly dailyRemaining: number | null
}

interface ErrorBody {
  message?: string
  category?: string
  correlationId?: string
  policyName?: string
}

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

/** Creates a read-mode client. Refuses write-tagged paths, retries 429 and 5xx, paces requests with a token bucket. */
export function createHttp(options: HttpOptions): HttpClient {
  const { key, fetch = globalThis.fetch, warn = console.error } = options
  const bucket = createBucket()
  let informed = false
  let dailyRemaining: number | null = null

  const client: HttpClient = {
    timeZone: 'UTC',
    get dailyRemaining() {
      return dailyRemaining
    },

    async request<T>(req: HttpRequest): Promise<T> {
      const row: RegistryRow = registry[req.type]
      const endpoint = row.paths[req.path]
      if (!endpoint) throw new Error(`Unknown path ${req.path} on ${req.type}`)
      if (endpoint.tag !== 'read') {
        throw new KalupError({
          code: 'E_WRITE_IN_READ_MODE',
          message: `${endpoint.method} ${endpoint.path} is a write path and this version only reads.`,
        })
      }
      const url = new URL(fillPath(endpoint.path, req.params ?? {}), baseUrl)
      for (const [name, value] of Object.entries(req.query ?? {})) url.searchParams.set(name, value)
      const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: 'application/json' }
      if (req.body !== undefined) headers['content-type'] = 'application/json'
      const init: RequestInit = { method: endpoint.method, headers }
      if (req.body !== undefined) init.body = JSON.stringify(req.body)

      for (let attempt = 0; ; attempt++) {
        await bucket.take()
        const res = await fetch(url.toString(), init)
        readRateHeaders(res)
        if (res.ok) return (res.status === 204 ? undefined : await readJson(res, endpoint.method, url.pathname)) as T
        const body = await readErrorBody(res)
        if (res.status === 429 && body.policyName === 'DAILY') {
          const retryAfter = portalMidnight(new Date(), client.timeZone)
          throw new HubSpotApiError(
            {
              code: 'E_DAILY_LIMIT',
              message: 'The portal has used its daily API limit.',
              fix: `Try again after ${retryAfter}.`,
            },
            res.status,
            body,
            retryAfter,
          )
        }
        const retryable = res.status === 429 || res.status >= 500
        if (retryable && attempt < maxRetries) {
          // Retry-After in seconds; an HTTP-date is NaN and falls back to backoff. A 429 that also carried rate
          // headers drained the bucket above, which refills during this sleep, so the retry waits for the longer.
          const retryAfter = Number(res.headers.get('retry-after'))
          await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt))
          continue
        }
        throw toError(res.status, body, endpoint.method, url.pathname, scopeFor(row, req.params))
      }
    },
  }

  function readRateHeaders(res: Response): void {
    const daily = Number(res.headers.get(rateHeaders.daily))
    if (res.headers.has(rateHeaders.daily) && Number.isFinite(daily)) dailyRemaining = daily
    const max = Number(res.headers.get(rateHeaders.max))
    const remaining = Number(res.headers.get(rateHeaders.remaining))
    const interval = Number(res.headers.get(rateHeaders.interval))
    if (max > 0 && interval > 0 && Number.isFinite(remaining)) {
      bucket.update(max, remaining, interval)
      informed = true
    } else if (!informed) {
      informed = true
      warn(fallbackWarning)
    }
  }

  return client
}

function createBucket() {
  let capacity = fallback.capacity
  let intervalMs = fallback.intervalMs
  let tokens = capacity
  let last = Date.now()

  function refill(): void {
    const now = Date.now()
    tokens = Math.min(capacity, tokens + ((now - last) * capacity) / intervalMs)
    last = now
  }

  return {
    async take(): Promise<void> {
      refill()
      while (tokens < 1) {
        await sleep(Math.ceil(((1 - tokens) * intervalMs) / capacity))
        refill()
      }
      tokens -= 1
    },
    update(max: number, remaining: number, interval: number): void {
      capacity = max
      intervalMs = interval
      tokens = remaining
      last = Date.now()
    },
  }
}

function backoff(attempt: number): number {
  return 250 * 2 ** attempt + Math.floor(Math.random() * 250)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A 2xx whose body is not JSON (an HTML page from a proxy) is E_HTTP, not a bare SyntaxError.
async function readJson(res: Response, method: string, path: string): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    const message = `HubSpot returned ${res.status} for ${method} ${path} with a body that is not JSON.`
    throw new HubSpotApiError({ code: 'E_HTTP', message }, res.status, {})
  }
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  try {
    const body: unknown = JSON.parse(await res.text())
    return typeof body === 'object' && body !== null ? (body as ErrorBody) : {}
  } catch {
    return {}
  }
}

// The scope a request needs, from the row: `{object}` is the standard object name, or `custom` for a type ID.
function scopeFor(row: RegistryRow, params: Record<string, string> = {}): string | undefined {
  const objectType = params.objectType ?? ''
  const object = /^[a-z_]+$/.test(objectType) ? objectType : 'custom'
  return row.scopes?.read[0]?.replace('{object}', object)
}

function toError(status: number, body: ErrorBody, method: string, path: string, scope?: string): HubSpotApiError {
  const said = body.message ? ` HubSpot said: ${sanitize(body.message)}` : ''
  const needs = scope ? ` It needs the scope ${scope}.` : ''
  let issue: Issue
  if (status === 401) {
    issue = {
      code: 'E_AUTH',
      message: `HubSpot rejected the key (401).${said}`,
      fix: `Check that the key is valid and not expired.${needs}`,
    }
  } else if (status === 403) {
    issue = {
      code: 'E_SCOPE',
      message: `HubSpot refused ${method} ${path} (403).${scope ? ` The key likely lacks the scope ${scope}.` : ''}${said}`,
      fix: scope ? `Add the scope ${scope} to the key.` : 'Check the scopes of the key.',
    }
  } else if (status === 429) {
    issue = { code: 'E_RATE_LIMIT', message: `HubSpot rate limit hit and ${maxRetries} retries did not clear it.` }
  } else {
    issue = { code: 'E_HTTP', message: `HubSpot returned ${status} for ${method} ${path}.${said}` }
  }
  return new HubSpotApiError(issue, status, body)
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
