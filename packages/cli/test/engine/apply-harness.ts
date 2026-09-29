// The executor tests' portal, project and dependencies: the apply fixture project planned against the simulator the
// way kalup plan does it, and an executor whose clock only moves when it sleeps, so a 60 s read-back runs at once.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Loaded, loadFiles, type Plan, type TargetState, validate } from '@kalup/core'
import { project } from '../../src/commands/testing.js'
import type { ApplyDeps, ApplyRequest } from '../../src/engine/apply.js'
import { observeForApply } from '../../src/engine/apply-observe.js'
import { observeTarget } from '../../src/engine/observe.js'
import { plan, planReads, type Selector } from '../../src/engine/plan.js'
import { preflight } from '../../src/engine/preflight.js'
import { guardPortal } from '../../src/lib/guard.js'
import { createHttp, createWriteHttp, MILESTONE_3_WRITES, type WriteHttpClient } from '../../src/lib/http.js'
import { openJournal } from '../../src/lib/journal.js'
import { readProjectFiles } from '../../src/lib/load.js'
import { acquirePortalLock } from '../../src/lib/lock.js'
import { type ArchivedProperty, archivedProperties } from '../../src/lib/pull/read.js'
import { FileStateStore, type StateIo } from '../../src/lib/state.js'
import { createPortalSim, type PortalSim, type SimPortalInput, type SimPropertyInput } from '../support/portal-sim.js'

export const key = 'kalup-engine-sandbox-6b2f'
export const portalId = 1_111_111
export const companies = '/crm/properties/2026-09/companies'
export const groups = `${companies}/groups`
export const soilPh = 'property:companies/soil_ph'

/** A change to one project file of the apply fixture. `from` must occur in it. */
export type Edit = [file: string, from: string, to: string]

export const files = { config: 'kalup.config.ts', companies: 'kalup/objects/companies.ts' }

/** The group and property the fixture config declares, as HubSpot would hold them once applied. */
export const orchardGroup = { name: 'orchard', label: 'Orchard' }
export const soilPhProperty: SimPropertyInput = {
  name: 'soil_ph',
  label: 'Soil pH',
  type: 'number',
  fieldType: 'number',
  groupName: 'orchard',
}

/** The sandbox portal: companies with HubSpot's own group and name property, plus `extra` groups and properties. */
export function simPortal(
  extra: { groups?: { label: string; name: string }[]; properties?: SimPropertyInput[] } = {},
  input: Partial<SimPortalInput> = {},
): PortalSim {
  return createPortalSim([
    {
      portalId,
      keys: { HUBSPOT_SANDBOX_KEY: key },
      objects: {
        companies: {
          groups: [{ name: 'companyinformation', label: 'Company information' }, ...(extra.groups ?? [])],
          properties: [
            {
              name: 'name',
              label: 'Company name',
              type: 'string',
              fieldType: 'text',
              groupName: 'companyinformation',
              hubspotDefined: true,
            },
            ...(extra.properties ?? []),
          ],
        },
      },
      ...input,
    },
  ])
}

/** The apply fixture project with `edits` and extra `files`. It must validate. */
export function loadProject(edits: Edit[] = [], extra: Record<string, string> = {}): Loaded {
  const root = project('apply')
  const texts = { ...readProjectFiles(root), ...extra }
  for (const [file, from, to] of edits) {
    const text = texts[file] ?? ''
    if (!text.includes(from)) {
      throw new Error(`${file} has no ${from}`)
    }
    texts[file] = text.replace(from, to)
  }
  const loaded = loadFiles(texts, { root, version: '0.0.0-test' })
  const { issues } = validate(loaded, { target: 'sandbox' })
  if (issues.length > 0) {
    throw new Error(issues.map((i) => `${i.code}: ${i.message}`).join('\n'))
  }
  return loaded
}

/** The plan kalup plan makes for the project against the simulator, with the given state and take selectors. */
export async function planOn(
  sim: PortalSim,
  loaded: Loaded,
  state: TargetState | null = null,
  take: Selector[] = [],
): Promise<Plan> {
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  const portal = await guardPortal(http, { name: 'sandbox', portalId, variable: 'HUBSPOT_SANDBOX_KEY' })
  const { observation, archivedGroups } = await observeTarget(http, loaded, 'sandbox')
  const reads = planReads({ loaded, observation, state, take, target: 'sandbox' })
  const { limits } = await preflight(http, reads.limits)
  const archived: Record<string, ArchivedProperty[]> = {}
  for (const [object, objectType] of Object.entries(reads.archived)) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, as the command sends them
    archived[object] = await archivedProperties(http, objectType)
  }
  const planned = plan({
    archivedGroups,
    archivedProperties: archived,
    dailyRemaining: http.dailyRemaining,
    limits,
    loaded,
    observation,
    portal,
    state,
    take,
    target: 'sandbox',
    version: '0.0.0-test',
  })
  return planned.plan
}

export interface Harness {
  /** The fake clock, in ms. It moves only when the executor sleeps. */
  clock: { t: number }
  deps: ApplyDeps
  dir: string
  http: WriteHttpClient
  /** Every sleep the executor asked for, in ms. */
  slept: number[]
}

/**
 * The executor's dependencies over `sim`: a guarded write client whose attempts time out after 50 ms, the state and
 * the journal in a fresh directory, and a lock directory of its own.
 */
export async function harness(sim: PortalSim, extra: Partial<ApplyDeps> = {}, io?: StateIo): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-apply-'))
  const clock = { t: Date.parse('2026-09-25T09:00:00.000Z') }
  const slept: number[] = []
  const http = createWriteHttp({
    key,
    fetch: sim.fetch,
    allow: MILESTONE_3_WRITES,
    warn: () => undefined,
    timeoutMs: 50,
  })
  await guardPortal(http, { name: 'sandbox', portalId, variable: 'HUBSPOT_SANDBOX_KEY' })
  const stateDir = join(dir, 'state')
  const deps: ApplyDeps = {
    http,
    store: FileStateStore(stateDir, io ? { io } : {}),
    lock: (id, holder) => acquirePortalLock(id, holder, { dir: join(dir, 'locks') }),
    openJournal: (run) => openJournal(stateDir, run, new Date(clock.t)),
    observe: observeForApply,
    now: () => new Date(clock.t),
    sleep: (ms) => {
      slept.push(ms)
      clock.t += ms
      return Promise.resolve()
    },
    ...extra,
  }
  return { clock, deps, dir, http, slept }
}

export function request(saved: Plan, approval: ApplyRequest['approval'] = 'yes'): ApplyRequest {
  return { plan: saved, approval, actor: approval, keys: [key] }
}

/** The requests after `from` in the simulator's log, as `<method> <path>`. */
export function sent(sim: PortalSim, from = 0): string[] {
  return sim.log.slice(from).map((r) => `${r.method} ${r.path}`)
}
