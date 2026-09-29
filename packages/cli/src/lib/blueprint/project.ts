// Where blueprint resources land in a project: the export that holds the resource or its object today, or a new
// kalup/objects/<object>.ts for a standard object. Everything goes through the canonical writer, kalup.config.ts gains
// the objects the blueprint needs, and the barrel is written again. Pure: files in, files out.
import {
  type Address,
  type BarrelEntry,
  type Blueprint,
  type IRResource,
  type Loaded,
  type ObjectExport,
  type ObjectFile,
  read,
  write,
} from '@kalup/core'
import { bin } from '../../brand.js'
import { nameOf, objectOf } from '../../engine/units.js'
import type { Issue } from '../output.js'
import { exportName } from '../pull/keys.js'
import { toGroup, toProperty } from '../pull/render.js'
import { STANDARD_OBJECTS } from '../pull/scope.js'
import { sanitize } from '../sanitize.js'

const BARREL = 'kalup/index.ts'
const CONFIG = 'kalup.config.ts'
/** A cap on third-party text quoted in an issue. */
const QUOTED_MAX = 500

export interface Placed {
  /** Every project file as the command would leave it. */
  files: Record<string, string>
  /** The object keys added to `objects` in kalup.config.ts, sorted. */
  objects: string[]
}

/** The object keys a fragment uses: its resources' and the ones `requires` names, sorted. */
export function objectsOf(blueprint: Blueprint): string[] {
  const keys = [
    ...Object.keys(blueprint.resources).map(objectOf),
    ...(blueprint.requires ?? []).map((ref) => ref.$ref.slice('object:'.length)),
  ]
  return [...new Set(keys)].sort()
}

/**
 * E_BLUEPRINT_REQUIRES for each custom object the fragment uses that config does not define: Kalup does not create
 * custom object schemas, so its resources would have nowhere to go. A standard object is always there.
 */
export function requiresIssues(loaded: Loaded, keys: string[]): Issue[] {
  return keys
    .filter((key) => !(STANDARD_OBJECTS.has(key) || Object.hasOwn(loaded.ir.resources, `object:${key}`)))
    .map((key) => ({
      code: 'E_BLUEPRINT_REQUIRES',
      message: `the blueprint needs the custom object ${key}, which config does not define. Nothing was written.`,
      fix: `add ${key}: {} under objects in kalup.config.ts and run ${bin} pull to write its object file, or create the object in HubSpot first`,
    }))
}

/**
 * E_BLUEPRINT_REF for each group a property of the fragment names that is neither in the fragment nor a group in
 * config. validateBlueprint keeps the group's name plain; the text is sanitized all the same, as it quotes the fragment.
 */
export function refIssues(loaded: Loaded, blueprint: Blueprint): Issue[] {
  const issues: Issue[] = []
  for (const [address, resource] of Object.entries(blueprint.resources)) {
    const group = (resource.definition.group as { $ref?: string } | undefined)?.$ref
    if (resource.type !== 'property' || group === undefined || Object.hasOwn(blueprint.resources, group)) {
      continue
    }
    if (!(Object.hasOwn(loaded.ir.resources, group) && loaded.ir.resources[group]?.type === 'group')) {
      issues.push({
        code: 'E_BLUEPRINT_REF',
        message: sanitize(
          `${address} is in group ${group}, which is neither in the blueprint nor in config. Nothing was written.`,
          QUOTED_MAX,
        ),
        fix: sanitize(
          `add ${nameOf(group)}: { label: '...' } to the groups of ${objectOf(group)} in config, then run the command again`,
          QUOTED_MAX,
        ),
      })
    }
  }
  return issues
}

/**
 * The project's files with each resource written into place: over the entry config holds at its address, or into the
 * export that holds its object, or a new file for a standard object. `objects` are added to kalup.config.ts where
 * missing. The caller checked that every custom object is defined.
 */
export function place(
  files: Record<string, string>,
  loaded: Loaded,
  resources: [Address, IRResource][],
  objects: string[],
): Placed {
  const parsed = objectFiles(files)
  const touched = new Set<string>()
  for (const [address, resource] of resources) {
    const [file, index] = where(parsed, loaded, address)
    const data = parsed.get(file) as ObjectFile
    const exports = data.exports.map((e, i) => (i === index ? withResource(e, address, resource) : e))
    parsed.set(file, { ...data, exports })
    touched.add(file)
  }
  const next = { ...files }
  for (const file of touched) {
    next[file] = write('object', parsed.get(file) as ObjectFile)
  }
  const added = objects.filter((key) => !Object.hasOwn(loaded.config.objects, key))
  if (added.length > 0) {
    const scopes = { ...loaded.config.objects, ...Object.fromEntries(added.map((key) => [key, {}])) }
    next[CONFIG] = write('config', { ...loaded.config, objects: scopes })
  }
  // From the parsed files, as fmt's barrel reads them from text: a candidate the loader will refuse (a key used twice)
  // still gets its barrel, and the candidate check reports the issue.
  const entries: BarrelEntry[] = [...parsed.keys()].sort().flatMap((file) =>
    (parsed.get(file) as ObjectFile).exports.map((e) => ({
      name: e.name,
      from: `./${file.slice('kalup/'.length, -'.ts'.length)}`,
    })),
  )
  if (entries.length > 0) {
    next[BARREL] = write('barrel', entries)
  }
  return { files: next, objects: added }
}

// The export a resource goes into: the one config defines it in, else the first that holds its object, else a new one.
function where(parsed: Map<string, ObjectFile>, loaded: Loaded, address: Address): [file: string, index: number] {
  const source = Object.hasOwn(loaded.sources, address) ? loaded.sources[address] : undefined
  if (source) {
    const [owner] = source.configPath.split('.')
    const index = parsed.get(source.file)?.exports.findIndex((e) => e.name === owner) ?? -1
    if (index >= 0) {
      return [source.file, index]
    }
  }
  const object = objectOf(address)
  for (const [file, data] of parsed) {
    const index = data.exports.findIndex((e) => e.object === object)
    if (index >= 0) {
      return [file, index]
    }
  }
  const file = `kalup/objects/${object}.ts`
  const fresh: ObjectExport = {
    name:
      (Object.hasOwn(loaded.config.objects, object) ? loaded.config.objects[object]?.as : undefined) ??
      exportName(object),
    builder: 'defineObject',
    object,
    comments: [],
    groups: [],
    properties: [],
  }
  const data = parsed.get(file) ?? { imports: [], exports: [] }
  parsed.set(file, { ...data, exports: [...data.exports, fresh] })
  return [file, data.exports.length]
}

// The export with the resource in place of the entry of the same name, or added; the entry's comments stay.
function withResource(e: ObjectExport, address: Address, resource: IRResource): ObjectExport {
  const name = nameOf(address)
  if (resource.type === 'group') {
    const previous = e.groups.find((g) => g.name === name)
    const group = toGroup(address, resource, previous)
    return { ...e, groups: previous ? e.groups.map((g) => (g === previous ? group : g)) : [...e.groups, group] }
  }
  const previous = e.properties.find((p) => p.name === name)
  const property = toProperty(address, resource, previous)
  const properties = previous ? e.properties.map((p) => (p === previous ? property : p)) : [...e.properties, property]
  return { ...e, properties }
}

// Every object file of the project, parsed, in path order. The loader accepted them, so read() cannot throw here.
function objectFiles(files: Record<string, string>): Map<string, ObjectFile> {
  const out = new Map<string, ObjectFile>()
  for (const file of Object.keys(files).sort()) {
    if (!(file.startsWith('kalup/') && file.endsWith('.ts')) || file === BARREL) {
      continue
    }
    const result = read(files[file] as string, file)
    if (result.kind === 'object') {
      out.set(file, result.data)
    }
  }
  return out
}
