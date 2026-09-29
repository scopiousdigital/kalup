// Plan's reads before it decides: the Limits Tracking readings, and the room they leave for the creates it plans. A
// reading HubSpot refuses is unreadable, never fatal, and blocks nothing: only a limit read as reached blocks. An
// unreadable property limit with property creates planned warns, since HubSpot answered 403 to a key without a
// crm.objects scope (observed on a developer test account, 2026-09-29). Limits Tracking reports limit and usage, nothing about the subscription.
import { type Address, byCodeUnit, type Issue, type LimitReading, parseAddress } from '@kalup/core'
import { type HttpClient, HubSpotApiError } from '../lib/http.js'
import { limitScope, registry } from '../lib/registry.js'
import { objectOf } from './units.js'

export interface LimitRequest {
  /** The type ID of each object read, standard or custom, by config key. A custom-properties reading keeps theirs. */
  objectTypeIds: Record<string, string>
  /** Read custom-object-types. Plan asks when it creates a custom object, which no plan does yet. */
  objectTypes: boolean
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

interface PropertiesBody {
  byObjectType?: ({ limit?: unknown; objectTypeId?: unknown; usage?: unknown } | null)[]
  overallLimit?: unknown
  overallUsage?: unknown
}

/** The Limits Tracking readings plan asked for, sorted by key. A network failure propagates as in every command. */
export async function preflight(http: HttpClient, request: LimitRequest): Promise<{ limits: LimitReading[] }> {
  const limits: LimitReading[] = []
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
  return { limits }
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
function unreadable(issue: string, creates: Address[]): Issue {
  const n = creates.length
  return {
    code: 'W_LIMIT_UNREADABLE',
    message: `HubSpot's property limit reading answered ${ANSWERED[issue] ?? issue}, so the plan could not check the property limit for ${n} create${n === 1 ? '' : 's'}`,
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
