// Reading a target: the custom object schemas when the config names one, then properties and groups per object in
// scope, all through read-tagged paths. A 403 on one object is a reported gap, not a failure. Per-target `name`
// overrides are applied here, so the merge only ever sees addresses.
import type { ConfigFile, Issue, Override, Target } from '@kalup/core'
import { type HttpClient, HubSpotApiError } from '../http.js'
import { exitCodes, KalupError } from '../output.js'
import { sanitize } from '../sanitize.js'
import {
  type LiveObject,
  normalizeGroups,
  normalizeProperties,
  normalizeSchema,
  type RawGroup,
  type RawProperty,
  type RawSchema,
} from './normalize.js'
import { STANDARD_OBJECTS, scopeOf } from './scope.js'

export interface Portal {
  /** In config order. An object the key cannot read is left out and its E_SCOPE issue is in `issues`. */
  objects: LiveObject[]
  /** The portal's custom objects that no config key names. Empty unless the schemas were read. */
  otherObjects: string[]
}

export interface ReadOptions {
  /** Line of every config path in kalup.config.ts, for the errors that point at `objects.<key>`. */
  configLines: Record<string, number>
  /** Read the schemas even when no config key names a custom object (--discover). */
  schemas?: boolean
}

const CONFIG = 'kalup.config.ts'

export async function readPortal(
  http: HttpClient,
  config: ConfigFile,
  target: Target,
  issues: Issue[],
  options: ReadOptions,
): Promise<Portal> {
  const keys = Object.keys(config.objects)
  const renames = renameMap(target.overrides ?? {})
  const portalName = (key: string) => renames.get(`object:${key}`) ?? key
  const customKeys = keys.filter((key) => !STANDARD_OBJECTS.has(key))
  const at = (path: string) => ({ file: CONFIG, line: options.configLines[path], configPath: path })

  let schemas: RawSchema[] | undefined
  if (customKeys.length > 0 || options.schemas) {
    const listed = await gap(
      () =>
        http.request<{ results: RawSchema[] }>({
          type: 'object',
          path: 'list',
          query: {
            includePropertyDefinitions: 'false',
            includeAssociationDefinitions: 'false',
            includeAuditMetadata: 'false',
          },
        }),
      issues,
    )
    schemas = listed?.results.filter((s) => !s.archived)
  }
  if (schemas) {
    checkCustomKeys(customKeys, schemas, portalName, at)
  }

  const objects: LiveObject[] = []
  const unknownIncludes: Issue[] = []
  for (const key of keys) {
    const schema = schemas?.find((s) => s.name === portalName(key))
    if (!(STANDARD_OBJECTS.has(key) || schema)) {
      continue // the schemas gap is already reported
    }
    // biome-ignore lint/performance/noAwaitInLoops: objects are read from HubSpot one at a time on purpose, to stay inside the rate limits and keep issues in config order
    const lists = await readLists(http, schema ? schema.objectTypeId : key, issues)
    if (!lists) {
      continue
    }
    const { properties, groups } = lists
    const groupNames = localNames(renames, `group:${key}/`, groups, key)
    const propertyNames = localNames(renames, `property:${key}/`, properties, key)
    const raw = properties.map((p) => ({
      ...p,
      name: propertyNames.get(p.name) ?? p.name,
      groupName: groupNames.get(p.groupName) ?? p.groupName,
    }))
    const missing = [...scopeOf(config.objects[key]).include].filter((name) => !raw.some((p) => p.name === name))
    if (missing.length > 0) {
      unknownIncludes.push({
        code: 'E_UNKNOWN_INCLUDE',
        message: `objects.${key}.include names properties the portal does not have: ${missing.map((name) => sanitize(name)).join(', ')}`,
        ...at(`objects.${key}.include`),
        fix: 'remove them, or check the internal names in HubSpot',
      })
    }
    objects.push({
      object: key,
      groups: normalizeGroups(groups.map((g) => ({ ...g, name: groupNames.get(g.name) ?? g.name }))),
      properties: normalizeProperties(key, raw, issues),
      custom: schema && normalizeSchema(localSchema(schema, propertyNames)),
    })
  }
  if (unknownIncludes.length > 0) {
    throw new KalupError(unknownIncludes, exitCodes.invalid)
  }
  const named = new Set(keys.map(portalName))
  return { objects, otherObjects: (schemas ?? []).map((s) => s.name).filter((name) => !named.has(name)) }
}

// Every config key that is not a standard object must name a custom object in the portal.
function checkCustomKeys(
  customKeys: string[],
  schemas: RawSchema[],
  portalName: (key: string) => string,
  at: (path: string) => Pick<Issue, 'file' | 'line' | 'configPath'>,
): void {
  const names = schemas.map((s) => s.name)
  const unknown = customKeys.filter((key) => !names.includes(portalName(key)))
  if (unknown.length === 0) {
    return
  }
  const listed = names.length > 0 ? names.map((name) => sanitize(name)).join(', ') : 'none'
  throw new KalupError(
    unknown.map((key) => ({
      code: 'E_UNKNOWN_OBJECT',
      message: `'${key}' is not a standard object or a custom object in the portal (custom objects: ${listed})`,
      ...at(`objects.${key}`),
      fix: 'use one of the names listed, or remove the key',
    })),
    exitCodes.invalid,
  )
}

// The properties, then the groups, of one object. Undefined when either read is a gap.
async function readLists(
  http: HttpClient,
  objectType: string,
  issues: Issue[],
): Promise<{ properties: RawProperty[]; groups: RawGroup[] } | undefined> {
  const properties = await gap(
    () => http.request<{ results: RawProperty[] }>({ type: 'property', path: 'list', params: { objectType } }),
    issues,
  )
  if (!properties) {
    return undefined
  }
  const groups = await gap(
    () => http.request<{ results: RawGroup[] }>({ type: 'group', path: 'list', params: { objectType } }),
    issues,
  )
  if (!groups) {
    return undefined
  }
  return { properties: properties.results, groups: groups.results }
}

// A 403 becomes a reported gap for that read; anything else propagates.
async function gap<T>(read: () => Promise<T>, issues: Issue[]): Promise<T | undefined> {
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

/** Address to the name it carries in this target, for every override with a `name`. */
function renameMap(overrides: Record<string, Override>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [address, override] of Object.entries(overrides)) {
    if (override.name !== undefined) {
      out.set(address, override.name)
    }
  }
  return out
}

// The schema names properties by their portal name; the file names them by address.
function localSchema(schema: RawSchema, names: Map<string, string>): RawSchema {
  const local = (name: string) => names.get(name) ?? name
  return {
    ...schema,
    primaryDisplayProperty: schema.primaryDisplayProperty && local(schema.primaryDisplayProperty),
    requiredProperties: schema.requiredProperties?.map(local),
    searchableProperties: schema.searchableProperties?.map(local),
    secondaryDisplayProperties: schema.secondaryDisplayProperties?.map(local),
  }
}

// Portal name to local name for the resources of one object under `prefix`. A portal that holds both names is an
// error, because the override would then hide a real resource.
function localNames(
  renames: Map<string, string>,
  prefix: string,
  items: { name: string }[],
  object: string,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [address, portalName] of renames) {
    if (!address.startsWith(prefix)) {
      continue
    }
    const localName = address.slice(prefix.length)
    if (items.some((i) => i.name === portalName) && items.some((i) => i.name === localName)) {
      throw new KalupError({
        code: 'E_OVERRIDE_AMBIGUOUS',
        message: `the portal holds both '${sanitize(portalName)}' and '${sanitize(localName)}' on ${object}, so the name override for ${address} is ambiguous`,
        fix: 'remove the override, or rename one of the two in HubSpot',
      })
    }
    out.set(portalName, localName)
  }
  return out
}
