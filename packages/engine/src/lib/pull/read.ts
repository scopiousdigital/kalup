// Reading a target, the one read every command shares: the custom object schemas when the config names one, then per
// object in scope its properties (one list per data sensitivity) and its groups, all through read-tagged paths. A 403
// on one list is a gap: reported, recorded and skipped, not a failure. Per-target `skip` and `name` overrides are
// applied here, so callers only ever see addresses. What config names and the portal lacks is reported, not thrown:
// each command decides what it means.
import type { Override, Target } from '@kalup/core'
import type { IR, Issue } from '../../ir/types.js'
import { byCodeUnit, type Loaded } from '../../loader/load.js'
import { hasPipelines } from '../../loader/tables.js'
import { exitCodes, KalupError } from '../errors.js'
import { type HttpClient, HubSpotApiError } from '../http.js'
import { readScope, registry } from '../registry.js'
import { sanitize } from '../sanitize.js'
import {
  groupMembers,
  type ListedProperty,
  type LiveObject,
  type LivePipeline,
  normalizeGroups,
  normalizePipelines,
  normalizeProperties,
  normalizeSchema,
  propertyMeta,
  type RawGroup,
  type RawPipeline,
  type RawProperty,
  type RawSchema,
  type Sensitivity,
  SHADOWED,
} from './normalize.js'
import { definedOn, inScope, pipelinesInScope, STANDARD_OBJECTS, scopeOf } from './scope.js'

/** A list the key could not read (403). The observation is complete only when there is none. */
export interface Gap {
  /**
   * The schemas list hides every custom object; a properties or groups list hides its object; a pipelines list hides
   * that object's pipelines and stages alone.
   */
  list: 'schemas' | 'properties' | 'groups' | 'pipelines'
  /** The config key of the object left out. Absent for the schemas list. */
  object?: string
  /** The read scope the key likely lacks. */
  scope: string
}

export interface Portal {
  /** Config keys whose defineCustomObject names a custom object the schemas list lacks, in config order. */
  absent: string[]
  /** Every custom object in the portal, in schema order. Undefined when the schemas list was not read. */
  customObjects?: string[]
  /**
   * The addresses a skip override leaves out, sorted: `object:<k>` (never read), `group:<k>/<g>` with every config
   * property in that group, and each skipped property. None of them is in `objects`.
   */
  excluded: string[]
  /** The lists the key could not read, in the order they were tried. */
  gaps: Gap[]
  /** In config order. An object the key cannot read is left out, with its gap and its E_SCOPE issue. */
  objects: LiveObject[]
  /** The portal's custom objects that no config key names. Empty unless the schemas were read. */
  otherObjects: string[]
  /**
   * Renamed addresses whose own name the portal holds while it lacks the override name, sorted. That portal resource
   * belongs to no address, and the renamed address is absent.
   */
  shadowed: string[]
  /** Per object read, in config order, the `include` names the portal lacks. */
  unknownIncludes: { object: string; names: string[] }[]
}

export interface ReadOptions {
  /** Read the pipelines of every object, in scope or not (--discover). */
  pipelines?: boolean
  /** Read the schemas even when no config key names a custom object (--discover). */
  schemas?: boolean
}

/** A portal name to its local name under one address prefix, and the portal names no address may take. */
interface Names {
  /** A shadowed name, which no address holds, becomes `shadowed:<name>`. */
  local: (name: string) => string
  /** The shadowed names as addresses. */
  shadowed: string[]
  shadows: (name: string) => boolean
}

const CONFIG = 'kalup.config.ts'
/** The schemas list's query: the schema fields alone, without its properties, associations or audit data. */
export const SCHEMA_LIST: Readonly<Record<string, string>> = {
  includePropertyDefinitions: 'false',
  includeAssociationDefinitions: 'false',
  includeAuditMetadata: 'false',
}
/** HubSpot lists only non-sensitive properties unless asked, and takes one sensitivity per request. */
const SENSITIVITIES: Record<string, string>[] = [
  {},
  { dataSensitivity: 'sensitive' },
  { dataSensitivity: 'highly_sensitive' },
]

export async function readPortal(
  http: HttpClient,
  loaded: Pick<Loaded, 'config' | 'configLines' | 'ir'>,
  target: Target,
  issues: Issue[],
  options: ReadOptions = {},
): Promise<Portal> {
  const { config, ir } = loaded
  const overrides = target.overrides ?? {}
  const excluded = excludedAddresses(ir, overrides)
  const renames = renameMap(overrides)
  const portalName = (key: string) => renames.get(`object:${key}`) ?? key
  const keys = Object.keys(config.objects)
  const read = keys.filter((key) => !excluded.has(`object:${key}`))
  const customKeys = read.filter((key) => !STANDARD_OBJECTS.has(key))
  const gaps: Gap[] = []
  const shadowed: string[] = []

  let schemas: RawSchema[] | undefined
  if (customKeys.length > 0 || options.schemas) {
    const listed = await gap(
      () => http.request<{ results: RawSchema[] }>({ type: 'object', path: 'list', query: SCHEMA_LIST }),
      issues,
      gaps,
      { list: 'schemas', scope: readScope(registry.object) },
    )
    schemas = listed?.results.filter((s) => !s.archived)
  }
  const customObjects = schemas?.map((s) => s.name)
  const absent: string[] = []
  if (customObjects) {
    // A key config does not define as a custom object can only name one the portal has.
    const unknown = customKeys.filter(
      (key) => !(Object.hasOwn(ir.resources, `object:${key}`) || customObjects.includes(key)),
    )
    if (unknown.length > 0) {
      throw unknownObjects(unknown, customObjects, loaded.configLines)
    }
    shadowed.push(...localNames(renames, 'object:', customObjects, '').shadowed)
    absent.push(...customKeys.filter((key) => !customObjects.includes(portalName(key))))
  }

  const objects: LiveObject[] = []
  const unknownIncludes: Portal['unknownIncludes'] = []
  for (const key of read) {
    const schema = schemas?.find((s) => s.name === portalName(key))
    if (!(STANDARD_OBJECTS.has(key) || schema)) {
      continue // behind the schemas gap, or absent
    }
    // biome-ignore lint/performance/noAwaitInLoops: objects are read from HubSpot one at a time on purpose, to stay inside the rate limits and keep issues in config order
    const lists = await readLists(http, key, schema ? schema.objectTypeId : key, issues, gaps)
    if (!lists) {
      continue
    }
    // An archived group is no resource, so it neither makes a name override ambiguous nor is shadowed.
    const live = lists.groups.filter((g) => !g.archived)
    const groupNames = localNames(renames, `group:${key}/`, names(live), ` on ${key}`)
    const propertyNames = localNames(renames, `property:${key}/`, names(lists.properties), ` on ${key}`)
    shadowed.push(...groupNames.shadowed, ...propertyNames.shadowed)
    const raw = localize(lists.properties, propertyNames).map((p) => ({
      ...p,
      groupName: groupNames.local(p.groupName),
    }))
    // An include name the files define is no error: pull reports it missing in the portal, and plan creates it.
    const scope = scopeOf(config.objects[key], definedOn(ir, key))
    const missing = [...scope.include].filter(
      (name) =>
        !(raw.some((p) => p.name === name) || scope.defined.has(name) || excluded.has(`property:${key}/${name}`)),
    )
    if (missing.length > 0) {
      unknownIncludes.push({ object: key, names: missing })
    }
    const kept = (type: string) => (item: { name: string }) => !excluded.has(`${type}:${key}/${item.name}`)
    const properties = raw.filter(kept('property'))
    // W_UNSUPPORTED_TYPE only for a property in the pull scope, the files' own included: the rest is not its concern.
    const wanted = (p: RawProperty) => inScope(scope, { name: p.name, hubspotDefined: Boolean(p.hubspotDefined) })
    const pipelines = await objectPipelines(
      http,
      { key, schema, loaded, options },
      { renames, excluded, shadowed },
      {
        issues,
        gaps,
      },
    )
    objects.push({
      object: key,
      objectTypeId: schema?.objectTypeId,
      ...(pipelines ? { pipelines } : {}),
      ...normalizeGroups(localize(lists.groups, groupNames).filter(kept('group'))),
      ...normalizeProperties(key, properties, issues, wanted),
      meta: propertyMeta(properties),
      members: groupMembers(lists.properties),
      custom: schema && normalizeSchema(localSchema(schema, propertyNames.local)),
    })
  }
  const named = new Set(keys.map(portalName))
  return {
    absent,
    customObjects,
    excluded: [...excluded].sort(byCodeUnit),
    gaps,
    objects,
    otherObjects: (customObjects ?? []).filter((name) => !named.has(name)),
    shadowed: shadowed.sort(byCodeUnit),
    unknownIncludes,
  }
}

// The pipelines of one object as `local` makes them, or undefined when the list is a gap.
// The object's pipelines, as the files name them, when discover or the pull scope reads them; undefined otherwise.
async function objectPipelines(
  http: HttpClient,
  {
    key,
    schema,
    loaded,
    options,
  }: { key: string; schema: RawSchema | undefined; loaded: Pick<Loaded, 'config' | 'ir'>; options: ReadOptions },
  { renames, excluded, shadowed }: { renames: Map<string, string>; excluded: Set<string>; shadowed: string[] },
  { issues, gaps }: { issues: Issue[]; gaps: Gap[] },
): Promise<LivePipeline[] | undefined> {
  const custom = schema !== undefined
  const discovering = options.pipelines === true && hasPipelines(key, custom)
  if (!(discovering || pipelinesInScope(loaded.config.objects[key], loaded.ir, key))) {
    return
  }
  return await readPipelines(http, key, schema ? schema.objectTypeId : key, issues, gaps, (listed) =>
    localPipelines(key, normalizePipelines(key, listed, custom), renames, excluded, shadowed),
  )
}

async function readPipelines(
  http: HttpClient,
  object: string,
  objectType: string,
  issues: Issue[],
  gaps: Gap[],
  local: (raw: RawPipeline[]) => LivePipeline[],
): Promise<LivePipeline[] | undefined> {
  const listed = await gap(
    () => http.request<{ results: RawPipeline[] }>({ type: 'pipeline', path: 'list', params: { objectType } }),
    issues,
    gaps,
    { list: 'pipelines', object, scope: readScope(registry.pipeline, objectType) },
  )
  return listed && local(listed.results)
}

// The pipelines under their local IDs, and each one's stages under theirs, as the name overrides make them: a
// shadowed pipeline or stage is left out and recorded in `shadowed`, a skipped one is left out.
function localPipelines(
  object: string,
  live: LivePipeline[],
  renames: Map<string, string>,
  excluded: Set<string>,
  shadowed: string[],
): LivePipeline[] {
  const where = ` on ${object}`
  const pipelines = localNames(
    renames,
    `pipeline:${object}/`,
    live.map((p) => p.id),
    where,
  )
  shadowed.push(...pipelines.shadowed)
  const out: LivePipeline[] = []
  for (const p of live) {
    const id = pipelines.local(p.id)
    if (pipelines.shadows(p.id) || excluded.has(`pipeline:${object}/${id}`)) {
      continue
    }
    const prefix = `stage:${object}/${id}/`
    const stages = localNames(
      renames,
      prefix,
      p.stages.map((st) => st.id),
      where,
    )
    shadowed.push(...stages.shadowed)
    const kept = p.stages.filter((st) => !(stages.shadows(st.id) || excluded.has(`${prefix}${stages.local(st.id)}`)))
    out.push({ ...p, id, stages: kept.map((st) => ({ ...st, id: stages.local(st.id) })) })
  }
  return out
}

/** One archived property: its portal name, its group, and when HubSpot archived it when the list says. */
export interface ArchivedProperty {
  archivedAt?: string
  groupName: string
  name: string
}

/**
 * The names of one object's archived properties, sorted, from one list with archived=true per data sensitivity, as for
 * the live properties. `objectType` is a standard object's name or a custom object's type ID. Any error propagates.
 */
export async function archivedPropertyNames(http: HttpClient, objectType: string): Promise<string[]> {
  return (await archivedProperties(http, objectType)).map((p) => p.name)
}

/**
 * One object's archived properties, sorted by name, from the three archived lists merged by name (the first list
 * wins). Portal names: no override applies. Any error propagates.
 */
export async function archivedProperties(http: HttpClient, objectType: string): Promise<ArchivedProperty[]> {
  const found = new Map<string, ArchivedProperty>()
  for (const sensitivity of SENSITIVITIES) {
    // biome-ignore lint/performance/noAwaitInLoops: the lists are read from HubSpot one at a time on purpose, to stay inside the rate limits
    const listed = await http.request<{ results: RawProperty[] }>({
      type: 'property',
      path: 'list',
      params: { objectType },
      query: { archived: 'true', ...sensitivity },
    })
    for (const p of listed.results) {
      if (!found.has(p.name)) {
        const archivedAt = typeof p.archivedAt === 'string' ? p.archivedAt : undefined
        found.set(p.name, { name: p.name, groupName: p.groupName, ...(archivedAt === undefined ? {} : { archivedAt }) })
      }
    }
  }
  return [...found.values()].sort((a, b) => byCodeUnit(a.name, b.name))
}

/**
 * The names of the custom object schemas HubSpot holds archived, sorted: a create of one of those names purges the
 * archived schema, its labels and its records in the recycle bin with it (observed 2026-10-05). The list with
 * archived=true answers active schemas too, marked archived: false, so the flag decides. Any error propagates.
 */
export async function archivedSchemaNames(http: HttpClient): Promise<string[]> {
  const listed = await http.request<{ results: RawSchema[] }>({
    type: 'object',
    path: 'list',
    query: { archived: 'true', ...SCHEMA_LIST },
  })
  return listed.results
    .filter((s) => s.archived === true)
    .map((s) => s.name)
    .sort(byCodeUnit)
}

/** E_UNKNOWN_OBJECT, exit 3: config keys that name neither a standard object nor a custom object in the portal. */
export function unknownObjects(
  keys: string[],
  customObjects: string[],
  configLines: Record<string, number>,
): KalupError {
  const listed = customObjects.length > 0 ? customObjects.map((name) => sanitize(name)).join(', ') : 'none'
  return new KalupError(
    keys.map((key) => ({
      code: 'E_UNKNOWN_OBJECT',
      message: `'${key}' is not a standard object or a custom object in the portal (custom objects: ${listed})`,
      file: CONFIG,
      line: configLines[`objects.${key}`],
      configPath: `objects.${key}`,
      fix: 'use one of the names listed, or remove the key',
    })),
    exitCodes.invalid,
  )
}

// The properties of one object, one list per data sensitivity merged by name (the first list wins), each with the list
// that returned it, then its groups. Undefined when any of the four reads is a gap: absence is proven only when all of
// them succeeded.
async function readLists(
  http: HttpClient,
  object: string,
  objectType: string,
  issues: Issue[],
  gaps: Gap[],
): Promise<{ properties: ListedProperty[]; groups: RawGroup[] } | undefined> {
  const properties: ListedProperty[] = []
  const seen = new Set<string>()
  for (const query of SENSITIVITIES) {
    const sensitivity = (query.dataSensitivity as Sensitivity | undefined) ?? 'non_sensitive'
    // biome-ignore lint/performance/noAwaitInLoops: the lists are read from HubSpot one at a time on purpose, to stay inside the rate limits
    const listed = await gap(
      () => http.request<{ results: RawProperty[] }>({ type: 'property', path: 'list', params: { objectType }, query }),
      issues,
      gaps,
      { list: 'properties', object, scope: readScope(registry.property, objectType) },
    )
    if (!listed) {
      return undefined
    }
    for (const p of listed.results) {
      if (!seen.has(p.name)) {
        seen.add(p.name)
        properties.push({ ...p, sensitivity })
      }
    }
  }
  const groups = await gap(
    () => http.request<{ results: RawGroup[] }>({ type: 'group', path: 'list', params: { objectType } }),
    issues,
    gaps,
    { list: 'groups', object, scope: readScope(registry.group, objectType) },
  )
  if (!groups) {
    return undefined
  }
  return { properties, groups: groups.results }
}

// A 403 becomes a gap for that read: its issues are reported and `missed` is recorded. Anything else propagates.
async function gap<T>(read: () => Promise<T>, issues: Issue[], gaps: Gap[], missed: Gap): Promise<T | undefined> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof HubSpotApiError && error.status === 403) {
      issues.push(...error.issues)
      gaps.push(missed)
      return undefined
    }
    throw error
  }
}

// Every address a skip override leaves out: the skipped addresses, each config property in a skipped group, and each
// config stage of a skipped pipeline. A property's group is the one it has on this target: its definition override's,
// else the shared one.
function excludedAddresses(ir: IR, overrides: Record<string, Override>): Set<string> {
  const out = new Set(Object.keys(overrides).filter((address) => overrides[address]?.skip === true))
  for (const address of Object.keys(ir.resources)) {
    const pipeline = address.startsWith('stage:') ? `pipeline:${address.slice(6, address.lastIndexOf('/'))}` : undefined
    if (pipeline !== undefined && out.has(pipeline)) {
      out.add(address)
    }
  }
  for (const [address, resource] of Object.entries(ir.resources)) {
    const override = Object.hasOwn(overrides, address) ? overrides[address] : undefined
    const moved = resource.managed ? override?.definition?.group : undefined
    const group =
      moved === undefined
        ? (resource.definition?.group as { $ref?: string } | undefined)?.$ref
        : `group:${address.slice(address.indexOf(':') + 1, address.indexOf('/'))}/${moved}`
    if (resource.type === 'property' && group !== undefined && out.has(group)) {
      out.add(address)
    }
  }
  return out
}

/** Address to the name it carries in this target, for every override with a `name`. A skip wins over a name. */
function renameMap(overrides: Record<string, Override>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [address, override] of Object.entries(overrides)) {
    if (override.name !== undefined && override.skip !== true) {
      out.set(address, override.name)
    }
  }
  return out
}

/** A schema as the file names it: the properties it names under their local names, not their portal names. */
export function localSchema(schema: RawSchema, local: (name: string) => string): RawSchema {
  return {
    ...schema,
    primaryDisplayProperty: schema.primaryDisplayProperty && local(schema.primaryDisplayProperty),
    requiredProperties: schema.requiredProperties?.map(local),
    searchableProperties: schema.searchableProperties?.map(local),
    secondaryDisplayProperties: schema.secondaryDisplayProperties?.map(local),
  }
}

// The name overrides under `prefix`, over the portal's names there. An override moves its address to the portal name
// N, so a portal resource under the address's own name belongs to no address (shadowed) unless another override
// points at it. A portal that holds both names is an error when that resource is left to no address, because the
// override would then hide it. A swap or a chain gives it to another address, and an override to its own name hides
// nothing. Two overrides that read one name are an error too: validate rejects them, and no read lets the last win.
function localNames(renames: Map<string, string>, prefix: string, portal: string[], where: string): Names {
  const held = new Set(portal)
  const under = [...renames].filter(([address]) => address.startsWith(prefix))
  const claimed = new Set(under.map(([, portalName]) => portalName))
  const toLocal = new Map<string, string>()
  const moved: string[] = []
  for (const [address, portalName] of under) {
    const localName = address.slice(prefix.length)
    const first = toLocal.get(portalName)
    if (first !== undefined) {
      throw new KalupError(
        {
          code: 'E_OVERRIDE_NAME',
          message: `the name overrides for ${prefix}${first} and ${address} both read '${sanitize(portalName)}'${where}`,
          fix: 'give each of the two its own portal name, or remove one of the two overrides',
        },
        exitCodes.invalid,
      )
    }
    if (portalName !== localName && held.has(portalName) && held.has(localName) && !claimed.has(localName)) {
      throw new KalupError({
        code: 'E_OVERRIDE_AMBIGUOUS',
        message: `the portal holds both '${sanitize(portalName)}' and '${sanitize(localName)}'${where}, so the name override for ${address} is ambiguous`,
        fix: 'remove the override, or rename one of the two in HubSpot',
      })
    }
    toLocal.set(portalName, localName)
    moved.push(localName)
  }
  const shadowed = new Set(moved.filter((name) => held.has(name) && !toLocal.has(name)))
  return {
    local: (name) => toLocal.get(name) ?? (shadowed.has(name) ? `${SHADOWED}${name}` : name),
    shadows: (name) => shadowed.has(name),
    shadowed: [...shadowed].map((name) => `${prefix}${name}`),
  }
}

// The items under their local names, a shadowed one left out.
function localize<T extends { name: string }>(items: T[], local: Names): T[] {
  return items.filter((item) => !local.shadows(item.name)).map((item) => ({ ...item, name: local.local(item.name) }))
}

function names(items: { name: string }[]): string[] {
  return items.map((item) => item.name)
}
