// Test helpers shared by the lib tests. Not exported from the package.
import { readFileSync } from 'node:fs'
import type { Fetch } from './http.js'
import { registry } from './registry.js'

export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8'))
}

export function jsonResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

// Every read-tagged path as a matcher, so a request outside the registry, or on a write path, fails at the fake.
const readPaths = Object.values(registry).flatMap((row) =>
  Object.values(row.paths)
    .filter((endpoint) => endpoint.tag === 'read')
    .map((endpoint) => ({ method: endpoint.method, pattern: toPattern(endpoint.path) })),
)

// `/crm/properties/2026-09/{objectType}` becomes `^/crm/properties/2026-09/[^/]+$`.
function toPattern(template: string): RegExp {
  const literals = template.split(/\{\w+\}/).map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
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
    fetch: async (url, init) => {
      const method = init.method ?? 'GET'
      const { pathname } = new URL(url)
      if (!readPaths.some((read) => read.method === method && read.pattern.test(pathname))) {
        throw new Error(`${method} ${pathname} matches no read-tagged registry path`)
      }
      calls.push({ url, init })
      return responses.shift() ?? jsonResponse(200)
    },
  }
}
