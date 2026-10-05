// The HubSpot client of Kalup's live runs, the conformance runner and the live e2e journeys
// (packages/cli/test/e2e/hubspot.ts): the account guard, the run manifest and the cleanup. Reads go anywhere the run
// needs; a write goes only to a resource the manifest names and whose name carries the run prefix, and a create is
// written to the manifest, flushed to disk, before it is sent. The key goes out in the Authorization header and
// nowhere else: the request log keeps method, path, status, HubSpot's correlationId and the rate-limit header names,
// never a body. client.d.mts types it for the TypeScript tests.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'

/** The API version every path below pins, as the CLI's endpoint registry does. */
export const API = '2026-09'
export const MANIFEST_FORMAT = 'kalup-conformance-manifest/1'
/** How long a write may take to read back: the deadline apply reads back for. */
export const READ_DEADLINE_MS = 60_000

/** The first part of every name a run creates: the conformance runner's, and the live e2e journeys'. */
export const CONFORMANCE = 'kalupconf'
export const E2E = 'kalup_e2e'
/** The account types a live run may write to. There is no override. */
export const ACCOUNT_TYPES = new Set(['DEVELOPER_TEST', 'SANDBOX'])

const RUN_ID = /^[0-9a-f]{8}$/
/** Every name a run creates. A write is refused unless the name matches, whatever the manifest says its prefix is. */
const RUN_NAME = /^(?:kalupconf|kalup_e2e)_[0-9a-f]{8}_[a-z0-9_]+$/
const ACCOUNT_TYPE = /^[A-Z_]{1,40}$/
const CATEGORY = /^[A-Z_]{1,60}$/
const CORRELATION_ID = /^[0-9a-fA-F-]{8,64}$/

const BASE_URL = 'https://api.hubapi.com'
const TIMEOUT_MS = 30_000
const RATE_HEADER = /^x-hubspot-ratelimit-/
/** A 429 is waited out this many times before the answer stands. */
const RATE_RETRIES = 3
/** A 429 without Retry-After waits HubSpot's burst window. */
const RATE_WAIT_MS = 10_000

export const paths = {
  accountInfo: `/account-info/${API}/details`,
  limits: (kind) => `/crm/limits/${API}/${kind}`,
  schemas: `/crm-object-schemas/${API}/schemas`,
  schema: (objectType) => `/crm-object-schemas/${API}/schemas/${encodeURIComponent(objectType)}`,
  properties: (objectType) => `/crm/properties/${API}/${encodeURIComponent(objectType)}`,
  property: (objectType, name) =>
    `/crm/properties/${API}/${encodeURIComponent(objectType)}/${encodeURIComponent(name)}`,
  groups: (objectType) => `/crm/properties/${API}/${encodeURIComponent(objectType)}/groups`,
  group: (objectType, name) =>
    `/crm/properties/${API}/${encodeURIComponent(objectType)}/groups/${encodeURIComponent(name)}`,
  pipelines: (objectType) => `/crm/pipelines/${API}/${encodeURIComponent(objectType)}`,
  pipeline: (objectType, id) => `/crm/pipelines/${API}/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`,
  stages: (objectType, id) =>
    `/crm/pipelines/${API}/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}/stages`,
  stage: (objectType, id, stageId) =>
    `/crm/pipelines/${API}/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}/stages/${encodeURIComponent(stageId)}`,
  // The live journeys' one record: Kalup reads no records, so the endpoint registry has no path for them.
  records: (objectType) => `/crm/objects/${API}/${encodeURIComponent(objectType)}`,
  record: (objectType, id) => `/crm/objects/${API}/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`,
}

/**
 * A client over `fetch` with one key. `gapMs` spaces requests out; `sleep` waits (tests pass one that returns at
 * once). `manifest` is attached once the run has one, and every write checks it.
 */
export function createClient({ fetch, key, sleep, gapMs }) {
  const log = []
  const client = { log, manifest: undefined, read, write, create }

  async function send(method, path, { query = {}, body, hide } = {}, retries = RATE_RETRIES) {
    if (log.length > 0 && gapMs > 0) {
      await sleep(gapMs)
    }
    const url = new URL(path, BASE_URL)
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value)
    }
    const headers = { authorization: `Bearer ${key}`, accept: 'application/json' }
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
    }
    const entry = {
      method,
      path: hide === undefined ? path : path.replace(encodeURIComponent(hide), '{name}'),
      query,
      status: null,
      correlationId: null,
      rateHeaders: [],
      ms: 0,
    }
    log.push(entry)
    const started = performance.now()
    const answer = await exchange(fetch, url.href, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    entry.ms = Math.round(performance.now() - started)
    entry.status = answer.status
    entry.correlationId = answer.correlationId
    entry.rateHeaders = answer.rateHeaders
    entry.error = answer.error
    if (answer.status === 429 && retries > 0) {
      await sleep(retryAfterMs(answer.headers))
      return send(method, path, { query, body, hide }, retries - 1)
    }
    return answer
  }

  /** A GET. `hide` names a portal name the log shows as {name}: one the run did not create. */
  function read(path, options = {}) {
    return send('GET', path, options)
  }

  /** A write to a resource of this run. Anything the manifest does not name is refused before it is sent. */
  function write(resource, method, path, body) {
    const refusal = refuseWrite(client.manifest, resource)
    if (refusal) {
      throw new Error(refusal)
    }
    return send(method, path, { body })
  }

  /** Records `resource` in the manifest, on disk, then sends its create. */
  function create(resource, path, body) {
    client.manifest?.add(resource)
    return write(resource, 'POST', path, body)
  }

  return client
}

// One request and its answer, with a timeout. A network failure, a timeout or a body cut short has no status.
async function exchange(fetch, url, init) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const body = parseJson(response.status === 204 ? '' : await response.text())
    const correlationId =
      (typeof body?.correlationId === 'string' ? body.correlationId : null) ??
      response.headers.get('x-hubspot-correlation-id')
    const rateHeaders = [...response.headers.keys()].filter((name) => RATE_HEADER.test(name)).sort()
    return { status: response.status, body, headers: response.headers, correlationId, rateHeaders, error: null }
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return {
      status: null,
      body: undefined,
      headers: new Headers(),
      correlationId: null,
      rateHeaders: [],
      error: timedOut ? 'timeout' : 'network',
    }
  }
}

function parseJson(text) {
  try {
    return text === '' ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

function retryAfterMs(headers) {
  const seconds = Number(headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_WAIT_MS
}

/** The prefix of every resource the run `runId` creates: `CONFORMANCE` or `E2E`, then the run ID. */
export function prefixOf(runId, namespace = CONFORMANCE) {
  return `${namespace}_${runId}_`
}

/**
 * account-info with the key from `variable`: it must answer, belong to `portalId` and be a developer test account or a
 * sandbox. `{ refusal }` otherwise, before anything is written; else `{ account: { accountType } }`.
 */
export async function guard(client, portalId, variable) {
  const answer = await client.read(paths.accountInfo)
  if (answer.status === 403) {
    return {
      refusal: `E_GUARD: account-info answered ${answered(answer)}. The key may lack a scope account-info needs: HubSpot's reference names oauth. Record this answer as docs/hubspot.md describes, then add the scope to the key if the key setup offers it and run again. Nothing was written.`,
    }
  }
  if (answer.status === 401) {
    return {
      refusal: `E_GUARD: account-info answered ${answered(answer)}: HubSpot did not accept the key. Check that ${variable} holds a current key of portal ${portalId}. Nothing was written.`,
    }
  }
  if (answer.status !== 200) {
    return {
      refusal: `E_GUARD: account-info answered ${answer.status ?? answer.error}, so the key's portal is unknown. Nothing was written. Check that ${variable} holds a key of portal ${portalId}.`,
    }
  }
  if (answer.body?.portalId !== portalId) {
    return {
      refusal: `E_PORTAL_MISMATCH: the key in ${variable} does not belong to portal ${portalId}. Nothing was written.`,
    }
  }
  const accountType = String(answer.body?.accountType ?? '')
  if (!ACCOUNT_TYPES.has(accountType)) {
    const shown = ACCOUNT_TYPE.test(accountType) ? accountType : 'unknown'
    return {
      refusal: `E_ACCOUNT_TYPE: portal ${portalId} is a ${shown} account. Live runs go only to a developer test account or a sandbox (DEVELOPER_TEST, SANDBOX), with no override. Nothing was written.`,
    }
  }
  return { account: { accountType } }
}

/**
 * A refused answer as the person records it: the status, HubSpot's category and its correlationId, each shown only
 * when it has the shape HubSpot gives it.
 */
export function answered(answer) {
  const category = String(answer.body?.category ?? '')
  const correlationId = String(answer.correlationId ?? '')
  const details = [
    ...(CATEGORY.test(category) ? [category] : []),
    ...(CORRELATION_ID.test(correlationId) ? [`correlationId ${correlationId}`] : []),
  ]
  return details.length > 0 ? `${answer.status} (${details.join(', ')})` : String(answer.status)
}

/**
 * A poll over `probe` until it returns a truthy value: { visible, ms, polls, value }. It stops at `deadlineMs`, and
 * after one poll per 500 ms of the deadline at most, so a sleep that returns at once still ends.
 */
export function poller({ sleep, now, intervalMs, deadlineMs }) {
  return function poll(probe, overrides = {}) {
    const interval = overrides.intervalMs ?? intervalMs
    const deadline = overrides.deadlineMs ?? deadlineMs
    const maxPolls = Math.ceil(deadline / Math.max(interval, 500))
    const started = now()
    async function attempt(polls) {
      const value = await probe()
      const ms = Math.round(now() - started)
      if (value) {
        return { visible: true, ms, polls, value }
      }
      if (ms >= deadline || polls >= maxPolls) {
        return { visible: false, ms, polls }
      }
      await sleep(interval)
      return attempt(polls + 1)
    }
    return attempt(1)
  }
}

/** Why a write to `resource` is refused, or undefined when the manifest names it and its name has the run prefix. */
export function refuseWrite(manifest, resource) {
  if (!manifest) {
    return 'refused: the run has no manifest yet, so it writes nothing'
  }
  if (!(RUN_NAME.test(resource.name) && resource.name.startsWith(manifest.data.prefix))) {
    return `refused: ${addressOf(resource)} does not carry the run prefix ${manifest.data.prefix}`
  }
  if (!manifest.holds(resource)) {
    return `refused: ${addressOf(resource)} is not in the run manifest`
  }
  return undefined
}

export function addressOf({ type, objectType, name }) {
  return `${type}:${objectType}/${name}`
}

/**
 * A new manifest at `file`, written before the run sends anything that changes the portal. `fields` holds `runId` and
 * `prefix`, and whatever else the run records: the runner its portal ID and mode, a journey its name and backend.
 */
export function newManifest(file, fields) {
  const data = { format: MANIFEST_FORMAT, ...fields, createdAt: new Date().toISOString(), resources: [] }
  writeDurably(file, data)
  return manifestOf(file, data)
}

/**
 * The manifest at `file`, for a cleanup. Its prefix must be the one its run ID gives in `namespace`, so it cannot widen
 * the cleanup.
 */
export function readManifest(file, namespace = CONFORMANCE) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (data?.format !== MANIFEST_FORMAT || !Array.isArray(data.resources)) {
    throw new Error(`${file} is not a ${MANIFEST_FORMAT} file`)
  }
  if (!RUN_ID.test(data.runId) || data.prefix !== prefixOf(data.runId, namespace)) {
    throw new Error(
      `${file} does not hold a run's prefix: it must be ${namespace}_<run id>_, with the manifest's eight-character hexadecimal run ID. Nothing was written.`,
    )
  }
  return manifestOf(file, data)
}

function manifestOf(file, data) {
  const keys = new Set(data.resources.map(addressOf))
  return {
    data,
    file,
    holds: (resource) => keys.has(addressOf(resource)),
    /**
     * Adds `resource`, or notes a new create of one it holds, with the time as `sentAt`, and flushes the file to disk
     * before returning. Cleanup waits for the read-after-write deadline after `sentAt` before it calls a miss absent.
     * A record's `id`, once its create has answered, is added the same way.
     */
    add(resource) {
      const sentAt = new Date().toISOString()
      const { type, objectType, name, dataSensitivity, id } = resource
      const held = data.resources.find((r) => addressOf(r) === addressOf(resource))
      if (id !== undefined && held) {
        held.id = id
      } else if (held) {
        held.sentAt = sentAt
      } else {
        keys.add(addressOf(resource))
        // A sensitive property reads only with its dataSensitivity, so cleanup needs it to find the property.
        const extra = { ...(dataSensitivity ? { dataSensitivity } : {}), ...(id === undefined ? {} : { id }) }
        data.resources.push({ type, objectType, name, ...extra, sentAt })
      }
      writeDurably(file, data)
    },
    record(result) {
      data.cleanup = result
      writeDurably(file, data)
    },
  }
}

// Written to a temporary file, flushed and renamed over the old one, so a crash leaves the old or the new manifest.
function writeDurably(file, data) {
  const temporary = `${file}.tmp`
  const fd = openSync(temporary, 'w')
  try {
    writeSync(fd, `${JSON.stringify(data, null, 2)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, file)
}

/**
 * Archives the manifest's resources that still exist, records first, then properties, then groups, then pipelines,
 * newest first, and verifies each; a record and a pipeline (with its stages) are deleted. A resource the manifest names
 * without the run prefix is refused, never archived. `poll` waits for a condition. A resource the reads miss is absent
 * only once the read-after-write deadline has passed since its last create was sent: until then, a create HubSpot
 * applied, even one answered with an error, may not read back yet.
 */
export async function cleanup(client, manifest, poll) {
  const resources = [...manifest.data.resources].reverse()
  const ordered = ['record', 'property', 'group', 'pipeline'].flatMap((type) =>
    resources.filter((r) => r.type === type),
  )
  const results = []
  for (const resource of ordered) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, a group only after its properties
    results.push({ address: addressOf(resource), ...(await cleanOne(client, manifest, resource, poll)) })
  }
  const settled = new Set(['archived', 'already-archived', 'absent', 'deleted'])
  return { complete: results.every((r) => settled.has(r.result)), resources: results }
}

function cleanOne(client, manifest, resource, poll) {
  const refusal = refuseWrite(manifest, resource)
  if (refusal) {
    return Promise.resolve({ result: 'refused', detail: refusal })
  }
  const sent = Date.parse(resource.sentAt ?? '')
  const waitMs = Number.isNaN(sent) ? 0 : Math.max(0, sent + READ_DEADLINE_MS - Date.now())
  // Reads until `look` finds the resource or the wait is over.
  const find = async (look) => (await poll(look, { deadlineMs: waitMs })).value
  if (resource.type === 'property') {
    return cleanProperty(client, resource, poll, find)
  }
  if (resource.type === 'group') {
    return cleanGroup(client, resource, poll, find)
  }
  if (resource.type === 'record') {
    return cleanRecord(client, resource)
  }
  if (resource.type === 'pipeline') {
    return cleanPipeline(client, resource, poll, find)
  }
  return Promise.resolve({ result: 'refused', detail: `unknown resource type ${resource.type}` })
}

async function cleanRecord(client, resource) {
  const { id, name, objectType } = resource
  if (id === undefined) {
    return {
      result: 'unknown',
      detail: `its create was sent but no ID came back: find the ${objectType} record named ${name} in HubSpot and delete it`,
    }
  }
  const removed = await client.write(resource, 'DELETE', paths.record(objectType, id))
  if (removed.status === 404) {
    return { result: 'absent' }
  }
  return removed.status === 204 ? { result: 'deleted' } : failed(removed)
}

async function cleanProperty(client, resource, poll, find) {
  const path = paths.property(resource.objectType, resource.name)
  const sensitivity = resource.dataSensitivity ? { dataSensitivity: resource.dataSensitivity } : {}
  // The property active, archived, or a failed read; undefined while both reads miss it.
  const found = await find(async () => {
    const live = await client.read(path, { query: sensitivity })
    if (live.status !== 404) {
      return live.status === 200 ? { live } : { failed: live }
    }
    const archived = await client.read(path, { query: { archived: 'true', ...sensitivity } })
    if (archived.status === 200 && archived.body?.archived === true) {
      return { archived }
    }
    return archived.status === 404 ? undefined : { failed: archived }
  })
  if (!found) {
    return { result: 'absent' }
  }
  if (found.failed) {
    return failed(found.failed)
  }
  if (found.archived) {
    return { result: 'already-archived' }
  }
  const removed = await client.write(resource, 'DELETE', path)
  if (removed.status !== 204 && removed.status !== 200) {
    return failed(removed)
  }
  const seen = await poll(async () => {
    const after = await client.read(path, { query: { archived: 'true', ...sensitivity } })
    return after.status === 200 && after.body?.archived === true
  })
  return settledBy(seen, removed)
}

// A pipeline is purged with its stages: no archive (observed 2026-10-01). A 404 on the single read is absence; the body
// of that 404 may be HTML or empty (observed 2026-10-05), so the status alone decides.
async function cleanPipeline(client, resource, poll, find) {
  const path = paths.pipeline(resource.objectType, resource.name)
  const found = await find(async () => {
    const live = await client.read(path)
    if (live.status === 404) {
      return undefined
    }
    return live.status === 200 ? { live } : { failed: live }
  })
  if (!found) {
    return { result: 'absent' }
  }
  if (found.failed) {
    return failed(found.failed)
  }
  const removed = await client.write(resource, 'DELETE', path)
  if (removed.status !== 204 && removed.status !== 200) {
    return failed(removed)
  }
  const seen = await poll(async () => (await client.read(path)).status === 404)
  const correlation = removed.correlationId ? { correlationId: removed.correlationId } : {}
  return seen.visible
    ? { result: 'deleted', ...correlation }
    : { result: 'unverified', status: removed.status, ...correlation }
}

async function cleanGroup(client, resource, poll, find) {
  const listPath = paths.groups(resource.objectType)
  // The group as the list shows it, or a failed read; undefined while the list does not show it.
  const found = await find(async () => {
    const listed = await client.read(listPath)
    if (listed.status !== 200) {
      return { failed: listed }
    }
    const group = listed.body?.results?.find((g) => g.name === resource.name)
    return group && { group }
  })
  if (!found) {
    return { result: 'absent' }
  }
  if (found.failed) {
    return failed(found.failed)
  }
  if (found.group.archived === true) {
    return { result: 'already-archived' }
  }
  const removed = await client.write(resource, 'DELETE', paths.group(resource.objectType, resource.name))
  if (removed.status !== 204 && removed.status !== 200) {
    return failed(removed)
  }
  const seen = await poll(async () => {
    const after = await client.read(listPath)
    return after.status === 200 && !after.body?.results?.some((g) => g.name === resource.name && g.archived !== true)
  })
  return settledBy(seen, removed)
}

// Archived when the read after the DELETE shows it; unverified when the deadline passed first.
function settledBy(seen, removed) {
  const correlation = removed.correlationId ? { correlationId: removed.correlationId } : {}
  return seen.visible
    ? { result: 'archived', ...correlation }
    : { result: 'unverified', status: removed.status, ...correlation }
}

function failed(answer) {
  return {
    result: 'failed',
    status: answer.status,
    ...(answer.error ? { error: answer.error } : {}),
    ...(answer.body?.category ? { category: answer.body.category } : {}),
    ...(answer.correlationId ? { correlationId: answer.correlationId } : {}),
  }
}
