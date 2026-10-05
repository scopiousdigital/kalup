// Plan's reads before it decides: the Limits Tracking readings, and the room they leave for the creates it plans. A
// reading HubSpot refuses is unreadable, never fatal, and blocks nothing: only a limit read as reached blocks. An
// unreadable property limit with property creates planned warns, since HubSpot answered 403 to a key without a
// crm.objects scope (observed on a developer test account, 2026-09-29). Limits Tracking reports limit and usage, nothing about the subscription.
// The association label readings only warn: HubSpot counts a deleted label for up to 40 s (observed 2026-10-05), and
// refuses a label past the cap with 437, which apply reports.

import { parseAddress } from '../ir/address.js'
import type { Address, Issue } from '../ir/types.js'
import type { IssueCode } from '../issues.js'
import { type HttpClient, HubSpotApiError } from '../lib/http.js'
import { plural } from '../lib/plural.js'
import { limitScope, registry } from '../lib/registry.js'
import { byCodeUnit } from '../loader/load.js'
import type { LimitReading } from '../plan/types.js'
import { objectOf, pairOf } from './units.js'

export interface LimitRequest {
  /** Read association-labels for these pairs of config keys. Plan asks when it creates a label. */
  associationPairs?: [string, string][]
  /** The type ID of each object read, standard or custom, by config key. A custom-properties reading keeps theirs. */
  objectTypeIds: Record<string, string>
  /** Read custom-object-types. Plan asks when it creates a custom object. */
  objectTypes: boolean
  /** Read pipelines. Plan asks when it creates a pipeline. */
  pipelines?: boolean
  /** Read custom-properties. Plan asks when it creates a property. */
  properties: boolean
}

export interface LimitBlock {
  detail: string
  fix: string
  reason: 'limit'
}

export interface Headroom {
  /** The planned creates a reached limit blocks, by address, in the order given. */
  blocked: Record<Address, LimitBlock>
  /**
   * W_LIMIT_HEADROOM for each limit with room for fewer creates than planned, and W_LIMIT_UNREADABLE when property
   * creates meet an unreadable property limit.
   */
  issues: Issue[]
}

type Figures = Omit<Extract<LimitReading, { status: 'read' }>, 'key' | 'status'>

// What HubSpot answered, as an unreadable reading's issue records it: E_SCOPE is a 403 and E_AUTH a 401. E_HTTP is any
// other error, or a 200 without integer limit and usage, and stays as it is.
const ANSWERED: Record<string, string> = { E_SCOPE: '403', E_AUTH: '401' }

interface ObjectTypesBody {
  limit?: unknown
  usage?: unknown
}

// GET /crm/limits/2026-09/pipelines (observed 2026-10-05): a limit and usage per standard object, and one overall
// limit and usage for the custom objects, whose entries carry usage alone.
interface PipelinesBody {
  customObjectTypes?: { overallLimit?: unknown; overallUsage?: unknown } | null
  hubspotDefinedObjectTypes?: ({ limit?: unknown; objectTypeId?: unknown; usage?: unknown } | null)[]
}

// GET /crm/limits/2026-09/associations/labels (observed 2026-10-05): one entry per direction of each pair that has a
// label, the object types named by type ID.
interface LabelsBody {
  results?: ({
    fromObjectType?: { objectTypeId?: unknown } | null
    limit?: unknown
    toObjectType?: { objectTypeId?: unknown } | null
    usage?: unknown
  } | null)[]
}

interface PropertiesBody {
  byObjectType?: ({ limit?: unknown; objectTypeId?: unknown; usage?: unknown } | null)[]
  overallLimit?: unknown
  overallUsage?: unknown
}

/** The Limits Tracking readings plan asked for, sorted by key. A network failure propagates as in every command. */
export async function preflight(http: HttpClient, request: LimitRequest): Promise<{ limits: LimitReading[] }> {
  const limits: LimitReading[] = []
  if ((request.associationPairs ?? []).length > 0) {
    limits.push(...(await labelReadings(http, request)))
  }
  if (request.objectTypes) {
    limits.push(
      await reading(registry.object.limitKey, async () => {
        // A body of any shape: a 200 without the figures is unreadable, never a failure.
        const body = await http.request<ObjectTypesBody | null>({ type: 'limits', path: 'customObjectTypes' })
        return figures(body?.limit, body?.usage)
      }),
    )
  }
  if (request.properties) {
    const observed = new Set(Object.values(request.objectTypeIds))
    limits.push(
      await reading(registry.property.limitKey, async () => {
        const body = await http.request<PropertiesBody | null>({ type: 'limits', path: 'customProperties' })
        const overall = figures(body?.overallLimit, body?.overallUsage)
        const listed = body?.byObjectType
        const byObjectType = (Array.isArray(listed) ? listed : [])
          .flatMap((item) => {
            // A number or string entry destructures to no figures; only null would throw.
            const { objectTypeId, limit, usage } = item ?? {}
            const entry = typeof objectTypeId === 'string' && observed.has(objectTypeId) && figures(limit, usage)
            return entry ? [{ objectTypeId: objectTypeId as string, ...entry }] : []
          })
          .sort((a, b) => byCodeUnit(a.objectTypeId, b.objectTypeId))
        return overall && (byObjectType.length > 0 ? { ...overall, byObjectType } : overall)
      }),
    )
  }
  if (request.pipelines) {
    const observed = new Set(Object.values(request.objectTypeIds))
    limits.push(
      await reading(registry.pipeline.limitKey, async () => {
        const body = await http.request<PipelinesBody | null>({ type: 'limits', path: 'pipelines' })
        // Without the custom object figures the reading is unreadable, which blocks nothing.
        const custom = body?.customObjectTypes
        const overall = figures(custom?.overallLimit, custom?.overallUsage)
        const listed = body?.hubspotDefinedObjectTypes
        const byObjectType = (Array.isArray(listed) ? listed : [])
          .flatMap((item) => {
            const { objectTypeId, limit, usage } = item ?? {}
            const entry = typeof objectTypeId === 'string' && observed.has(objectTypeId) && figures(limit, usage)
            return entry ? [{ objectTypeId: objectTypeId as string, ...entry }] : []
          })
          .sort((a, b) => byCodeUnit(a.objectTypeId, b.objectTypeId))
        return overall && (byObjectType.length > 0 ? { ...overall, byObjectType } : overall)
      }),
    )
  }
  return { limits }
}

/**
 * The association label readings, one per direction of each requested pair that HubSpot lists, keyed
 * `association-labels/<from>/<to>`: HubSpot lists only the pairs that have a label, so an unlisted direction has none. A
 * refused read is one unreadable reading.
 */
async function labelReadings(http: HttpClient, request: LimitRequest): Promise<LimitReading[]> {
  const key = registry.association.limitKey
  let listed: unknown
  try {
    listed = (await http.request<LabelsBody | null>({ type: 'limits', path: 'associationLabels' }))?.results
  } catch (error) {
    if (error instanceof HubSpotApiError) {
      return [{ key, status: 'unreadable', issue: error.issues[0]?.code ?? 'E_HTTP' }]
    }
    throw error
  }
  if (!Array.isArray(listed)) {
    return [{ key, status: 'unreadable', issue: 'E_HTTP' }]
  }
  const results = listed as NonNullable<LabelsBody['results']>
  const ids = request.objectTypeIds
  const out: LimitReading[] = []
  for (const [a, b] of request.associationPairs ?? []) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const found = results.find(
        (r) => r?.fromObjectType?.objectTypeId === ids[from] && r?.toObjectType?.objectTypeId === ids[to],
      )
      const entry = found && figures(found.limit, found.usage)
      if (entry && ids[from] !== undefined && ids[to] !== undefined) {
        out.push({ key: `${key}/${from}/${to}`, status: 'read', ...entry })
      }
    }
  }
  return out.sort((x, y) => byCodeUnit(x.key, y.key))
}

/**
 * The room each reading leaves for the planned `creates`. Custom objects count against custom-object-types. Properties
 * count against the overall custom-properties limit, and against their object's own entry, standard or custom, when
 * `objectTypeIds` (config key to type ID) names the object and the reading lists that ID; an object without an entry
 * meets the overall figure only. No room blocks every create it covers, with reason limit; less room than creates is
 * W_LIMIT_HEADROOM. A missing or unreadable reading blocks nothing; an unreadable property limit with property creates
 * is W_LIMIT_UNREADABLE. `target` names the target in the fix.
 */
export function headroom(
  limits: LimitReading[],
  creates: Address[],
  objectTypeIds: Record<string, string>,
  target: string,
): Headroom {
  const out: Headroom = { blocked: {}, issues: [] }
  pipelineRoom(out, limits, creates, objectTypeIds, target)
  labelRoom(out, limits, creates)
  const ofType = (type: string) => creates.filter((address) => parseAddress(address).type === type)
  const objectTypes = readOf(limits, registry.object.limitKey)
  if (objectTypes) {
    check(out, ofType('object'), objectTypes, 'custom objects', target)
  }
  const propertyCreates = ofType('property')
  const propertyLimit = limits.find((l) => l.key === registry.property.limitKey)
  if (propertyLimit?.status === 'unreadable' && propertyCreates.length > 0) {
    out.issues.push(unreadable(propertyLimit.issue, propertyCreates))
  }
  const properties = readOf(limits, registry.property.limitKey)
  if (!properties) {
    return out
  }
  check(out, propertyCreates, properties, 'custom properties', target)
  for (const [key, id] of Object.entries(objectTypeIds)) {
    const entry = properties.byObjectType?.find((e) => e.objectTypeId === id)
    if (entry) {
      const open = propertyCreates.filter((a) => a.startsWith(`property:${key}/`) && !Object.hasOwn(out.blocked, a))
      check(out, open, entry, `custom properties on ${key}`, target)
    }
  }
  return out
}

/**
 * The room the pipelines reading leaves for pipeline creates: a standard object's against its own entry, a custom
 * object's against the overall custom object figures. Called by headroom.
 */
function pipelineRoom(
  out: Headroom,
  limits: LimitReading[],
  creates: Address[],
  ids: Record<string, string>,
  target: string,
): void {
  const pipelines = readOf(limits, registry.pipeline.limitKey)
  if (!pipelines) {
    return
  }
  const byObject = new Map<string, Address[]>()
  for (const address of creates.filter((a) => parseAddress(a).type === 'pipeline')) {
    byObject.set(objectOf(address), [...(byObject.get(objectOf(address)) ?? []), address])
  }
  const custom: Address[] = []
  for (const [key, list] of byObject) {
    const id = Object.hasOwn(ids, key) ? ids[key] : undefined
    const entry = pipelines.byObjectType?.find((e) => e.objectTypeId === id)
    if (entry) {
      check(out, list, entry, `pipelines on ${key}`, target)
    } else if (!(id ?? '').startsWith('0-')) {
      custom.push(...list)
    }
  }
  check(out, custom, pipelines, 'custom object pipelines', target)
}

/**
 * The room the association label readings leave for the label creates of each pair, the fuller direction's: too little
 * warns, never blocks, as HubSpot counts a deleted label for up to 40 s. `creates` holds no plain association: HubSpot
 * does not count one. Called by headroom.
 */
function labelRoom(out: Headroom, limits: LimitReading[], creates: Address[]): void {
  const byPair = new Map<string, number>()
  for (const address of creates.filter((a) => parseAddress(a).type === 'association')) {
    const pair = [...pairOf(address)].sort(byCodeUnit).join('/')
    byPair.set(pair, (byPair.get(pair) ?? 0) + 1)
  }
  for (const [pair, count] of byPair) {
    const [a, b] = pair.split('/') as [string, string]
    const key = registry.association.limitKey
    const readings = [readOf(limits, `${key}/${a}/${b}`), readOf(limits, `${key}/${b}/${a}`)]
    const [fullest] = readings
      .filter((r): r is Figures => r !== undefined)
      .sort((x, y) => x.limit - x.usage - (y.limit - y.usage))
    const room = fullest ? Math.max(fullest.limit - fullest.usage, 0) : undefined
    if (fullest === undefined || room === undefined || room >= count) {
      continue
    }
    out.issues.push({
      code: 'W_LIMIT_HEADROOM',
      message: `the plan creates ${plural(count, 'association label')} between ${a} and ${b} and HubSpot reports room for ${room} more (limit ${fullest.limit}, ${fullest.usage} in use)`,
      fix: 'HubSpot counts a label deleted in the last 40 seconds: plan again, or delete labels of the pair that nothing uses',
    })
  }
}

// One limit over the creates it covers: no room left blocks them all, too little room warns.
function check(out: Headroom, creates: Address[], { limit, usage }: Figures, what: string, target: string): void {
  const room = limit - usage
  if (creates.length === 0 || room >= creates.length) {
    return
  }
  if (room > 0) {
    out.issues.push({
      code: 'W_LIMIT_HEADROOM',
      message: `the plan creates ${creates.length} ${what} and HubSpot reports room for ${room} more (limit ${limit}, ${usage} in use)`,
      fix: `leave some of them out on this target with skip overrides under targets.${target}.overrides`,
    })
    return
  }
  for (const address of creates) {
    out.blocked[address] = {
      reason: 'limit',
      detail: `HubSpot reports a limit of ${limit} ${what}, with ${usage} in use`,
      fix: `leave it out on this target: add { '${address}': { skip: true } } under targets.${target}.overrides`,
    }
  }
}

// W_LIMIT_UNREADABLE: the plan could not weigh its property creates against HubSpot's limit. It blocks nothing.
function unreadable(issue: IssueCode, creates: Address[]): Issue {
  return {
    code: 'W_LIMIT_UNREADABLE',
    message: `HubSpot's property limit reading answered ${ANSWERED[issue] ?? issue}, so the plan could not check the property limit for ${plural(creates.length, 'create')}`,
    fix: `add a crm.objects.<object>.read scope, such as ${limitScope(creates.map(objectOf))}, to the key`,
  }
}

function readOf(limits: LimitReading[], key: string): Figures | undefined {
  const found = limits.find((l) => l.key === key)
  return found?.status === 'read' ? found : undefined
}

// A HubSpot error is an unreadable reading carrying its issue code. So is an answer without integer limit and usage,
// which HubSpot's undocumented reply to a portal without the feature may be.
async function reading(key: string, get: () => Promise<Figures | undefined>): Promise<LimitReading> {
  try {
    const got = await get()
    return got ? { key, status: 'read', ...got } : { key, status: 'unreadable', issue: 'E_HTTP' }
  } catch (error) {
    if (error instanceof HubSpotApiError) {
      return { key, status: 'unreadable', issue: error.issues[0]?.code ?? 'E_HTTP' }
    }
    throw error
  }
}

function figures(limit: unknown, usage: unknown): Figures | undefined {
  return Number.isInteger(limit) && Number.isInteger(usage)
    ? { limit: limit as number, usage: usage as number }
    : undefined
}
