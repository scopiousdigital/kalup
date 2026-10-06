// Reading association labels: per object pair in scope, the labels list of each direction, and per object its schema
// read for the internal names, which the labels lists never give (live runs, 2026-10-01 and 2026-10-05). The two type
// IDs of a label share one name, so the name pairs them. HubSpot's own labels, and the plain association HubSpot defines
// between standard objects, are left out: Kalup never writes them.
import type { ObjectScope } from '@kalup/core'
import type { AssociationEntry } from '../../grammar/types.js'
import { isAddress, pairKey, parseAddress } from '../../ir/address.js'
import type { Address, IR, IRResource, Issue } from '../../ir/types.js'
import { byCodeUnit } from '../../loader/load.js'
import { type HttpClient, HubSpotApiError, unlessForbidden } from '../http.js'
import { readScope, registry, requestScope } from '../registry.js'
import { sanitize } from '../sanitize.js'
import { camelCase } from './keys.js'
import type { Change, Counts, Resolution } from './merge.js'
import { resolveFields } from './pipelines.js'
import { STANDARD_OBJECT_TYPE_IDS } from './scope.js'

/** One entry of a direction's labels list. `label` is null for the plain association. */
export interface RawLabel {
  category: string
  label: string | null
  typeId: number
}

/** One association definition as a schema read lists it: a type ID, its direction and its internal name. */
export interface RawAssociationDefinition {
  fromObjectTypeId?: string
  id: number | string
  name?: string
  toObjectTypeId?: string
}

/**
 * The names schema reads give, by direction and type ID: `<from type ID>><to type ID>#<type ID>`. HubSpot numbers a
 * user-defined type and a type of its own alike, one pair's and another's (live runs, 2026-10-05), so a type ID alone
 * names nothing.
 */
export type SchemaNames = Map<string, string>

/** One association of a pair, `a` before `b` in code-unit order: its local name, and its type IDs and labels a to b first. */
export interface LiveAssociation {
  a: string
  b: string
  labels: [string | null, string | null]
  name: string
  typeIds: [number, number]
}

/** A user-defined type of one direction of a pair that no name reaches: neither a schema read nor state names it. */
export interface UnnamedType {
  from: string
  label: string | null
  to: string
  typeId: number
}

/** One pair the read tried, and whether both its labels lists and the names they need were read. */
export interface PairRead {
  a: string
  b: string
  /** What HubSpot answered when it refused otherwise than with 403. */
  issue?: Issue['code']
  /** The read scope the key likely lacks, when a read answered 403. */
  scope?: string
  status: 'read' | 'unreadable'
}

export interface LiveAssociations {
  found: LiveAssociation[]
  pairs: PairRead[]
  /** The user-defined types no name the read found, and no type ID state records, can address. */
  unnamed: UnnamedType[]
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
 * not have is read, and empty: the schemas list proved the object absent. A 403 on a labels list, or on a schema read
 * the pair needs for its names, makes the pair unreadable; so does any other refusal of a labels list, which HubSpot may
 * answer for a pair it does not support. A pair whose lists hold no user-defined type needs no names, so its schemas are
 * not read: the companies schema is about 400 KB. Each object's schema is read once.
 */
export async function readAssociations(http: HttpClient, input: AssociationRead): Promise<LiveAssociations> {
  const out: LiveAssociations = { found: [], pairs: [], unnamed: [] }
  const names = new Map<string, SchemaNames | undefined>()
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
    const lists = await pairLists(http, typeA, typeB, input.issues)
    if ('refused' in lists) {
      out.pairs.push({ a, b, status: 'unreadable', ...lists.refused })
      continue
    }
    const user = [...lists.forward, ...lists.back].some((entry) => entry.category === 'USER_DEFINED')
    const schemas = user
      ? await objectSchemas(
          http,
          names,
          [
            [a, typeA],
            [b, typeB],
          ],
          input.issues,
        )
      : []
    if (schemas === undefined) {
      out.pairs.push({ a, b, status: 'unreadable', scope: labelScope(typeA, typeB) })
      continue
    }
    out.pairs.push({ a, b, status: 'read' })
    pair(input, { a, b, typeA, typeB, ...lists }, schemas, out)
  }
  return out
}

// The names the schema reads of both objects of a pair give, each object's read once per read; undefined when either
// answered 403.
async function objectSchemas(
  http: HttpClient,
  names: Map<string, SchemaNames | undefined>,
  objects: [key: string, type: string][],
  issues: Issue[],
): Promise<SchemaNames[] | undefined> {
  const out: SchemaNames[] = []
  for (const [key, type] of objects) {
    if (!names.has(key)) {
      // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one schema read per object for the rate limits
      names.set(key, await schemaNames(http, type, issues))
    }
    const read = names.get(key)
    if (read === undefined) {
      return undefined
    }
    out.push(read)
  }
  return out
}

// One pair's user-defined associations, paired by name, renamed and filtered as the overrides say.
function pair(
  input: AssociationRead,
  lists: { a: string; b: string; back: RawLabel[]; forward: RawLabel[]; typeA: string; typeB: string },
  schemas: SchemaNames[],
  out: LiveAssociations,
): void {
  const { a, b } = lists
  // The type IDs state records name what they name, in local terms, before any schema read: an owned entry's.
  const known = new Map<number, string>()
  for (const [address, typeIds] of Object.entries(input.known)) {
    const [from, to, ...rest] = parseAddress(address).path.split('/')
    if ((from === a && to === b) || (from === b && to === a)) {
      for (const typeId of typeIds) {
        known.set(typeId, rest.join('/'))
      }
    }
  }
  const paired = pairNames(lists, { schemas, known, local: localNames(input, a, b) })
  for (const found of paired.found) {
    const { name } = found
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
    out.found.push({ a, b, ...found })
  }
  for (const u of paired.unnamed) {
    const [from, to] = u.forward ? [a, b] : [b, a]
    out.unnamed.push({ from, to, typeId: u.typeId, label: u.label })
  }
}

/**
 * The user-defined associations of one pair from its two labels lists, `forward` from `typeA` to `typeB`: each type is
 * named by `known` (the type IDs state records, or a create answered with), else by the first schema read that names
 * it for its direction, renamed by `local`; a type of the first list is paired with the type of the second that has the
 * same name, as one name holds both types of a label. The types no name pairs are listed apart, in type ID order.
 * HubSpot's own types are left out. Pull and apply both pair a pair's types this way.
 */
export function pairNames(
  lists: { back: RawLabel[]; forward: RawLabel[]; typeA: string; typeB: string },
  naming: { known: ReadonlyMap<number, string>; local?: (portal: string) => string; schemas: readonly SchemaNames[] },
): {
  found: Omit<LiveAssociation, 'a' | 'b'>[]
  unnamed: { forward: boolean; label: string | null; typeId: number }[]
} {
  const [idA, idB] = [typeIdOf(lists.typeA), typeIdOf(lists.typeB)]
  const nameOf = (typeId: number, forward: boolean) => {
    const own = naming.known.get(typeId)
    if (own !== undefined) {
      return own
    }
    const key = forward ? `${idA}>${idB}#${typeId}` : `${idB}>${idA}#${typeId}`
    const portal = naming.schemas.map((s) => s.get(key)).find((name) => name !== undefined)
    return portal === undefined || naming.local === undefined ? portal : naming.local(portal)
  }
  const mine = (list: RawLabel[]) => list.filter((entry) => entry.category === 'USER_DEFINED')
  const backs = mine(lists.back)
  const used = new Set<number>()
  const found: Omit<LiveAssociation, 'a' | 'b'>[] = []
  const unnamed: { forward: boolean; label: string | null; typeId: number }[] = []
  for (const entry of mine(lists.forward)) {
    const name = nameOf(entry.typeId, true)
    const other =
      name === undefined ? undefined : backs.find((x) => !used.has(x.typeId) && nameOf(x.typeId, false) === name)
    if (name === undefined || other === undefined) {
      unnamed.push({ forward: true, typeId: entry.typeId, label: entry.label })
      continue
    }
    used.add(other.typeId)
    found.push({ name, typeIds: [entry.typeId, other.typeId], labels: [entry.label, other.label] })
  }
  for (const x of backs.filter((entry) => !used.has(entry.typeId))) {
    unnamed.push({ forward: false, typeId: x.typeId, label: x.label })
  }
  return { found, unnamed: unnamed.sort((x, y) => x.typeId - y.typeId) }
}

/** The HubSpot type ID of an object as a path names it: a standard object's own, a custom object's as it is. */
export function typeIdOf(objectType: string): string {
  return Object.hasOwn(STANDARD_OBJECT_TYPE_IDS, objectType)
    ? (STANDARD_OBJECT_TYPE_IDS[objectType] as string)
    : objectType
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

/**
 * Both labels lists of a pair, `forward` from `typeA`. A 403 on either refuses the pair with the scope the key likely
 * lacks; another 4xx (HubSpot's answer for a pair it does not support is unobserved) refuses it with HubSpot's issue.
 * Both are reported; anything else propagates.
 */
export async function pairLists(
  http: Pick<HttpClient, 'request'>,
  typeA: string,
  typeB: string,
  issues: Issue[],
): Promise<{ back: RawLabel[]; forward: RawLabel[] } | { refused: Pick<PairRead, 'issue' | 'scope'> }> {
  const list = (fromObjectType: string, toObjectType: string) =>
    http.request<{ results: RawLabel[] }>({
      type: 'association',
      path: 'list',
      params: { fromObjectType, toObjectType },
    })
  try {
    const forward = (await list(typeA, typeB)).results
    const back = (await list(typeB, typeA)).results
    return { forward, back }
  } catch (error) {
    const refused = error instanceof HubSpotApiError && error.status >= 400 && error.status < 500
    if (!refused || error.status === 401 || error.status === 429) {
      throw error
    }
    issues.push(...error.issues)
    return error.status === 403
      ? { refused: { scope: labelScope(typeA, typeB) } }
      : { refused: { issue: error.issues[0]?.code ?? 'E_HTTP' } }
  }
}

/** The read scope a pair's labels need: both objects' schemas, as apply names it (requestScope). */
export function labelScope(typeA: string, typeB: string): string {
  return requestScope('association', { fromObjectType: typeA, toObjectType: typeB }, 'read') ?? ''
}

// The names one object's schema read gives, or undefined when it answered 403.
async function schemaNames(http: HttpClient, objectType: string, issues: Issue[]): Promise<SchemaNames | undefined> {
  const read = () =>
    http.request<{ associations?: RawAssociationDefinition[] }>({
      type: 'association',
      path: 'names',
      params: { objectType },
    })
  const schema = await unlessForbidden(read, issues)
  return schema === undefined ? undefined : namesOf(schema.associations ?? [])
}

/** The names one schema read lists, by direction and type ID (SchemaNames). */
export function namesOf(definitions: RawAssociationDefinition[]): SchemaNames {
  const out: SchemaNames = new Map()
  for (const d of definitions) {
    if (typeof d.name === 'string' && d.fromObjectTypeId !== undefined && d.toObjectTypeId !== undefined) {
      out.set(`${d.fromObjectTypeId}>${d.toObjectTypeId}#${d.id}`, d.name)
    }
  }
  return out
}

/** An association's definition from its two labels: none for a plain one, else each side's, the other's when one lacks it. */
export function associationLabels(first: string | null, second: string | null): Record<string, string> {
  if (first === null && second === null) {
    return {}
  }
  return { label: (first ?? second) as string, inverseLabel: (second ?? first) as string }
}

/**
 * One association the read found, under the address config gives it: the files' direction when they name it, else
 * removed.ts's, else `a` to `b`, the pair's order, so a pull writes a portal-only label the same way every time. A
 * tombstone never decides the direction of an association the files hold. Its labels and type IDs are that direction's,
 * and `from` is the object it is addressed from.
 */
export function liveAssociation(
  ir: Pick<IR, 'resources' | 'tombstones'>,
  found: LiveAssociation,
): { address: Address; from: string; resource: IRResource; typeIds: [number, number] } {
  const { a, b, name } = found
  const [ab, ba] = [`association:${a}/${b}/${name}`, `association:${b}/${a}/${name}`]
  const inFiles = (address: Address) => Object.hasOwn(ir.resources, address)
  const removed = (address: Address) => Object.hasOwn(ir.tombstones, address)
  const reversed = inFiles(ba) || (!inFiles(ab) && removed(ba) && !removed(ab))
  const [first, second] = reversed ? [found.labels[1], found.labels[0]] : found.labels
  return {
    address: reversed ? `association:${b}/${a}/${name}` : `association:${a}/${b}/${name}`,
    from: reversed ? b : a,
    resource: { type: 'association', managed: true, definition: associationLabels(first, second) },
    typeIds: reversed ? [found.typeIds[1], found.typeIds[0]] : found.typeIds,
  }
}

export interface AssociationMergeInput {
  /** Whether pull adds the portal's associations of a pair the file lacks: either object sets `associations: true`. */
  adds: (a: string, b: string) => boolean
  /** The addresses a skip override leaves out on the target: kept as written and noted. */
  excluded: ReadonlySet<string>
  /** The associations the read found. */
  found: LiveAssociation[]
  /** The project's IR, whose resources and tombstones give each association its direction (liveAssociation). */
  ir: Pick<IR, 'resources' | 'tombstones'>
  /** The file's entries, as the target sees them (associationAsTarget). */
  local: AssociationEntry[]
  /** The addresses pull may merge: the --only filter. */
  only: (address: string) => boolean
  /** The pairs whose labels lists were read, from the read. An entry on another pair stays as written. */
  pairs: PairRead[]
  /** The addresses in removed.ts: never written back, reported as `removed`. */
  removed?: ReadonlySet<string>
  /** The base's verdict on an address state owns, or undefined to merge it as the portal holds it. */
  resolve?: (address: string) => Resolution | undefined
}

export interface AssociationsMerged {
  /** The merged entries: the file's, then the portal's the file lacks. */
  entries: AssociationEntry[]
  /** The report of each object, by the object each address is from. */
  reports: Map<string, { changes: Change[]; counts: Counts }>
}

/**
 * The re-pull merge of `<dir>/associations.ts`: the portal wins for the labels, the file keeps its keys and comments.
 * Where state owns an association with a base, the base decides each label as it does for properties. An entry HubSpot
 * no longer holds stays, reported missing. Associations on an object removed.ts names are never written back. Pure.
 */
export function mergeAssociations(input: AssociationMergeInput): AssociationsMerged {
  const out: AssociationsMerged = { entries: [], reports: new Map() }
  const live: Record<Address, IRResource> = Object.fromEntries(
    input.found.map((found) => liveAssociation(input.ir, found)).map((l) => [l.address, l.resource]),
  )
  const report = (address: Address) => {
    const [from = ''] = parseAddress(address).path.split('/')
    const found = out.reports.get(from) ?? { changes: [], counts: { added: 0, changed: 0, unchanged: 0, missing: 0 } }
    out.reports.set(from, found)
    return found
  }
  const read = new Set(input.pairs.filter((p) => p.status === 'read').map((p) => `${p.a}/${p.b}`))
  const gone = (address: Address) =>
    pairKey(address)
      .split('/')
      .some((key) => input.removed?.has(`object:${key}`) === true)
  const ours = new Set<Address>()
  for (const e of input.local) {
    const address = `association:${e.from}/${e.to}/${e.name}`
    ours.add(address)
    out.entries.push(
      read.has(pairKey(address)) && input.only(address) && !gone(address)
        ? mergeEntry(input, live, e, report(address))
        : e,
    )
  }
  const taken = new Set(input.local.map((e) => e.key))
  for (const [address, resource] of Object.entries(live).sort(([a], [b]) => byCodeUnit(a, b))) {
    const [from = '', to = '', name = ''] = parseAddress(address).path.split('/')
    if (ours.has(address) || !input.adds(from, to) || !input.only(address) || gone(address)) {
      continue
    }
    if (input.removed?.has(address)) {
      report(address).changes.push({ kind: 'removed', address: sanitize(address) })
      continue
    }
    const key = uniqueKey(camelCase(name.replace(NOT_WORD, '_')), taken)
    taken.add(key)
    out.entries.push({ key, from, to, name, comments: [], ...resource.definition })
    const r = report(address)
    r.counts.added += 1
    r.changes.push({ kind: 'added', address: sanitize(address) })
  }
  return out
}

const NOT_WORD = /[^A-Za-z0-9_]+/g
const DIGIT_FIRST = /^[0-9]/

// One entry the file holds on a pair the read holds: its labels from the portal, unless the base keeps the file's.
function mergeEntry(
  input: AssociationMergeInput,
  live: Record<Address, IRResource>,
  e: AssociationEntry,
  report: { changes: Change[]; counts: Counts },
): AssociationEntry {
  const address = `association:${e.from}/${e.to}/${e.name}`
  if (input.excluded.has(address)) {
    report.changes.push({ kind: 'excluded', address: sanitize(address) })
    return e
  }
  if (!Object.hasOwn(live, address)) {
    report.counts.missing += 1
    report.changes.push({ kind: 'missing', address: sanitize(address) })
    return e
  }
  const held = live[address]?.definition ?? {}
  const mine: Record<string, unknown> = { label: e.label, inverseLabel: e.inverseLabel }
  const merged: Record<string, unknown> = { label: held.label, inverseLabel: held.inverseLabel }
  const fields: Change[] = []
  for (const field of ['label', 'inverseLabel']) {
    if (mine[field] !== merged[field]) {
      fields.push({ kind: 'changed', address, field, before: mine[field], after: merged[field] })
    }
  }
  resolveFields(address, mine, merged, fields, input.resolve?.(address))
  if (fields.some((c) => c.kind === 'changed')) {
    report.counts.changed += 1
  } else {
    report.counts.unchanged += 1
  }
  report.changes.push(...fields.map(scrubbed))
  const { label: _label, inverseLabel: _inverse, ...rest } = e
  const written = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined))
  return { ...rest, ...(written as Pick<AssociationEntry, 'label' | 'inverseLabel'>) }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  const name = base === '' || DIGIT_FIRST.test(base) ? `association${base}` : base
  let out = name
  for (let n = 2; taken.has(out); n += 1) {
    out = `${name}${n}`
  }
  return out
}

// Portal strings are untrusted, so every string in a change line is sanitized before it reaches any output.
function scrubbed(change: Change): Change {
  const clean = (value: unknown) => (typeof value === 'string' ? sanitize(value) : value)
  const out: Change = { ...change, address: sanitize(change.address) }
  if (change.before !== undefined) {
    out.before = clean(change.before)
  }
  if (change.after !== undefined) {
    out.after = clean(change.after)
  }
  return out
}
