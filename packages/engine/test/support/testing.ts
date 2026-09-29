// Test helpers shared by the engine and CLI tests: API fixtures, JSON responses and a fetch that answers only read-tagged
// registry paths. Not exported from the package.
import { readFileSync } from 'node:fs'
import type { Fetch } from '../../src/lib/http.js'
import { registry } from '../../src/lib/registry.js'

export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'))
}

export function jsonResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * The key a fake portal answers a request under: its path, plus `?dataSensitivity=<value>` for a sensitive properties
 * list, since all three properties lists share one path.
 */
export function route(url: string): string {
  const { pathname, searchParams } = new URL(url)
  const sensitivity = searchParams.get('dataSensitivity')
  return sensitivity === null ? pathname : `${pathname}?dataSensitivity=${sensitivity}`
}

/** A fake portal's body for a request: the one under its route, or no properties for a sensitive list with none. */
export function portalBody(bodies: Record<string, unknown>, url: string): unknown {
  const at = route(url)
  if (Object.hasOwn(bodies, at)) {
    return bodies[at]
  }
  return at === new URL(url).pathname ? undefined : { results: [] }
}

const placeholder = /\{\w+\}/

// Every read-tagged path as a matcher, so a request outside the registry, or on a write path, fails at the fake.
const readPaths = Object.values(registry).flatMap((row) =>
  Object.values(row.paths)
    .filter((endpoint) => endpoint.tag === 'read')
    .map((endpoint) => ({ method: endpoint.method, pattern: toPattern(endpoint.path) })),
)

// `/crm/properties/2026-09/{objectType}` becomes `^/crm/properties/2026-09/[^/]+$`.
function toPattern(template: string): RegExp {
  const literals = template.split(placeholder).map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${literals.join('[^/]+')}$`)
}

/**
 * A fetch that hands out the given responses in order, then 200 `{}`, and records every call. It throws on any
 * request whose method and path match no read-tagged registry path, so every test driven through it enforces the
 * read-only rule.
 */
export function fakeFetch(...responses: Response[]): { fetch: Fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  return {
    calls,
    fetch: (url, init) => {
      const method = init.method ?? 'GET'
      const { pathname } = new URL(url)
      if (!readPaths.some((read) => read.method === method && read.pattern.test(pathname))) {
        return Promise.reject(new Error(`${method} ${pathname} matches no read-tagged registry path`))
      }
      calls.push({ url, init })
      return Promise.resolve(responses.shift() ?? jsonResponse(200))
    },
  }
}
