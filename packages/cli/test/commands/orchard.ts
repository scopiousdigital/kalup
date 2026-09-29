// The orchard portal as the milestone 2 command tests stub it: the API fixtures under packages/engine/test/fixtures/api/orchard by
// route, one portal per read key, and every request recorded. Each request goes through fakeFetch, so one outside the
// read-tagged registry paths throws before it reaches a portal.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Fetch } from '@kalup/engine'
import { vi } from 'vitest'
import { fakeFetch, fixture, jsonResponse, portalBody, route } from '../../../engine/test/support/testing.js'
import { cli, empty, project } from '../../src/commands/testing.js'

/** The read key of target sandbox. No test output or written file may contain it. */
export const key = 'kalup-test-secret-4e7d'

export const routes = {
  account: '/account-info/2026-09/details',
  schemas: '/crm-object-schemas/2026-09/schemas',
  companies: '/crm/properties/2026-09/companies',
  companyGroups: '/crm/properties/2026-09/companies/groups',
  harvest: '/crm/properties/2026-09/2-4242001',
  harvestGroups: '/crm/properties/2026-09/2-4242001/groups',
  objectLimit: '/crm/limits/2026-09/custom-object-types',
  propertyLimit: '/crm/limits/2026-09/custom-properties',
}

export type Bodies = Record<string, unknown>

const rate = {
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}

/** The orchard portal's answers by route, Limits Tracking included. */
export function orchard(): Bodies {
  return {
    [routes.account]: fixture('account-info.json'),
    [routes.schemas]: fixture('api/orchard/schemas.json'),
    [routes.companies]: fixture('api/orchard/companies.properties.json'),
    [routes.companyGroups]: fixture('api/orchard/companies.groups.json'),
    [routes.harvest]: fixture('api/orchard/harvest.properties.json'),
    [routes.harvestGroups]: fixture('api/orchard/harvest.groups.json'),
    [routes.objectLimit]: fixture('api/orchard/limits.custom-object-types.json'),
    [routes.propertyLimit]: fixture('api/orchard/limits.custom-properties.json'),
  }
}

export interface Sent {
  /** `<method> <route>` per request, `?archived=true` and its data sensitivity included. */
  calls: string[]
  /** The key each request carried, in the order of `calls`. */
  keys: string[]
}

/**
 * Stubs fetch with one portal per read key, the orchard portal under `key` by default, and sets the sandbox key. A
 * route answers with its body, or its Response. A sensitive or archived properties list with no body of its own is
 * empty, an unknown key is a 401, and anything else is a 404.
 */
export function portal(portals: Record<string, Bodies> = { [key]: orchard() }): Sent {
  const sent: Sent = { calls: [], keys: [] }
  const fetch: Fetch = (url, init) => {
    const { pathname, searchParams } = new URL(url)
    const archived = searchParams.get('archived') === 'true'
    const sensitivity = searchParams.get('dataSensitivity')
    const at = archived
      ? `${pathname}?archived=true${sensitivity === null ? '' : `&dataSensitivity=${sensitivity}`}`
      : route(url)
    const auth = (init.headers as { authorization?: string }).authorization ?? ''
    const bodies = portals[auth.replace('Bearer ', '')]
    sent.calls.push(`${init.method ?? 'GET'} ${at}`)
    sent.keys.push(auth.replace('Bearer ', ''))
    let body: unknown = bodies ? portalBody(bodies, url) : jsonResponse(401, fixture('errors/unauthorized.json'))
    if (bodies && archived) {
      body = Object.hasOwn(bodies, at) ? bodies[at] : { results: [] }
    }
    return fakeFetch(answer(body)).fetch(url, init)
  }
  vi.stubGlobal('fetch', fetch)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', key)
  return sent
}

function answer(body: unknown): Response {
  if (body instanceof Response) {
    return body
  }
  return body === undefined ? jsonResponse(404, { message: 'Not found' }) : jsonResponse(200, body, rate)
}

/** A 403 as HubSpot sends it for a missing scope. A Response is read once: build one per request. */
export function refused(): Response {
  return jsonResponse(403, fixture('errors/missing-scope.json'))
}

/** Replaces `from` in a project file, which must contain it. */
export function edit(dir: string, file: string, from: string, to: string): void {
  const text = readFileSync(join(dir, file), 'utf8')
  if (!text.includes(from)) {
    throw new Error(`${file} has no ${from}`)
  }
  writeFileSync(join(dir, file), text.replace(from, to))
}

/** Every file under `dir` with its text, by path relative to it with forward slashes. */
export function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const full = join(entry.parentPath, entry.name)
      out[relative(dir, full).split(sep).join('/')] = readFileSync(full, 'utf8')
    }
  }
  return out
}

/** A project whose files agree with the orchard portal: the pull fixture's config, pulled into an empty directory. */
export async function inSync(): Promise<string> {
  portal()
  const dir = empty()
  writeFileSync(join(dir, 'kalup.config.ts'), readFileSync(join(project('pull'), 'kalup.config.ts'), 'utf8'))
  const out = await cli(dir, 'pull', '--target', 'sandbox')
  if (out.exitCode !== 0) {
    throw new Error(`the first pull failed: ${out.stderr}`)
  }
  return dir
}
