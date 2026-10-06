// The live backend of the journeys: an authorized HubSpot test portal, reached by the built bin with the key from
// KALUP_LIVE_KEY. With KALUP_LIVE_BACKEND=sim the same code runs against the simulator instead, over the same HTTP
// paths, so the default suite proves the live tier without a key or a network.
//
// A live run refuses to start unless KALUP_LIVE_PORTAL names the key's portal and it is a developer test account or a
// sandbox. Each journey is one run with its own prefix, kalup_e2e_<run id>_: every group,
// property and record it creates carries it and is written to the run manifest before its create is sent, whether the
// journey sends it (hubspot.ts) or kalup apply does (beforeApply checks each plan first). The project's pull scope
// names only those resources (custom: false, include), so no command can see or touch anything else in the portal.
// After the journey, pass or fail, afterAll archives what the manifest names; `pnpm test:live:cleanup` finishes any
// run that could not. The manifest and a transcript of every kalup run, with the key and portal ID taken out, are the
// run's evidence under live-runs/e2e/.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Mode } from '@kalup/core'
import { camelCase, parseAddress, write } from '@kalup/engine'
import { afterAll } from 'vitest'
import type { SimProperty, SimPropertyInput } from '../../../engine/test/support/portal-sim.js'
import {
  type Api,
  cleanRun,
  createApi,
  guarded,
  type LiveUi,
  liveSettings,
  liveUi,
  type Manifest,
  type Named,
  newManifest,
  newRunId,
  prefixOf,
  RUNS,
} from './hubspot.js'
import { type Backend, type Journey, type PortalSeed, simulator } from './journey.js'
import { nurseryGroup, nurseryProperties, options } from './nursery.js'

/** Whether the live journeys run against the simulator: KALUP_LIVE_BACKEND=sim. */
export const simulated = process.env.KALUP_LIVE_BACKEND === 'sim'

/** The one target of a live project. init names it from the account type, which the guard allows only as these. */
const TARGET = 'sandbox'
const VARIABLE = 'HUBSPOT_SERVICE_KEY'
const OBJECT = 'companies'
/** How long a kalup run at a terminal may take against HubSpot: an apply that reads, then writes and reads back. */
const TERMINAL_MS = 480_000
/** The company record paths the simulated portal answers besides the simulator's own. */
const RECORD_PATH = /^\/crm\/objects\/2026-09\/companies(?:\/(\d+))?$/
/** The nursery's property names before the run prefix. */
export const NURSERY = ['bed_count', 'grower_notes', 'last_frost', 'nursery_zone', 'plant_families']

export interface LiveRun {
  /** The run's names as addresses: `property:companies/<prefix><name>`. */
  address: (name: string, type?: 'property' | 'group') => string
  backend: Backend
  /** The camelCase key pull writes for one of the run's names. */
  key: (name: string) => string
  /** A label with the run ID, so no two runs' labels meet in one portal. */
  label: (label: string) => string
  /** The run's name for `name`: the prefix, then the name. */
  name: (name: string) => string
  portalId: number
  prefix: string
  runId: string
  /** The API client of the run, for records and seeding: only the run's own resources. */
  ui: LiveUi
}

export interface LiveHandle {
  /** Guards the portal, writes the manifest and seeds the nursery with the run's names. Once per journey. */
  open: () => Promise<LiveRun>
}

/**
 * A live run for `journey` (its file's code, such as `j01`). It registers the cleanup with afterAll, so call it at the
 * top level of the test file.
 */
export function liveRun(journey: string): LiveHandle {
  const runId = newRunId()
  const dir = join(resolve(process.env.KALUP_LIVE_RUNS ?? RUNS), 'e2e')
  let manifest: Manifest | undefined
  let transport: Transport | undefined
  afterAll(async () => {
    if (manifest && transport) {
      const cleaned = await cleanRun(transport.api, manifest)
      if (!cleaned.complete) {
        throw new Error(
          `cleanup left resources behind in run ${runId}: ${JSON.stringify(cleaned.resources)}. Run pnpm test:live:cleanup.`,
        )
      }
    }
  })
  return {
    open: async () => {
      transport = simulated ? await simulatedTransport() : hubspotTransport()
      const { api } = transport
      const { portalId } = await guarded(api, transport.portal)
      mkdirSync(dir, { recursive: true })
      manifest = newManifest(join(dir, `${runId}.manifest.json`), {
        runId,
        journey,
        backend: simulated ? 'simulator' : 'hubspot',
      })
      const ui = liveUi(api, manifest)
      const run = runOf({ runId, portalId, ui })
      const held = manifest
      const secrets = Object.values(transport.env).filter((value) => value.length >= 8)
      const transcript = join(dir, `${runId}.transcript.jsonl`)
      run.backend = {
        ...transport.backend(portalId),
        ui: uiOf(ui),
        beforeApply: (plan) => {
          for (const step of plan.steps) {
            const resource = cleanedBy(step.address, run.prefix, runId)
            if (!held.holds(resource)) {
              held.add(resource)
            }
          }
        },
        record: (entry) => {
          const redacted = secrets
            .reduce((text, secret) => text.replaceAll(secret, '[key]'), JSON.stringify({ journey, ...entry }))
            .replace(new RegExp(`\\b${portalId}\\b`, 'g'), 'test-portal')
          appendFileSync(transcript, `${redacted}\n`)
        },
      }
      await seedNursery(run)
      return run
    },
  }
}

/** What cleanup removes to undo a plan step, or an error when the step touches something the run did not create. */
function cleanedBy(address: string, prefix: string, runId: string): Named {
  const { type, path } = parseAddress(address)
  const [objectType = '', name = '', stage] = path.split('/')
  // A custom object of the run: cleanup archives and purges it, and what is on it goes with it, its associations on
  // either side among them.
  if (objectType.startsWith(prefix)) {
    return { type: 'object', objectType: 'schemas', name: objectType }
  }
  if (type === 'association' && name.startsWith(prefix)) {
    return { type: 'object', objectType: 'schemas', name }
  }
  const known = type === 'property' || type === 'group' || type === 'pipeline' || type === 'stage'
  const own = name.startsWith(prefix) && (stage === undefined || stage.startsWith(prefix))
  if (!(known && own)) {
    throw new Error(`the plan touches ${address}, which run ${runId} did not create. Nothing was applied.`)
  }
  // A stage is its pipeline's: cleanup deletes the pipeline with every stage in it.
  return { type: type === 'stage' ? 'pipeline' : type, objectType, name }
}

function runOf({ runId, portalId, ui }: { portalId: number; runId: string; ui: LiveUi }): LiveRun {
  const prefix = prefixOf(runId)
  return {
    runId,
    prefix,
    portalId,
    ui,
    name: (name) => `${prefix}${name}`,
    label: (label) => `${label} ${runId}`,
    key: (name) => camelCase(`${prefix}${name}`),
    address: (name, type = 'property') => `${type}:${OBJECT}/${prefix}${name}`,
    // Set by open once the transport is up.
    backend: undefined as unknown as Backend,
  }
}

/** The nursery of the offline journeys, with the run's names and labels, created through the API. */
async function seedNursery(run: LiveRun): Promise<void> {
  await run.ui.createGroup(OBJECT, { name: run.name(nurseryGroup.name), label: run.label(nurseryGroup.label) })
  for (const property of nurseryProperties()) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, each create read back before the next
    await run.ui.createProperty(OBJECT, {
      ...property,
      name: run.name(property.name),
      label: run.label(property.label ?? property.name),
      groupName: run.name(property.groupName),
    })
  }
}

/** The HubSpotUi of the journey helper over the run's API client, on its one target. */
function uiOf(ui: LiveUi): Backend['ui'] {
  const only = (target: string) => {
    if (target !== TARGET) {
      throw new Error(`a live run has one target, ${TARGET}, not ${target}`)
    }
  }
  return {
    property: async (target, object, name) => {
      only(target)
      return (await ui.property(object, name)) as unknown as SimProperty
    },
    editProperty: (target, object, name, change) => {
      only(target)
      return ui.editProperty(object, name, change)
    },
    createProperty: (target, object, input: SimPropertyInput) => {
      only(target)
      return ui.createProperty(object, input)
    },
    pipeline: (target, object, id) => {
      only(target)
      return ui.pipeline(object, id)
    },
    editStage: (target, object, pipeline, stage, label) => {
      only(target)
      return ui.editStage(object, pipeline, stage, label)
    },
    schema: (target, name) => {
      only(target)
      return ui.schema(name)
    },
    labels: (target, from, to) => {
      only(target)
      return ui.labels(from, to)
    },
    editLabel: (target, pair, typeId, labels) => {
      only(target)
      return ui.editLabel(pair, typeId, labels)
    },
    editSchema: (target, name, change) => {
      only(target)
      return ui.editSchema(name, change)
    },
  }
}

interface Transport {
  api: Api
  /** The backend the journey helper runs kalup with, for the guarded portal. */
  backend: (portalId: number) => Omit<Backend, 'ui'>
  env: Record<string, string>
  /** The ID of the portal the run may write to. */
  portal: string
}

/**
 * HubSpot itself: the key from KALUP_LIVE_KEY for the portal KALUP_LIVE_PORTAL names, which liveSettings requires,
 * kalup's own fetch, nothing to close.
 */
function hubspotTransport(): Transport {
  const { key, portal } = liveSettings()
  const env = { [VARIABLE]: key }
  return {
    api: createApi({ fetch: globalThis.fetch, key, live: true }),
    env,
    portal,
    backend: (portalId) => ({
      portals: { [TARGET]: { portalId, variable: VARIABLE } },
      env,
      node: [],
      terminalMs: TERMINAL_MS,
      close: () => Promise.resolve(),
    }),
  }
}

/**
 * The simulator standing in for the portal: a developer test account that also holds another team's group and
 * properties, which no journey may touch. kalup reaches it over the journeys' socket; the run's client through its
 * fetch, with company records added, since the simulator serves only the registry's paths. KALUP_LIVE_KEY and
 * KALUP_LIVE_PORTAL are never read.
 */
async function simulatedTransport(): Promise<Transport> {
  const seed: PortalSeed = {
    accountType: 'DEVELOPER_TEST',
    objects: {
      companies: {
        groups: [{ name: 'orchard', label: 'Orchard' }],
        properties: [
          { name: 'orchard_rows', label: 'Orchard rows', type: 'number', fieldType: 'number', groupName: 'orchard' },
          {
            name: 'orchard_soil',
            label: 'Orchard soil',
            type: 'enumeration',
            fieldType: 'select',
            groupName: 'orchard',
            options: options(['clay', 'Clay'], ['loam', 'Loam']),
          },
        ],
      },
    },
  }
  const sim = await simulator({ [TARGET]: seed })
  const env = { [VARIABLE]: sim.env[VARIABLE] as string }
  return {
    api: createApi({ fetch: withRecords(sim.sim?.fetch as typeof fetch), key: env[VARIABLE] as string }),
    env,
    portal: String(sim.portals[TARGET]?.portalId),
    backend: () => {
      const { ui: _, ...rest } = sim
      return rest
    },
  }
}

/** `fetch` that also answers the company record paths from memory, as HubSpot's objects API does for one record. */
function withRecords(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  const records = new Map<string, Record<string, string>>()
  let next = 70_001
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const match = RECORD_PATH.exec(url.pathname)
    if (!match) {
      return fetch(input, init)
    }
    // The key must be the portal's, as for every other path: account-info answers only to it.
    const auth = await fetch(new URL('/account-info/2026-09/details', url), { headers: init.headers ?? {} })
    if (auth.status !== 200) {
      return auth
    }
    const json = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status })
    const [, id] = match
    const method = init.method ?? 'GET'
    if (id === undefined && method === 'POST') {
      const created = String(next)
      next += 1
      records.set(created, { ...JSON.parse(String(init.body)).properties, hs_object_id: created })
      return json(201, { id: created, properties: records.get(created), archived: false })
    }
    const record = id === undefined ? undefined : records.get(id)
    if (!record || id === undefined) {
      return json(404, { status: 'error', category: 'OBJECT_NOT_FOUND', message: 'resource not found' })
    }
    if (method === 'DELETE') {
      records.delete(id)
      return json(204)
    }
    const names = (url.searchParams.get('properties') ?? '').split(',').filter(Boolean)
    const properties = Object.fromEntries(names.map((n) => [n, record[n] ?? null]))
    return json(200, { id, properties: { ...properties, hs_object_id: id }, archived: false })
  }
}

export interface ScopeSettings {
  allowDestroy?: boolean
  /** A custom object of the run (its name, with the prefix) added to the objects, every property of it in scope. */
  custom?: string
  /** Adds deals to the objects, with no setting: only the deal pipelines the files define are in scope. */
  deals?: true
  /** The run's names (before the prefix) the pull scope includes. The nursery by default. */
  include?: string[]
  mode?: Mode
}

/**
 * Writes kalup.config.ts as init does, with a pull scope of the run's own names only: `custom: false`, and `include`
 * listing each. Every command then reads the whole portal but plans nothing outside the run.
 */
export function scopedConfig(j: Journey, run: LiveRun, settings: ScopeSettings = {}): void {
  const include = (settings.include ?? NURSERY).map(run.name)
  const text = write('config', {
    imports: [],
    ...(settings.mode ? { mode: settings.mode } : {}),
    objects: {
      [OBJECT]: { custom: false, include },
      ...(settings.deals ? { deals: {} } : {}),
      ...(settings.custom ? { [settings.custom]: {} } : {}),
    },
    targets: {
      [TARGET]: {
        portalId: run.portalId,
        ...(settings.allowDestroy ? { allowDestroy: true } : {}),
        credentials: { read: { env: VARIABLE } },
      },
    },
  })
  writeFileSync(join(j.dir, 'kalup.config.ts'), text)
}

/** The scoped project and its first pull, which writes the nursery's object file and records its base. */
export async function pulled(j: Journey, run: LiveRun, settings: ScopeSettings = {}): Promise<void> {
  scopedConfig(j, run, settings)
  const out = await j.kalup('pull')
  if (out.exitCode !== 0) {
    throw new Error(`kalup pull exited ${out.exitCode}: ${out.stdout}${out.stderr}`)
  }
}

/** The pull, then an apply that adopts it, so Kalup owns the run's nursery. */
export async function adopted(j: Journey, run: LiveRun): Promise<void> {
  await pulled(j, run)
  const out = await j.kalup('apply', '--yes')
  if (out.exitCode !== 0) {
    throw new Error(`kalup apply exited ${out.exitCode}: ${out.stdout}${out.stderr}`)
  }
}
