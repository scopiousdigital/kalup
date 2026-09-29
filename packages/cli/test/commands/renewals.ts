// The acme/renewals blueprint the add and upgrade tests use: three versions under test/fixtures/blueprints, copied into
// a project so the lock records a path relative to it. The projects start from the apply fixture (orchard companies,
// target sandbox on portal 1111111), and every add or upgrade runs under a fetch that fails on any HubSpot request.
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import { copy, empty } from '../../src/commands/testing.js'
import { createPortalSim, type PortalSim } from '../support/portal-sim.js'
import { tree } from './orchard.js'

export const key = 'kalup-blueprint-sandbox-7c1d'
export const portalId = 1_111_111
export const config = 'kalup.config.ts'
export const deals = 'kalup/objects/deals.ts'
export const barrel = 'kalup/index.ts'
export const lockFile = 'kalup/blueprints.lock.json'

/** The stored original of a version. */
export function original(version: string): string {
  return `kalup/.blueprints/acme--renewals@${version}.json`
}

/** The fixture's text: the bytes a source serves. */
export function blueprintText(version: string): string {
  return readFileSync(new URL(`../fixtures/blueprints/renewals-${version}.json`, import.meta.url), 'utf8')
}

/** Copies a version into `dir`/blueprints and returns the path relative to `dir`. */
export function source(dir: string, version: string): string {
  mkdirSync(join(dir, 'blueprints'), { recursive: true })
  copyFileSync(
    new URL(`../fixtures/blueprints/renewals-${version}.json`, import.meta.url),
    join(dir, 'blueprints', `renewals-${version}.json`),
  )
  return `blueprints/renewals-${version}.json`
}

/** The apply fixture with its read key set: companies in config, no deals. */
export function orchard(): string {
  vi.stubEnv('KALUP_LOCK_DIR', empty())
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', key)
  vi.stubEnv('CI', undefined)
  return copy('apply')
}

/** The apply fixture with no kalup/ folder: a config and nothing else. */
export function bare(): string {
  const dir = orchard()
  rmSync(join(dir, 'kalup'), { recursive: true })
  return dir
}

/** Every project file, history, state and the blueprint sources left out. */
export function projectFiles(dir: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree(dir)).filter(([file]) => !(file.startsWith('.kalup') || file.startsWith('blueprints/'))),
  )
}

export interface Guard {
  /** Every URL fetch was called with. */
  urls: string[]
}

/**
 * Stubs fetch with one that fails the test on any HubSpot URL and answers `bodies` by URL, 404 otherwise. Blueprint
 * commands never talk to HubSpot.
 */
export function noHubSpot(bodies: Record<string, () => Response> = {}): Guard {
  const guard: Guard = { urls: [] }
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = String(input)
    guard.urls.push(url)
    if (new URL(url).hostname.endsWith('hubapi.com')) {
      throw new Error(`a blueprint command sent a HubSpot request: ${url}`)
    }
    const body = Object.hasOwn(bodies, url) ? bodies[url] : undefined
    return Promise.resolve(body ? body() : new Response('not found', { status: 404 }))
  })
  return guard
}

/** The simulator with one empty portal for target sandbox, deals and companies included. */
export function portal(): PortalSim {
  const sim = createPortalSim([
    {
      portalId,
      keys: { HUBSPOT_SANDBOX_KEY: key },
      objects: { companies: { groups: [], properties: [] }, deals: { groups: [], properties: [] } },
    },
  ])
  vi.stubGlobal('fetch', sim.fetch)
  return sim
}
