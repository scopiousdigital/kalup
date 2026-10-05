// Reading association labels: per object pair in scope, the labels list of each direction, and per object its schema
// read for the internal names, which the labels lists never give (live runs, 2026-10-01 and 2026-10-05). The two type
// IDs of a label share one name, so the name pairs them. HubSpot's own labels, and the plain association HubSpot defines
// between standard objects, are left out: Kalup never writes them.
import type { ObjectScope } from '@kalup/core'
import { isAddress, parseAddress } from '../../ir/address.js'
import type { Address, IR, Issue } from '../../ir/types.js'
import { byCodeUnit } from '../../loader/load.js'
import { type HttpClient, HubSpotApiError } from '../http.js'
import { readScope, registry } from '../registry.js'
import { sanitize } from '../sanitize.js'

/** One entry of a direction's labels list. `label` is null for the plain association. */
export interface RawLabel {
  category: string
  label: string | null
  typeId: number
}

/** One association definition as an object's schema read lists it: a type ID, its direction and its internal name. */
export interface RawAssociationDefinition {
  fromObjectTypeId?: string
  id: number | string
  name?: string
}

/** One association of a pair, `a` before `b` in code-unit order: its local name, and its type IDs and labels a to b first. */
export interface LiveAssociation {
  a: string
  b: string
  labels: [string | null, string | null]
  name: string
  typeIds: [number, number]
}

/** One pair the read tried, and whether both its labels lists answered. */
export interface PairRead {
  a: string
  b: string
  /** The read scope the key likely lacks, when a list answered 403. */
  scope?: string
  status: 'read' | 'unreadable'
}

export interface LiveAssociations {
  found: LiveAssociation[]
  pairs: PairRead[]
  /** Type IDs of a pair that no name the read found, and no type ID state records, can address. */
  unnamed: { a: string; b: string; typeIds: number[] }[]
}

/** What readAssociations needs from the rest of the read. */
export interface AssociationRead {
  /** Addresses a skip override leaves out. */
  excluded: Set<string>
  issues: Issue[]
  /** The type IDs state records per address, which name a label the schema read does not list yet. */
  known: Record<Address, readonly number[]>
  /**
   * The object type a path takes for a config key: undefined for a custom object the portal does not have, null for one
   * the read could not see (the schemas list answered 403).
   */
  objectType: (key: string) => string | null | undefined
  /** The pairs to read, from associationPairs. */
  pairs: [string, string][]
  /** Address to the portal name a name override points it at. */
  renames: Map<string, string>
}

/**
 * The object pairs whose labels are in scope, each as two config keys in code-unit order: a pair the files or removed.ts
 * name, or one of an object with `associations: true` and any other object `keys` holds. Both objects must be in
 * `keys`, the objects the read reads. A pair of one object with itself is not read in this release. As with pipelines, a
 * label list nobody asked for is never read: an upgrade must not widen what a project manages without a line saying so.
 */
export function associationPairs(
  objects: Record<string, ObjectScope>,
  ir: Pick<IR, 'resources' | 'tombstones'>,
  keys: string[],
): [string, string][] {
  const read = new Set(keys)
  const pairs = new Map<string, [string, string]>()
  const add = (x: string, y: string) => {
    if (x !== y && read.has(x) && read.has(y)) {
      const [a, b] = x < y ? [x, y] : [y, x]
      pairs.set(`${a}/${b}`, [a, b])
    }
  }
  for (const address of [...Object.keys(ir.resources), ...Object.keys(ir.tombstones)]) {
    if (isAddress(address) && parseAddress(address).type === 'association') {
      const [from = '', to = ''] = parseAddress(address).path.split('/')
      add(from, to)
    }
  }
  for (const key of keys) {
    if (Object.hasOwn(objects, key) && objects[key]?.associations === true) {
      for (const other of keys) {
        add(key, other)
      }
    }
  }
  return [...pairs.values()].sort(([a1, b1], [a2, b2]) => byCodeUnit(a1, a2) || byCodeUnit(b1, b2))
}

/**
 * The associations of every pair in scope, under their local names. A pair one of whose custom objects the portal does
 * not have is read, and empty: the schemas list proved the object absent. A 403 on either labels list makes the pair
 * unreadable; a 403 on a schema read leaves its type IDs unnamed, unless state records them.
 */
export async function readAssociations(http: HttpClient, input: AssociationRead): Promise<LiveAssociations> {
  const out: LiveAssociations = { found: [], pairs: [], unnamed: [] }
  const names = new Map<string, Map<string, string> | undefined>()
  for (const [a, b] of input.pairs) {
    const typeA = input.objectType(a)
    const typeB = input.objectType(b)
    if (typeA === null || typeB === null) {
      out.pairs.push({ a, b, status: 'unreadable', scope: readScope(registry.object) })
      continue
    }
    if (typeA === undefined || typeB === undefined) {
      out.pairs.push({ a, b, status: 'read' })
      continue
    }
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one pair at a time for the rate limits
    const forward = await labels(http, typeA, typeB, input.issues)
    const back = forward === undefined ? undefined : await labels(http, typeB, typeA, input.issues)
    if (forward === undefined || back === undefined) {
      out.pairs.push({ a, b, status: 'unreadable', scope: readScope(registry.association, typeA) })
      continue
    }
    out.pairs.push({ a, b, status: 'read' })
    for (const [key, type] of [
      [a, typeA],
      [b, typeB],
    ] as const) {
      if (!names.has(key)) {
        names.set(key, await schemaNames(http, type, input.issues))
      }
    }
    pair(input, { a, b, forward, back }, names, out)
  }
  return out
}

// One pair's user-defined associations, paired by name, renamed and filtered as the overrides say.
function pair(
  input: AssociationRead,
  { a, b, forward, back }: { a: string; b: string; forward: RawLabel[]; back: RawLabel[] },
  names: Map<string, Map<string, string> | undefined>,
  out: LiveAssociations,
): void {
  const local = localNames(input, a, b)
  const knownName = (typeId: number) => {
    const address = Object.keys(input.known).find((at) => {
      const [from, to] = parseAddress(at).path.split('/')
      return ((from === a && to === b) || (from === b && to === a)) && input.known[at]?.includes(typeId)
    })
    return address === undefined ? undefined : address.slice(address.lastIndexOf('/') + 1)
  }
  // A name the schema read gives is the portal's, renamed to its local name; one only state knows is local already.
  const nameOf = (typeId: number) => {
    const portal = names.get(a)?.get(String(typeId)) ?? names.get(b)?.get(String(typeId))
    return portal === undefined ? knownName(typeId) : local(portal)
  }
  const mine = (list: RawLabel[]) => list.filter((entry) => entry.category === 'USER_DEFINED')
  const backs = mine(back)
  const used = new Set<number>()
  const unnamed: number[] = []
  for (const entry of mine(forward)) {
    const name = nameOf(entry.typeId)
    const other = name === undefined ? undefined : backs.find((x) => !used.has(x.typeId) && nameOf(x.typeId) === name)
    if (name === undefined || other === undefined) {
      unnamed.push(entry.typeId)
      continue
    }
    used.add(other.typeId)
    if (name === SHADOW || excluded(input, a, b, name)) {
      continue
    }
    if (!isAddress(`association:${a}/${b}/${name}`) || name.includes('/')) {
      input.issues.push({
        code: 'W_UNADDRESSABLE_NAME',
        message: `association '${sanitize(name)}' between ${a} and ${b} has a name no address can hold, so it is not captured`,
        fix: 'leave it out of config; HubSpot never changes an association name',
      })
      continue
    }
    out.found.push({ a, b, name, typeIds: [entry.typeId, other.typeId], labels: [entry.label, other.label] })
  }
  unnamed.push(...backs.filter((x) => !used.has(x.typeId)).map((x) => x.typeId))
  if (unnamed.length > 0) {
    out.unnamed.push({ a, b, typeIds: unnamed.sort((x, y) => x - y) })
  }
}

// Marks a portal association a name override shadows: the portal holds a name another address's override claims.
const SHADOW = '\u0000shadowed'

// A portal name of one pair to its local name. An address of the pair, in either direction, whose name override reads a
// portal name takes that name; a portal association under the address's own name is then shadowed and left out.
function localNames(input: AssociationRead, a: string, b: string): (portal: string) => string {
  const toLocal = new Map<string, string>()
  for (const [address, portal] of input.renames) {
    if (!address.startsWith('association:')) {
      continue
    }
    const [from, to, name = ''] = parseAddress(address).path.split('/')
    if ((from === a && to === b) || (from === b && to === a)) {
      toLocal.set(portal, name)
    }
  }
  const moved = new Set([...toLocal.values()])
  return (portal) => toLocal.get(portal) ?? (moved.has(portal) ? SHADOW : portal)
}

function excluded(input: AssociationRead, a: string, b: string, name: string): boolean {
  return input.excluded.has(`association:${a}/${b}/${name}`) || input.excluded.has(`association:${b}/${a}/${name}`)
}

// One direction's labels list, or undefined when it answered 403.
async function labels(
  http: HttpClient,
  fromObjectType: string,
  toObjectType: string,
  issues: Issue[],
): Promise<RawLabel[] | undefined> {
  const listed = await forbidden(
    () =>
      http.request<{ results: RawLabel[] }>({
        type: 'association',
        path: 'list',
        params: { fromObjectType, toObjectType },
      }),
    issues,
  )
  return listed?.results
}

// The internal name of each type ID an object's schema read lists, or undefined when it answered 403.
async function schemaNames(http: HttpClient, objectType: string, issues: Issue[]) {
  const schema = await forbidden(
    () =>
      http.request<{ associations?: RawAssociationDefinition[] }>({
        type: 'association',
        path: 'names',
        params: { objectType },
      }),
    issues,
  )
  if (schema === undefined) {
    return undefined
  }
  const out = new Map<string, string>()
  for (const definition of schema.associations ?? []) {
    if (typeof definition.name === 'string') {
      out.set(String(definition.id), definition.name)
    }
  }
  return out
}

async function forbidden<T>(read: () => Promise<T>, issues: Issue[]): Promise<T | undefined> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof HubSpotApiError && error.status === 403) {
      issues.push(...error.issues)
      return undefined
    }
    throw error
  }
}

