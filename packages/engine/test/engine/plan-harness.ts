// The plan tests' portal and project: target sandbox of the pull fixture project, read from the orchard portal and
// planned the way the plan command does it: observe, the reads planReads asks for, then plan. A scenario edits the
// project's files or the portal's answers first, and may give the portal's state and take selectors.
import { readFileSync } from 'node:fs'
import { observeTarget } from '../../src/engine/observe.js'
import { type PlanInput, type Planned, plan, planReads, type Selector } from '../../src/engine/plan.js'
import { preflight } from '../../src/engine/preflight.js'
import type { TargetState } from '../../src/ir/state.js'
import { createHttp, type Fetch } from '../../src/lib/http.js'
import { type ArchivedProperty, archivedProperties } from '../../src/lib/pull/read.js'
import { type Loaded, loadFiles } from '../../src/loader/load.js'
import { validate } from '../../src/loader/validate.js'
import type { Plan } from '../../src/plan/types.js'
import { project, readProjectFiles } from '../support/project.js'
import { fakeFetch, fixture, jsonResponse, portalBody, route } from '../support/testing.js'

export const routes = {
  schemas: '/crm-object-schemas/2026-09/schemas',
  companies: '/crm/properties/2026-09/companies',
  companyGroups: '/crm/properties/2026-09/companies/groups',
  deals: '/crm/properties/2026-09/deals',
  dealGroups: '/crm/properties/2026-09/deals/groups',
  harvest: '/crm/properties/2026-09/2-4242001',
  harvestGroups: '/crm/properties/2026-09/2-4242001/groups',
  objectLimit: '/crm/limits/2026-09/custom-object-types',
  propertyLimit: '/crm/limits/2026-09/custom-properties',
}

export const files = {
  config: 'kalup.config.ts',
  companies: 'kalup/objects/companies.ts',
  harvest: 'kalup/objects/harvest.ts',
}

/** A change to one project file. `from` must occur in it. */
export type Edit = [file: string, from: string, to: string]

export interface Scenario {
  accountType?: string
  /**
   * Answers laid over the orchard portal's, by route. `<path>?archived=true`, plus `&dataSensitivity=<value>` for a
   * sensitive one, answers an archived properties list.
   */
  bodies?: Record<string, unknown>
  /** Sent as X-HubSpot-RateLimit-Daily-Remaining on every answer. Absent: the header is not sent. */
  daily?: number
  edits?: Edit[]
  /** Project files added or replaced. */
  files?: Record<string, string>
  /** Routes answered 403. */
  refused?: string[]
  /** The portal's state. Absent: none. */
  state?: TargetState
  /** The --take config selectors. */
  take?: Selector[]
}

export interface Run extends Planned {
  input: PlanInput
  /** Every request's path, with the archived and sensitivity query when set. */
  requests: string[]
}

export const VERSION = '0.0.0-test'

const root = project('pull')
const rate = {
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}

function orchard(): Record<string, unknown> {
  return {
    [routes.schemas]: fixture('api/orchard/schemas.json'),
    [routes.companies]: fixture('api/orchard/companies.properties.json'),
    [routes.companyGroups]: fixture('api/orchard/companies.groups.json'),
    [routes.harvest]: fixture('api/orchard/harvest.properties.json'),
    [routes.harvestGroups]: fixture('api/orchard/harvest.groups.json'),
    [routes.objectLimit]: fixture('api/orchard/limits.custom-object-types.json'),
    [routes.propertyLimit]: fixture('api/orchard/limits.custom-properties.json'),
  }
}

/** The pull project with the scenario's files and edits, loaded with a fixed generator version. It must validate. */
export function loadScenario(scenario: Scenario = {}): Loaded {
  const texts = { ...readProjectFiles(root), ...scenario.files }
  for (const [file, from, to] of scenario.edits ?? []) {
    const text = texts[file] ?? ''
    if (!text.includes(from)) {
      throw new Error(`${file} has no ${from}`)
    }
    texts[file] = text.replace(from, to)
  }
  const loaded = loadFiles(texts, { root, version: VERSION })
  const { issues } = validate(loaded, { target: 'sandbox' })
  if (issues.length > 0) {
    throw new Error(issues.map((i) => `${i.code}: ${i.message}`).join('\n'))
  }
  return loaded
}

export async function planScenario(scenario: Scenario = {}): Promise<Run> {
  const loaded = loadScenario(scenario)
  const bodies = { ...orchard(), ...scenario.bodies }
  const headers =
    scenario.daily === undefined ? rate : { ...rate, 'x-hubspot-ratelimit-daily-remaining': `${scenario.daily}` }
  const requests: string[] = []
  const fetch: Fetch = (url, init) => {
    const { pathname, searchParams } = new URL(url)
    const sensitivity = searchParams.get('dataSensitivity')
    const archived =
      searchParams.get('archived') === 'true'
        ? `${pathname}?archived=true${sensitivity === null ? '' : `&dataSensitivity=${sensitivity}`}`
        : undefined
    const at = archived ?? route(url)
    requests.push(at)
    let body: unknown = portalBody(bodies, url)
    if (archived) {
      body = Object.hasOwn(bodies, archived) ? bodies[archived] : { results: [] }
    }
    const response = scenario.refused?.includes(at)
      ? jsonResponse(403, fixture('errors/missing-scope.json'))
      : jsonResponse(200, body, headers)
    return fakeFetch(response).fetch(url, init)
  }
  const http = createHttp({ key: 'kalup-test-secret-5d1e', fetch, warn: () => undefined })
  const { observation } = await observeTarget(http, loaded, 'sandbox')
  const state = scenario.state ?? null
  const take = scenario.take ?? []
  const reads = planReads({ loaded, observation, state, take, target: 'sandbox' })
  const { limits } = await preflight(http, reads.limits)
  const archived: Record<string, ArchivedProperty[]> = {}
  for (const [key, objectType] of Object.entries(reads.archived)) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, as the command sends them
    archived[key] = await archivedProperties(http, objectType)
  }
  const input: PlanInput = {
    archivedProperties: archived,
    dailyRemaining: http.dailyRemaining,
    limits,
    loaded,
    observation,
    portal: {
      portalId: 1_111_111,
      accountType: scenario.accountType ?? 'DEVELOPER_TEST',
      uiDomain: 'app-eu1.hubspot.com',
    },
    state,
    take,
    target: 'sandbox',
    version: VERSION,
  }
  return { ...plan(input), input, requests }
}

/** A golden plan under test/fixtures/plans. */
export function golden(name: string): Plan {
  return JSON.parse(readFileSync(new URL(`../fixtures/plans/${name}.json`, import.meta.url), 'utf8')) as Plan
}
