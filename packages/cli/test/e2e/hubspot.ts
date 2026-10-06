// The live tier's HubSpot side: what a live journey sends to HubSpot outside kalup. It seeds a journey's portal,
// stands for a person editing it in the HubSpot UI, and creates and deletes the one CRM record J12 reads. The client,
// the account guard, the run manifest and the cleanup are the conformance runner's (scripts/conformance/client.mjs),
// with the journeys' prefix, kalup_e2e_<run id>_: every create is written to the run manifest, flushed to disk, before
// it is sent; a write goes only to a resource the manifest names with the run prefix, and cleanup archives exactly
// those. The key goes out in the Authorization header and nowhere else, and the manifest holds no portal ID.
//
// Node builtins and the runner's client only, so `pnpm test:live:cleanup` runs this file with Node's type stripping:
//
//   node packages/cli/test/e2e/hubspot.ts cleanup
//
// archives what every unfinished live run manifest under live-runs/e2e/ names, after the same guard a run passes.
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import {
  type Cleaned,
  type Client,
  cleanup,
  createClient,
  E2E,
  guard,
  type Manifest,
  newManifest as newRunManifest,
  type Poll,
  paths,
  poller,
  READ_DEADLINE_MS,
  readManifest,
  prefixOf as runPrefix,
} from '../../../../scripts/conformance/client.mjs'

export type { Manifest, ManifestData, Named } from '../../../../scripts/conformance/client.mjs'

/** A labels list as HubSpot answers it. */
interface LabelsList {
  results?: { category: string; label: string | null; typeId: number }[]
}

/** The standard objects a journey names by name in a path. */
const STANDARD = new Set(['companies', 'contacts', 'deals', 'tickets'])

/** The variables the live tier reads: the key of the test portal, and its portal ID. Both are required. */
export const LIVE_KEY = 'KALUP_LIVE_KEY'
export const LIVE_PORTAL = 'KALUP_LIVE_PORTAL'
/** Where a live run writes its manifests and evidence, gitignored. KALUP_LIVE_RUNS moves it. */
export const RUNS = fileURLToPath(new URL('../../../../live-runs/', import.meta.url))

const PORTAL_ID = /^[1-9]\d{0,14}$/

/** The runner's client over one key, and its poll: spaced out and polling every 500 ms live, at once simulated. */
export interface Api {
  client: Client
  poll: Poll
}

export function createApi(options: { fetch: typeof globalThis.fetch; key: string; live?: boolean }): Api {
  const { fetch, key, live = false } = options
  const sleep = (ms: number) => (ms > 0 ? new Promise<void>((done) => setTimeout(done, ms)) : Promise.resolve())
  return {
    client: createClient({ fetch, key, sleep, gapMs: live ? 150 : 0 }),
    poll: poller({ sleep, now: () => performance.now(), intervalMs: live ? 500 : 0, deadlineMs: READ_DEADLINE_MS }),
  }
}

/**
 * The key and portal ID from the environment, else from `file`, the .env at the repository root. Throws, naming the
 * variable, when either is missing: a live run writes only to the portal a person named. Nothing is printed.
 */
export function liveSettings(
  env: NodeJS.ProcessEnv = process.env,
  file = fileURLToPath(new URL('../../../../.env', import.meta.url)),
): { key: string; portal: string } {
  const dotenv = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
  const key = env[LIVE_KEY] || dotenv[LIVE_KEY]
  const portal = env[LIVE_PORTAL] || dotenv[LIVE_PORTAL]
  if (!key) {
    throw new Error(
      `set ${LIVE_KEY} to a service key of an authorized developer test account (see docs/hubspot.md), or KALUP_LIVE_BACKEND=sim to run against the simulator. Nothing was sent.`,
    )
  }
  if (!portal) {
    throw new Error(
      `set ${LIVE_PORTAL} to the ID of the test portal ${LIVE_KEY} belongs to: a live run writes only to the portal you name. Nothing was sent.`,
    )
  }
  return { key, portal }
}

/**
 * The runner's guard with the portal `portal` names: account-info must answer for that portal, and it must be a
 * developer test account or a sandbox. Throws the refusal otherwise, before anything is written.
 */
export async function guarded(api: Api, portal: string): Promise<{ accountType: string; portalId: number }> {
  if (!PORTAL_ID.test(portal)) {
    throw new Error(`${LIVE_PORTAL} holds a portal ID, a positive integer. Nothing was written.`)
  }
  const portalId = Number(portal)
  const checked = await guard(api.client, portalId, LIVE_KEY)
  if (checked.refusal !== undefined) {
    throw new Error(checked.refusal)
  }
  return { accountType: checked.account.accountType, portalId }
}

export function newRunId(): string {
  return randomBytes(4).toString('hex')
}

export function prefixOf(runId: string): string {
  return runPrefix(runId, E2E)
}

/** A new manifest at `file` for a journey's run, on disk before the run sends anything that changes the portal. */
export function newManifest(
  file: string,
  fields: { backend: 'hubspot' | 'simulator'; journey: string; runId: string },
): Manifest {
  const { runId, journey, backend } = fields
  return newRunManifest(file, { runId, prefix: prefixOf(runId), journey, backend })
}

/** A property as HubSpot's properties API returns it; the fields the journeys read. */
export interface HubSpotProperty {
  archived?: boolean
  description: string
  fieldType: string
  formField: boolean
  groupName: string
  label: string
  name: string
  options: { description?: string; displayOrder: number; hidden: boolean; label: string; value: string }[]
  type: string
}

/** A pipeline as HubSpot's pipelines API returns it; the fields the journeys read. */
export interface HubSpotPipeline {
  label: string
  stages: { displayOrder: number; id: string; label: string; metadata: Record<string, string> }[]
}

export interface HubSpotRecord {
  id: string
  properties: Record<string, string | null>
}

/** A custom object schema as the schemas list returns it; the fields the journeys read. */
export interface HubSpotSchema {
  description?: string | null
  labels: { plural?: string; singular?: string }
  name: string
  objectTypeId: string
  primaryDisplayProperty?: string
  requiredProperties?: string[]
  searchableProperties?: string[]
  secondaryDisplayProperties?: string[]
}

/** Someone working in the HubSpot UI of the run's portal, through the API, on the run's own resources only. */
export interface LiveUi {
  createGroup: (objectType: string, group: { label: string; name: string }) => Promise<void>
  createProperty: (objectType: string, input: Record<string, unknown> & { name: string }) => Promise<void>
  createRecord: (objectType: string, name: string, properties: Record<string, string>) => Promise<string>
  deleteRecord: (objectType: string, id: string) => Promise<void>
  /**
   * Relabels both sides of an association label of a pair with a custom object the run's manifest names, by the type
   * ID of the direction `from` to `to`, and waits until the labels list shows it.
   */
  editLabel: (pair: [from: string, to: string], typeId: number, labels: [string, string]) => Promise<void>
  editProperty: (objectType: string, name: string, change: Record<string, unknown>) => Promise<void>
  /** Edits a custom object the run's manifest names, sending every field the schema PATCH takes. */
  editSchema: (name: string, change: Partial<HubSpotSchema>) => Promise<void>
  /** Relabels a stage of a pipeline the run's manifest names. */
  editStage: (objectType: string, pipeline: string, stage: string, label: string) => Promise<void>
  /** The user-defined associations of the direction `from` to `to`, each a standard object or custom object name. */
  labels: (from: string, to: string) => Promise<{ label: string | null; typeId: number }[]>
  /** The pipeline under this ID, its stages in display order; undefined when HubSpot holds none. */
  pipeline: (objectType: string, id: string) => Promise<HubSpotPipeline | undefined>
  /** The property under this name, archived or not. Throws when HubSpot holds none. */
  property: (objectType: string, name: string) => Promise<HubSpotProperty>
  readRecord: (objectType: string, id: string, names: string[]) => Promise<HubSpotRecord>
  /** The active custom object of this name as the schemas list shows it; undefined when HubSpot holds none. */
  schema: (name: string) => Promise<HubSpotSchema | undefined>
}

/** The names a groups list answered with; none when it did not answer 200. */
function groupNames(answer: { body: unknown; status: number | null }): string[] {
  const results = (answer.body as { results?: { name: string }[] } | undefined)?.results
  return answer.status === 200 ? (results ?? []).map((g) => g.name) : []
}

function refused(what: string, answer: { body: unknown; error: string | null; status: number | null }): Error {
  return new Error(`${what} answered ${answer.status ?? answer.error}: ${JSON.stringify(answer.body)}`)
}

/**
 * The UI of the run's portal over `api`, writing only what `manifest` names. Each write waits until a read shows it,
 * as a person would before moving on.
 */
export function liveUi(api: Api, manifest: Manifest): LiveUi {
  const { client, poll } = api
  client.manifest = manifest
  async function readProperty(objectType: string, name: string): Promise<HubSpotProperty | undefined> {
    const live = await client.read(paths.property(objectType, name))
    if (live.status === 200) {
      return live.body as HubSpotProperty
    }
    const archived = await client.read(paths.property(objectType, name), { query: { archived: 'true' } })
    return archived.status === 200 ? (archived.body as HubSpotProperty) : undefined
  }
  // The path segment of an object: a standard object's name, a custom object's type ID.
  async function typeOf(name: string): Promise<string> {
    if (STANDARD.has(name)) {
      return name
    }
    const schema = await readSchema(name)
    if (!schema) {
      throw new Error(`HubSpot holds no custom object ${name}`)
    }
    return schema.objectTypeId
  }
  async function readLabels(from: string, to: string): Promise<{ label: string | null; typeId: number }[]> {
    const answer = await client.read(paths.labels(await typeOf(from), await typeOf(to)))
    if (answer.status !== 200) {
      throw refused(`the labels list of ${from} and ${to}`, answer)
    }
    const results = (answer.body as LabelsList | undefined)?.results ?? []
    return results.filter((r) => r.category === 'USER_DEFINED').map(({ label, typeId }) => ({ label, typeId }))
  }
  // The list, not the single read: after a write the single read can serve the schema as it was (observed 2026-10-05).
  // The list apply reads, without definitions or audit fields: the one apply's read-back found current.
  async function readSchema(name: string): Promise<HubSpotSchema | undefined> {
    const query = {
      includePropertyDefinitions: 'false',
      includeAssociationDefinitions: 'false',
      includeAuditMetadata: 'false',
    }
    const listed = await client.read(paths.schemas, { query })
    const results = (listed.body as { results?: HubSpotSchema[] } | undefined)?.results ?? []
    return results.find((s) => s.name === name)
  }
  async function seen(what: string, look: () => Promise<boolean>): Promise<void> {
    if (!(await poll(look)).visible) {
      throw new Error(`${what} did not read back within ${READ_DEADLINE_MS / 1000} seconds`)
    }
  }
  return {
    async createGroup(objectType, group) {
      const resource = { type: 'group', objectType, name: group.name } as const
      const answer = await client.create(resource, paths.groups(objectType), group)
      if (answer.status !== 201) {
        throw refused(`the create of group:${objectType}/${group.name}`, answer)
      }
      await seen(`group:${objectType}/${group.name}`, async () =>
        groupNames(await client.read(paths.groups(objectType))).includes(group.name),
      )
    },
    async createProperty(objectType, input) {
      const resource = { type: 'property', objectType, name: input.name } as const
      const answer = await client.create(resource, paths.properties(objectType), input)
      if (answer.status !== 201) {
        throw refused(`the create of property:${objectType}/${input.name}`, answer)
      }
      await seen(
        `property:${objectType}/${input.name}`,
        async () => (await readProperty(objectType, input.name))?.archived === false,
      )
    },
    async editProperty(objectType, name, change) {
      const resource = { type: 'property', objectType, name } as const
      const answer = await client.write(resource, 'PATCH', paths.property(objectType, name), change)
      if (answer.status !== 200) {
        throw refused(`the edit of property:${objectType}/${name}`, answer)
      }
      const shows = (p: HubSpotProperty | undefined) =>
        p !== undefined &&
        Object.entries(change).every(([field, value]) =>
          field === 'options'
            ? JSON.stringify(p.options.map((o) => o.value)) ===
              JSON.stringify((value as { value: string }[]).map((o) => o.value))
            : p[field as keyof HubSpotProperty] === value,
        )
      await seen(`the edit of property:${objectType}/${name}`, async () => shows(await readProperty(objectType, name)))
    },
    async pipeline(objectType, id) {
      const answer = await client.read(paths.pipeline(objectType, id))
      if (answer.status !== 200) {
        return undefined
      }
      const pipeline = answer.body as HubSpotPipeline
      return { ...pipeline, stages: [...pipeline.stages].sort((a, b) => a.displayOrder - b.displayOrder) }
    },
    async editStage(objectType, pipeline, stage, label) {
      // A stage is the pipeline's: the manifest names the pipeline, and cleanup deletes it with its stages.
      const resource = { type: 'pipeline', objectType, name: pipeline } as const
      const answer = await client.write(resource, 'PATCH', paths.stage(objectType, pipeline, stage), { label })
      if (answer.status !== 200) {
        throw refused(`the edit of stage ${stage}`, answer)
      }
      await seen(`the edit of stage ${stage}`, async () => {
        const read = await client.read(paths.pipeline(objectType, pipeline))
        return (
          (read.body as HubSpotPipeline | undefined)?.stages.some((st) => st.id === stage && st.label === label) ===
          true
        )
      })
    },
    schema: readSchema,
    labels: readLabels,
    async editLabel([from, to], typeId, [label, inverseLabel]) {
      const owner = [from, to].find((name) => !STANDARD.has(name)) ?? ''
      const resource = { type: 'object', objectType: 'schemas', name: owner } as const
      const path = paths.labels(await typeOf(from), await typeOf(to))
      const answer = await client.write(resource, 'PUT', path, { associationTypeId: typeId, label, inverseLabel })
      if (answer.status !== 204 && answer.status !== 200) {
        throw refused(`the edit of association type ${typeId}`, answer)
      }
      await seen(`the edit of association type ${typeId}`, async () =>
        (await readLabels(from, to)).some((l) => l.typeId === typeId && l.label === label),
      )
    },
    async editSchema(name, change) {
      const now = await readSchema(name)
      if (!now) {
        throw new Error(`HubSpot holds no custom object ${name}`)
      }
      // Every field: a PATCH that leaves one out can bring it back as an older copy held it (observed 2026-10-05).
      const { description, ...rest } = { ...now, ...change }
      const body = {
        labels: rest.labels,
        primaryDisplayProperty: rest.primaryDisplayProperty,
        secondaryDisplayProperties: rest.secondaryDisplayProperties ?? [],
        requiredProperties: rest.requiredProperties ?? [],
        searchableProperties: rest.searchableProperties ?? [],
        ...(description ? { description, clearDescription: false } : { clearDescription: true }),
      }
      const resource = { type: 'object', objectType: 'schemas', name } as const
      const answer = await client.write(resource, 'PATCH', paths.schema(now.objectTypeId), body)
      if (answer.status !== 200) {
        throw refused(`the edit of object:${name}`, answer)
      }
      await seen(`the edit of object:${name}`, async () => {
        const after = await readSchema(name)
        return (
          after !== undefined &&
          Object.entries(change).every(
            ([k, v]) => JSON.stringify(after[k as keyof HubSpotSchema]) === JSON.stringify(v),
          )
        )
      })
    },
    async property(objectType, name) {
      const found = await readProperty(objectType, name)
      if (!found) {
        throw new Error(`HubSpot holds no property ${name} on ${objectType}`)
      }
      return found
    },
    async createRecord(objectType, name, properties) {
      const resource = { type: 'record', objectType, name } as const
      const answer = await client.create(resource, paths.records(objectType), { properties: { name, ...properties } })
      const id = (answer.body as { id?: unknown } | undefined)?.id
      if (answer.status !== 201 || typeof id !== 'string') {
        throw refused(`the create of record:${objectType}/${name}`, answer)
      }
      manifest.add({ ...resource, id })
      return id
    },
    async readRecord(objectType, id, names) {
      const found = await poll(async () => {
        const answer = await client.read(paths.record(objectType, id), { query: { properties: names.join(',') } })
        return answer.status === 200 ? (answer.body as HubSpotRecord) : undefined
      })
      if (!found.value) {
        throw new Error(`record ${id} of ${objectType} did not read back`)
      }
      return found.value
    },
    async deleteRecord(objectType, id) {
      const held = manifest.data.resources.find(
        (r) => r.type === 'record' && r.objectType === objectType && r.id === id,
      )
      if (!held) {
        throw new Error(`refused: record ${id} of ${objectType} is not in the run manifest`)
      }
      const answer = await client.write(held, 'DELETE', paths.record(objectType, id))
      if (answer.status !== 204) {
        throw refused(`the delete of record ${id}`, answer)
      }
    },
  }
}

/** The runner's cleanup of what `manifest` names, recorded in the manifest. */
export async function cleanRun(api: Api, manifest: Manifest): Promise<Cleaned> {
  api.client.manifest = manifest
  const cleaned = await cleanup(api.client, manifest, api.poll)
  manifest.record({ at: new Date().toISOString(), ...cleaned })
  return cleaned
}

/** Cleans every unfinished manifest of a live HubSpot run under `dir`; returns each run's result. */
export async function cleanupAll(api: Api, dir: string): Promise<{ cleaned: Cleaned; file: string }[]> {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.manifest.json')) : []
  const out: { cleaned: Cleaned; file: string }[] = []
  for (const file of files.sort()) {
    const manifest = readManifest(join(dir, file), E2E)
    if (manifest.data.backend === 'hubspot' && manifest.data.cleanup?.complete !== true) {
      // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one run's manifest at a time
      out.push({ file, cleaned: await cleanRun(api, manifest) })
    }
  }
  return out
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] !== 'cleanup') {
    process.stderr.write('Usage: node packages/cli/test/e2e/hubspot.ts cleanup\n')
    return 2
  }
  let runs: { cleaned: Cleaned; file: string }[]
  const dir = join(resolve(process.env.KALUP_LIVE_RUNS ?? RUNS), 'e2e')
  try {
    const { key, portal } = liveSettings()
    const api = createApi({ fetch: globalThis.fetch, key, live: true })
    await guarded(api, portal)
    runs = await cleanupAll(api, dir)
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    return 2
  }
  for (const { file, cleaned } of runs) {
    process.stdout.write(`${file}: ${cleaned.complete ? 'complete' : 'incomplete'}\n`)
    for (const r of cleaned.resources) {
      const detail = r.detail ?? (r.status === undefined ? undefined : String(r.status))
      process.stdout.write(`  ${r.result.padEnd(16)} ${r.address}${detail ? ` (${detail})` : ''}\n`)
    }
  }
  process.stdout.write(runs.length === 0 ? `No unfinished live runs in ${dir}.\n` : '')
  return runs.every((r) => r.cleaned.complete) ? 0 : 3
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2))
}
