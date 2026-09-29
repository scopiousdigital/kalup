// The pure loader: config files as text in, the IR out. No disk access, so the app can import core anywhere; the CLI
// owns load(dir), which reads the project and calls loadFiles.
import { LOCK_FILE, parseLock } from '../blueprint/lock.js'
import type { BlueprintLock } from '../blueprint/types.js'
import { read } from '../grammar/read.js'
import {
  type BuilderKind,
  type ConfigFile,
  type Definition,
  IssueError,
  type ObjectExport,
  type ObjectFile,
  type Option,
  type Property,
  type Tombstone,
} from '../grammar/types.js'
import { DEFAULTS } from '../ir/defaults.js'
import type { Address, IR, IRResource, IRTarget, Issue, Lifecycle } from '../ir/types.js'
import { HUBSPOT_TYPES } from './tables.js'

/** Where a resource was defined, for error messages. */
export interface Source {
  /** 'Company.properties.billingStatus' in an object file. */
  configPath: string
  file: string
  line: number
}

export interface Loaded {
  /** kalup.config.ts as parsed, credentials and pull scope included. Never part of the IR. */
  config: ConfigFile
  /** Line of every config path in kalup.config.ts, 'targets.production.portalId' for example. */
  configLines: Record<string, number>
  ir: IR
  /** Line of every key in kalup/removed.ts, 'property:companies/legacy_score' for example. Empty without the file. */
  removedLines: Record<string, number>
  sources: Record<Address, Source>
}

export interface LoadOptions {
  /** The project directory. Its basename names the project when defineConfig has no name. */
  root?: string
  /** The generator version written into the IR. */
  version?: string
}

interface ReadObjectFile {
  data: ObjectFile
  file: string
  lines: Record<string, number>
}

const CONFIG = 'kalup.config.ts'
const REMOVED = 'kalup/removed.ts'
const TRAILING_SEPARATORS = /[\\/]+$/
const SEPARATOR = /[\\/]/

/**
 * Builds the IR from a map of relative path to text. Reads kalup.config.ts, kalup/removed.ts, every kalup/** /*.ts
 * except index.ts, and kalup/blueprints.lock.json, whose provenance it merges into the resources the lock lists. Throws
 * an IssueError, with every issue found, when the files cannot yield one IR.
 */
export function loadFiles(files: Record<string, string>, options: LoadOptions = {}): Loaded {
  const issues: Issue[] = []
  const config = readConfig(files[CONFIG], issues)
  const removed = readRemoved(files[REMOVED], issues)
  const lock = readLock(files[LOCK_FILE], issues)
  const { resources, sources } = flatten(readObjectFiles(files, issues), issues)
  if (issues.length > 0 || !config) {
    throw new IssueError(issues)
  }
  const ir: IR = {
    irVersion: 1,
    project: config.data.name ?? basename(options.root ?? ''),
    generator: { name: 'kalup', version: options.version ?? '0.0.0', frontend: 'ts' },
    resources: sorted(withProvenance(resources, lock)),
    targets: targets(config.data),
    tombstones: sorted(removed.tombstones),
  }
  return { ir, sources, config: config.data, configLines: config.lines, removedLines: removed.lines }
}

function readConfig(
  text: string | undefined,
  issues: Issue[],
): { data: ConfigFile; lines: Record<string, number> } | undefined {
  if (text === undefined) {
    issues.push({
      code: 'E_NO_CONFIG',
      message: 'no kalup.config.ts in the project',
      fix: 'run npx kalup init --portal <id>',
    })
    return undefined
  }
  try {
    const result = read(text, CONFIG)
    if (result.kind === 'config') {
      return { data: result.data, lines: result.lines }
    }
    issues.push({
      code: 'E_NOT_DATA',
      message: `${CONFIG} is not a defineConfig file`,
      file: CONFIG,
      line: 1,
      fix: 'write export default defineConfig({...})',
    })
  } catch (error) {
    if (!(error instanceof IssueError)) {
      throw error
    }
    issues.push(...error.issues)
  }
  return undefined
}

// No tombstones when the file is absent or cannot be read; the issues say why for the second.
function readRemoved(
  text: string | undefined,
  issues: Issue[],
): { tombstones: Record<string, Tombstone>; lines: Record<string, number> } {
  const none = { tombstones: {}, lines: {} }
  if (text === undefined) {
    return none
  }
  try {
    // Read as a removed file whatever it holds, so a broken one gets this grammar's message and fix.
    const result = read(text, REMOVED, 'removed')
    if (result.kind === 'removed') {
      return { tombstones: result.data.tombstones, lines: result.lines }
    }
  } catch (error) {
    if (!(error instanceof IssueError)) {
      throw error
    }
    issues.push(...error.issues)
  }
  return none
}

// No lock when the file is absent or invalid; the issues say why for the second.
function readLock(text: string | undefined, issues: Issue[]): BlueprintLock | undefined {
  if (text === undefined) {
    return undefined
  }
  try {
    return parseLock(text)
  } catch (error) {
    if (!(error instanceof IssueError)) {
      throw error
    }
    issues.push(...error.issues)
    return undefined
  }
}

/**
 * Each resource a lock entry lists gets that blueprint's provenance. An address the lock lists that config no longer
 * has is one the client removed, and nothing to merge.
 */
function withProvenance(
  resources: Record<Address, IRResource>,
  lock: BlueprintLock | undefined,
): Record<Address, IRResource> {
  const out = { ...resources }
  for (const [blueprint, entry] of Object.entries(lock?.blueprints ?? {})) {
    for (const [address, sourceAddress] of Object.entries(entry.resources)) {
      const resource = Object.hasOwn(out, address) ? out[address] : undefined
      if (resource) {
        const { version, prefix, hash } = entry
        out[address] = { ...resource, provenance: { blueprint, version, sourceAddress, prefix, hash } }
      }
    }
  }
  return out
}

function readObjectFiles(files: Record<string, string>, issues: Issue[]): ReadObjectFile[] {
  const out: ReadObjectFile[] = []
  for (const file of Object.keys(files).sort()) {
    if (!(file.startsWith('kalup/') && file.endsWith('.ts')) || file === 'kalup/index.ts' || file === REMOVED) {
      continue
    }
    const later = notReadYet(file)
    if (later) {
      issues.push(unsupported(file, `this version does not read ${later} yet`))
      continue
    }
    try {
      const result = read(files[file] ?? '', file)
      if (result.kind === 'object') {
        out.push({ file, data: result.data, lines: result.lines })
      } else if (result.kind === 'config') {
        issues.push(unsupported(file, 'a defineConfig file under kalup/ is not an object file'))
      } else {
        issues.push(unsupported(file, `a defineRemoved file belongs at ${REMOVED}`, `move its entries to ${REMOVED}`))
      }
    } catch (error) {
      if (!(error instanceof IssueError)) {
        throw error
      }
      issues.push(...error.issues)
    }
  }
  return out
}

/** What a file under kalup/ holds that this version does not read yet. */
function notReadYet(file: string): string | undefined {
  return file.startsWith('kalup/pipelines/') ? 'pipelines' : undefined
}

function unsupported(
  file: string,
  message: string,
  fix = `move ${file} out of kalup/ until a release reads it`,
): Issue {
  return { code: 'E_UNSUPPORTED_FILE', message, file, line: 1, fix }
}

type Add = (address: Address, resource: IRResource, source: Source) => void

function flatten(
  objectFiles: ReadObjectFile[],
  issues: Issue[],
): { resources: Record<Address, IRResource>; sources: Record<Address, Source> } {
  const resources: Record<Address, IRResource> = {}
  const sources: Record<Address, Source> = {}
  const add: Add = (address, resource, source) => {
    const first = sources[address]
    if (first) {
      issues.push({
        code: 'E_DUPLICATE_ADDRESS',
        message: `${address} is defined twice: ${first.file}:${first.line} and ${source.file}:${source.line}`,
        ...source,
        fix: 'remove or rename one of the two definitions',
      })
      return
    }
    resources[address] = resource
    sources[address] = source
  }
  for (const { file, data, lines } of objectFiles) {
    for (const e of data.exports) {
      const at = (configPath: string): Source => ({ file, line: lines[configPath] ?? 1, configPath })
      if (e.builder === 'defineCustomObject') {
        const resource = objectResource(e, at(e.name), issues)
        if (resource) {
          add(`object:${e.object}`, resource, at(e.name))
        }
      }
      for (const group of e.groups) {
        const resource: IRResource = { type: 'group', managed: true, definition: { label: group.label } }
        add(`group:${e.object}/${group.name}`, resource, at(`${e.name}.groups.${group.name}`))
      }
      flattenProperties(e, at, add, issues)
    }
  }
  return { resources, sources }
}

function flattenProperties(e: ObjectExport, at: (configPath: string) => Source, add: Add, issues: Issue[]): void {
  const keys = new Map<string, string>()
  for (const property of e.properties) {
    const source = at(`${e.name}.properties.${property.key}`)
    const firstKey = keys.get(property.name)
    if (firstKey !== undefined) {
      issues.push({
        code: 'E_DUPLICATE_KEY',
        message: `internal name '${property.name}' is used by two keys of ${e.name}: '${firstKey}' and '${property.key}'`,
        ...source,
        fix: 'remove or rename one of the two entries',
      })
      continue
    }
    keys.set(property.name, property.key)
    const resource = propertyResource(e.object, property, source, issues)
    if (resource) {
      add(`property:${e.object}/${property.name}`, resource, source)
    }
  }
}

// The codecs type requires labels and primaryDisplayProperty, so a file without them would not compile in the app.
// The reader does not require them; the issue mirrors the one it raises for a missing field.
const OBJECT_FIELDS = {
  labels: "add labels: { singular: '...', plural: '...' }",
  primaryDisplayProperty: "add primaryDisplayProperty: '<internal name>'",
} as const

function objectResource(e: ObjectExport, source: Source, issues: Issue[]): IRResource | undefined {
  let missing = false
  for (const [field, fix] of Object.entries(OBJECT_FIELDS) as [keyof typeof OBJECT_FIELDS, string][]) {
    if (e[field] !== undefined) {
      continue
    }
    issues.push({ code: 'E_NOT_DATA', message: `missing field '${field}'`, ...source, fix })
    missing = true
  }
  if (missing) {
    return undefined
  }
  return {
    type: 'object',
    managed: true,
    definition: compact({
      labels: e.labels,
      primaryDisplayProperty: e.primaryDisplayProperty,
      requiredProperties: e.requiredProperties,
      searchableProperties: e.searchableProperties,
      secondaryDisplayProperties: e.secondaryDisplayProperties,
    }),
    binding: { export: e.name },
  }
}

// A property is one of three things: a full definition (label, group and fieldType), an options-only enum reference,
// or a bare reference. Anything else cannot be created or typed and is E_REFERENCE_DEFINITION.
function propertyResource(object: string, p: Property, source: Source, issues: Issue[]): IRResource | undefined {
  const bad = (message: string, fix: string): undefined => {
    issues.push({ code: 'E_REFERENCE_DEFINITION', message, ...source, fix })
    return undefined
  }
  const d = p.definition
  const binding = compact({
    key: p.key,
    codec: p.kind,
    aliases: aliases(d?.options),
    required: p.chain.required || undefined,
    readonly: p.chain.readonly || undefined,
  })
  const full = d !== undefined && d.label !== undefined && d.group !== undefined && d.fieldType !== undefined
  if (full) {
    return {
      type: 'property',
      managed: p.chain.managed,
      definition: definitionToIR(object, p.kind, d),
      binding,
      lifecycle: lifecycle(d),
    }
  }
  if (!p.chain.managed) {
    return bad(
      '.managed(false) on a reference: a property without label, group and fieldType is never managed',
      'drop .managed(false), or add label, group and fieldType',
    )
  }
  if (d === undefined) {
    return { type: 'property', managed: false, binding }
  }
  if (Object.keys(d).join() !== 'options') {
    return bad('a definition needs label, group and fieldType', 'add the missing fields, or drop the definition')
  }
  if (p.kind !== 'enum' && p.kind !== 'multiEnum') {
    return bad(
      `options without label, group and fieldType are only allowed on p.enum and p.multiEnum, not p.${p.kind}`,
      'add label, group and fieldType, or drop the options',
    )
  }
  return { type: 'property', managed: false, definition: definitionToIR(object, p.kind, d), binding }
}

/**
 * A grammar Definition in HubSpot terms, as the IR holds it: only the fields it states, explicit defaults included.
 * The group becomes a $ref, `as` leaves the options and `type` comes from the builder. `type` goes with fieldType, so
 * an options-only reference carries its options alone. lifecycle is not part of the definition.
 */
export function definitionToIR(object: string, kind: BuilderKind, d: Definition): Record<string, unknown> {
  return compact({
    label: d.label,
    group: d.group === undefined ? undefined : { $ref: `group:${object}/${d.group}` },
    type: d.fieldType === undefined ? undefined : HUBSPOT_TYPES[kind],
    fieldType: d.fieldType,
    description: d.description,
    options: d.options && hubspotOptions(d.options),
    hasUniqueValue: d.hasUniqueValue,
    formField: d.formField,
  })
}

function lifecycle(d: Definition): Lifecycle {
  return { ...DEFAULTS.lifecycle, ...compact(d.lifecycle ?? {}) }
}

/** Options as HubSpot sees them: `as` moves to binding.aliases. */
function hubspotOptions(list: Option[]): Record<string, unknown>[] {
  return list.map((o) => compact({ value: o.value, label: o.label, hidden: o.hidden, description: o.description }))
}

// fromEntries defines own keys; assignment would drop a value such as '__proto__'.
function aliases(list: Option[] | undefined): Record<string, string> | undefined {
  const entries = (list ?? []).flatMap((o) => (o.as === undefined ? [] : [[o.value, o.as] as const]))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** portalId, protected, drift, allowDestroy and overrides. Credentials stay in the config and never enter the IR. */
function targets(config: ConfigFile): Record<string, IRTarget> {
  const out: Record<string, IRTarget> = {}
  for (const [name, t] of Object.entries(config.targets)) {
    out[name] = compact({
      portalId: t.portalId as number,
      protected: t.protected,
      drift: t.drift,
      allowDestroy: t.allowDestroy,
      overrides: t.overrides && sorted(t.overrides as IRTarget['overrides'] & object),
    })
  }
  return sorted(out)
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => byCodeUnit(a, b)))
}

/** Sorts by UTF-16 code unit, as Array.prototype.sort does by default, never by locale. */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

function basename(root: string): string {
  return root.replace(TRAILING_SEPARATORS, '').split(SEPARATOR).pop() ?? ''
}
