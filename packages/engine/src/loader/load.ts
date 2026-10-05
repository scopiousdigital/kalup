// The pure loader: config files as text in, the IR out. No disk access, so the app can import core anywhere; the CLI
// owns load(dir), which reads the project and calls loadFiles.
import { parseLock } from '../blueprint/lock.js'
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
  type PipelineExport,
  type PipelineFile,
  type Property,
  type Tombstone,
} from '../grammar/types.js'
import { isAddress } from '../ir/address.js'
import { DEFAULTS } from '../ir/defaults.js'
import type { Address, IR, IRResource, IRTarget, Issue, Lifecycle } from '../ir/types.js'
import { DEFAULT_DIR, dirIssue, inDir, type Layout, layout as layoutOf, normalDir } from './layout.js'
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
  /** Where the object files are: `dir` in kalup.config.ts, hubspot/ by default. */
  layout: Layout
  /**
   * The property addresses whose shared definition states lifecycle.options. Under takeover an unstated one is
   * 'exact' (engine/settings.ts); the IR fills in 'additive' either way. Sorted. Absent: none states it.
   */
  optionsStated?: Address[]
  /** Line of every key in removed.ts, 'property:companies/legacy_score' for example. Empty without the file. */
  removedLines: Record<string, number>
  sources: Record<Address, Source>
}

export interface LoadOptions {
  /**
   * Where the host read the object files from. Absent: the folder `dir` in kalup.config.ts names, else hubspot/. A host
   * that falls back to a 0.1 kalup/ folder passes it here.
   */
  layout?: Layout
  /** The project name when defineConfig has none, such as the nearest package.json's; else the root's basename. */
  name?: string
  /** The project directory. Its basename names the project when defineConfig has no name and `name` is absent. */
  root?: string
  /** The generator version written into the IR. */
  version?: string
}

interface ReadObjectFile {
  data: ObjectFile | PipelineFile
  file: string
  kind: 'object' | 'pipeline'
  lines: Record<string, number>
}

const CONFIG = 'kalup.config.ts'
const TRAILING_SEPARATORS = /[\\/]+$/
const SEPARATOR = /[\\/]/

/**
 * Builds the IR from a map of relative path to text. Reads kalup.config.ts, then in the folder of object files
 * (<dir>/) removed.ts, every <dir>/** /*.ts except index.ts (those under <dir>/pipelines/ as pipeline files), and
 * blueprints.lock.json, whose provenance it merges into the resources the lock lists. Throws an IssueError, with every
 * issue found, when the files cannot yield one IR.
 */
export function loadFiles(files: Record<string, string>, options: LoadOptions = {}): Loaded {
  const issues: Issue[] = []
  const config = readConfig(files[CONFIG], issues)
  const layout = options.layout ?? configLayout(config, issues)
  const removed = readRemoved(layout && files[layout.removed], layout, issues)
  const lock = layout && readLock(files[layout.lock], layout, issues)
  const { resources, sources, optionsStated } = flatten(layout ? readObjectFiles(files, layout, issues) : [], issues)
  if (issues.length > 0 || !config || !layout) {
    throw new IssueError(issues)
  }
  const ir: IR = {
    irVersion: 1,
    project: config.data.name ?? options.name ?? basename(options.root ?? ''),
    generator: { name: 'kalup', version: options.version ?? '0.0.0', frontend: 'ts' },
    resources: sorted(withProvenance(resources, lock)),
    targets: targets(config.data),
    tombstones: sorted(removed.tombstones),
  }
  return {
    ir,
    layout,
    sources,
    config: config.data,
    configLines: config.lines,
    removedLines: removed.lines,
    optionsStated: optionsStated.sort(byCodeUnit),
  }
}

interface ReadConfig {
  data: ConfigFile
  lines: Record<string, number>
}

function readConfig(text: string | undefined, issues: Issue[]): ReadConfig | undefined {
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

// The folder `dir` in kalup.config.ts names, else hubspot/. Undefined, with E_SETTING_VALUE, for a dir outside the
// project; hubspot/ for a config that could not be read, whose issues are already there.
function configLayout(config: ReadConfig | undefined, issues: Issue[]): Layout | undefined {
  if (config === undefined || config.data.dir === undefined) {
    return layoutOf(DEFAULT_DIR)
  }
  const dir = normalDir(config.data.dir)
  if (dir === undefined) {
    issues.push(dirIssue(config.data.dir, config.lines.dir))
    return undefined
  }
  return layoutOf(dir)
}

// No tombstones when the file is absent or cannot be read; the issues say why for the second.
function readRemoved(
  text: string | undefined,
  at: Layout | undefined,
  issues: Issue[],
): { tombstones: Record<string, Tombstone>; lines: Record<string, number> } {
  const none = { tombstones: {}, lines: {} }
  if (text === undefined || at === undefined) {
    return none
  }
  try {
    // Read as a removed file whatever it holds, so a broken one gets this grammar's message and fix.
    const result = read(text, at.removed, 'removed')
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
function readLock(text: string | undefined, at: Layout, issues: Issue[]): BlueprintLock | undefined {
  if (text === undefined) {
    return undefined
  }
  try {
    return parseLock(text, at)
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

function readObjectFiles(files: Record<string, string>, at: Layout, issues: Issue[]): ReadObjectFile[] {
  const out: ReadObjectFile[] = []
  for (const file of Object.keys(files).sort()) {
    if (!inDir(at, file) || file === at.barrel || file === at.removed) {
      continue
    }
    const pipelines = inPipelines(at, file)
    try {
      // A file under pipelines/ is read as a pipeline file whatever it holds, so a wrong one gets that grammar's error.
      const result = read(files[file] ?? '', file, pipelines ? 'pipeline' : undefined)
      if (result.kind === 'object' || result.kind === 'pipeline') {
        if (result.kind === 'pipeline' && !pipelines) {
          const fix = `move it to ${at.dir}/pipelines/`
          issues.push(unsupported(at, file, `a definePipeline file belongs under ${at.dir}/pipelines/`, fix))
          continue
        }
        out.push({ file, kind: result.kind, data: result.data, lines: result.lines })
      } else if (result.kind === 'config') {
        issues.push(unsupported(at, file, `a defineConfig file under ${at.dir}/ is not an object file`))
      } else {
        const fix = `move its entries to ${at.removed}`
        issues.push(unsupported(at, file, `a defineRemoved file belongs at ${at.removed}`, fix))
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

/** Whether a file lies in the pipelines folder, `<dir>/pipelines/`, which holds definePipeline files only. */
export function inPipelines(at: Layout, file: string): boolean {
  return file.startsWith(`${at.dir}/pipelines/`)
}

function unsupported(
  at: Layout,
  file: string,
  message: string,
  fix = `move ${file} out of ${at.dir}/ until a release reads it`,
): Issue {
  return { code: 'E_UNSUPPORTED_FILE', message, file, line: 1, fix }
}

type Add = (address: Address, resource: IRResource, source: Source) => void

function flatten(
  objectFiles: ReadObjectFile[],
  issues: Issue[],
): { optionsStated: Address[]; resources: Record<Address, IRResource>; sources: Record<Address, Source> } {
  const resources: Record<Address, IRResource> = {}
  const sources: Record<Address, Source> = {}
  const optionsStated: Address[] = []
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
  for (const { file, kind, data, lines } of objectFiles) {
    if (kind === 'pipeline') {
      for (const e of (data as PipelineFile).exports) {
        flattenPipeline(e, (configPath) => ({ file, line: lines[configPath] ?? 1, configPath }), add, issues)
      }
      continue
    }
    for (const e of (data as ObjectFile).exports) {
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
      optionsStated.push(...statedOptions(e, (address) => sources[address]?.file === file))
    }
  }
  return { resources, sources, optionsStated: [...new Set(optionsStated)] }
}

/** The address of a pipeline, and of one of its stages. */
export function pipelineAddress(object: string, id: string): Address {
  return `pipeline:${object}/${id}`
}

export function stageAddress(object: string, pipeline: string, stage: string): Address {
  return `stage:${object}/${pipeline}/${stage}`
}

// A pipeline and each of its stages. The pipeline's definition lists its stage IDs in file order: the order unit. An ID
// holding whitespace or a slash forms no address one IR can hold, so it is E_PIPELINE_ID here and left out.
function flattenPipeline(e: PipelineExport, at: (configPath: string) => Source, add: Add, issues: Issue[]): void {
  const unaddressable = (id: string, source: Source) => {
    const held = isAddress(pipelineAddress(e.object, id)) && !id.includes('/') && !e.object.includes('/')
    if (!held) {
      issues.push({
        code: 'E_PIPELINE_ID',
        message: `the ID '${id}' holds whitespace or a slash, so no address can hold it`,
        ...source,
        fix: 'use an ID without whitespace or slashes',
      })
    }
    return !held
  }
  if (unaddressable(e.id, at(`${e.name}.id`))) {
    return
  }
  const address = pipelineAddress(e.object, e.id)
  const definition = { label: e.label, displayOrder: e.displayOrder, stages: e.stages.map((s) => s.id) }
  add(address, { type: 'pipeline', managed: true, definition, binding: { export: e.name } }, at(e.name))
  for (const st of e.stages) {
    const stage = stageAddress(e.object, e.id, st.id)
    if (unaddressable(st.id, at(`${e.name}.stages.${st.key}.id`))) {
      continue
    }
    const fields = compact({
      label: st.label,
      probability: st.probability,
      ticketState: st.ticketState,
      state: st.state,
    })
    const resource: IRResource = { type: 'stage', managed: true, definition: fields, binding: { key: st.key } }
    add(stage, resource, at(`${e.name}.stages.${st.key}`))
  }
}

// The addresses of an export's properties that state lifecycle.options, among those `mine` says this file defines.
function statedOptions(e: ObjectExport, mine: (address: Address) => boolean): Address[] {
  return e.properties
    .filter((p) => p.definition?.lifecycle?.options !== undefined)
    .map((p) => `property:${e.object}/${p.name}`)
    .filter(mine)
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
    strict: p.chain.strict || undefined,
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
 * The group becomes a $ref, `as` leaves the options and `type` comes from the builder, as do `externalOptions` and
 * `referencedObjectType` for p.owner. They go with fieldType, so an options-only reference carries its options alone.
 * lifecycle is not part of the definition.
 */
export function definitionToIR(object: string, kind: BuilderKind, d: Definition): Record<string, unknown> {
  const owner = kind === 'owner' && d.fieldType !== undefined
  return compact({
    label: d.label,
    group: d.group === undefined ? undefined : { $ref: `group:${object}/${d.group}` },
    type: d.fieldType === undefined ? undefined : HUBSPOT_TYPES[kind],
    fieldType: d.fieldType,
    description: d.description,
    options: d.options && hubspotOptions(d.options),
    hasUniqueValue: d.hasUniqueValue,
    formField: d.formField,
    hidden: d.hidden,
    displayOrder: d.displayOrder,
    numberDisplayHint: d.numberDisplayHint,
    showCurrencySymbol: d.showCurrencySymbol,
    currencyPropertyName: d.currencyPropertyName,
    textDisplayHint: d.textDisplayHint,
    calculationFormula: d.calculationFormula,
    dataSensitivity: d.dataSensitivity,
    // p.owner implies both, as a builder implies `type`: HubSpot fills the options with the account's users.
    externalOptions: owner ? true : undefined,
    referencedObjectType: owner ? 'OWNER' : undefined,
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

/**
 * portalId, protected, drift, adopt, allowDestroy, yesLimit and overrides. Credentials stay in the config and never
 * enter the IR, and so does mode, which resolves with the pull scope under objects (engine/settings.ts). A pending
 * target, with no portalId yet, pins no portal and is left out.
 */
function targets(config: ConfigFile): Record<string, IRTarget> {
  const out: Record<string, IRTarget> = {}
  for (const [name, t] of Object.entries(config.targets)) {
    if (t.portalId === undefined) {
      continue
    }
    out[name] = compact({
      portalId: t.portalId,
      protected: t.protected,
      drift: t.drift,
      adopt: t.adopt,
      allowDestroy: t.allowDestroy,
      yesLimit: t.yesLimit,
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
