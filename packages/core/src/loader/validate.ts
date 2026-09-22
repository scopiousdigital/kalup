// Offline validation of a loaded project: the E_* table from the spec and the warnings. The loader itself raises
// E_DUPLICATE_ADDRESS, E_DUPLICATE_KEY, E_REFERENCE_DEFINITION and E_NOT_DATA for a custom object without labels,
// because one IR cannot hold those; everything here is a rule a well-formed IR can still break. The ir/1 schema check
// belongs to `kalup ir --check`, not here: on a loader-derived IR it only repeats these rules without a file or line.
import type { Address, IRResource, Issue } from '../ir/types.js'
import type { Loaded } from './load.js'
import { FIELD_TYPES, HUBSPOT_TYPES } from './tables.js'

export interface ValidateOptions {
  /** The target a command was asked to run against. Unknown is E_UNKNOWN_TARGET. */
  target?: string
}

export interface Validation {
  /** Exit 3 when non-empty. */
  issues: Issue[]
  warnings: Issue[]
}

const CONFIG = 'kalup.config.ts'

/** The definition fields a property can own, the names `lifecycle.ignoreChanges` may use. */
const DEFINITION_FIELDS = ['label', 'group', 'fieldType', 'description', 'options', 'hasUniqueValue', 'formField']

export function validate(loaded: Loaded, options: ValidateOptions = {}): Validation {
  const issues: Issue[] = []
  const warnings: Issue[] = []
  const { ir, sources } = loaded
  const keys = new Map<string, string>()

  for (const [address, resource] of Object.entries(ir.resources)) {
    if (resource.type !== 'property') {
      continue
    }
    checkProperty(loaded, address, resource, keys, { issues, warnings })
  }

  for (const [address, resource] of Object.entries(ir.resources)) {
    walkUnresolved(resource.definition, (marker) => {
      warnings.push({
        code: 'W_UNRESOLVED',
        message: `${address} carries ${marker.kind} ID ${marker.id} from target ${marker.from}, which no address maps to`,
        ...(sources[address] ?? {}),
        fix: `run kalup bind ${address} ${marker.id} --target <target> to map it, or replace it with a $ref`,
      })
    })
  }

  checkTargets(loaded, options.target, issues)
  return { issues, warnings }
}

/** `keys` collects `<object>/<key>` across calls, for E_KEY_COLLISION. */
function checkProperty(
  loaded: Loaded,
  address: Address,
  resource: IRResource,
  keys: Map<string, string>,
  { issues, warnings }: Validation,
): void {
  const { ir, sources, config } = loaded
  const source = sources[address] ?? { file: '', line: 0, configPath: address }
  const at = (suffix = ''): Pick<Issue, 'file' | 'line' | 'configPath'> => ({
    file: source.file,
    line: source.line,
    configPath: source.configPath + suffix,
  })
  const path = address.slice('property:'.length)
  const object = path.slice(0, path.indexOf('/'))
  const name = path.slice(path.indexOf('/') + 1)
  const d = resource.definition ?? {}
  const codec = resource.binding?.codec
  const key = resource.binding?.key

  if (key !== undefined) {
    const first = keys.get(`${object}/${key}`)
    if (first === undefined) {
      keys.set(`${object}/${key}`, address)
    } else {
      issues.push({
        code: 'E_KEY_COLLISION',
        message: `key '${key}' is used by two properties of ${object}: ${first} and ${address}`,
        ...at(),
        fix: 'rename one of the two keys',
      })
    }
  }
  if (codec && typeof d.fieldType === 'string' && !FIELD_TYPES[codec].includes(d.fieldType)) {
    issues.push({
      code: 'E_TYPE_FIELDTYPE',
      message: `fieldType '${d.fieldType}' is not allowed for p.${codec} (type ${HUBSPOT_TYPES[codec]})`,
      ...at('.fieldType'),
      fix: `use one of ${FIELD_TYPES[codec].map((f) => `'${f}'`).join(', ')}`,
    })
  }
  const group = (d.group as { $ref?: string } | undefined)?.$ref
  if (group !== undefined && !ir.resources[group]) {
    const groupName = group.slice(group.lastIndexOf('/') + 1)
    issues.push({
      code: 'E_UNKNOWN_GROUP',
      message: `group '${groupName}' is not in the groups of ${object}`,
      ...at('.group'),
      fix: `add ${groupName}: { label: '...' } to the groups block`,
    })
  }
  checkLifecycle(resource, d, at, issues)
  if (resource.managed && name.startsWith('hs_')) {
    issues.push({
      code: 'E_HS_PREFIX',
      message: `'${name}' starts with hs_, the prefix HubSpot uses for its own properties`,
      ...at(),
      fix: 'rename the property, or drop label, group and fieldType to reference it',
    })
  }
  if (resource.managed && config.prefix && !name.startsWith(config.prefix)) {
    warnings.push({
      code: 'W_PREFIX',
      message: `'${name}' does not carry the project prefix '${config.prefix}'`,
      ...at(),
      fix: `rename it to ${config.prefix}${name}, or clear prefix in ${CONFIG}`,
    })
  }
  if (codec === 'json' && typeof d.fieldType === 'string' && d.fieldType !== 'textarea') {
    warnings.push({
      code: 'W_JSON_FIELDTYPE',
      message: `p.json '${name}' has fieldType '${d.fieldType}'; JSON text belongs in a textarea`,
      ...at('.fieldType'),
      fix: "set fieldType: 'textarea'",
    })
  }
}

/** Target names, portal IDs and override addresses in kalup.config.ts, and the target a command asked for. */
function checkTargets(loaded: Loaded, requested: string | undefined, issues: Issue[]): void {
  const { ir, config, configLines } = loaded
  const configAt = (configPath: string): Pick<Issue, 'file' | 'line' | 'configPath'> => ({
    file: CONFIG,
    ...(configLines[configPath] === undefined ? {} : { line: configLines[configPath] }),
    configPath,
  })
  for (const [name, target] of Object.entries(config.targets)) {
    const path = `targets.${name}`
    if (name === 'config') {
      issues.push({
        code: 'E_TARGET_NAME',
        message: "a target may not be named 'config': compare uses that word for the config side",
        ...configAt(path),
        fix: 'rename the target',
      })
    }
    if (target.portalId === undefined) {
      issues.push({
        code: 'E_PORTAL_ID',
        message: `target '${name}' has no portalId`,
        ...configAt(path),
        fix: 'add portalId: <the portal ID, a positive integer>',
      })
    } else if (!Number.isInteger(target.portalId) || target.portalId < 1) {
      issues.push({
        code: 'E_PORTAL_ID',
        message: `portalId ${target.portalId} is not a positive integer`,
        ...configAt(`${path}.portalId`),
        fix: 'set portalId to the portal ID shown in HubSpot, a positive integer',
      })
    }
    for (const address of Object.keys(target.overrides ?? {})) {
      if (ir.resources[address]) {
        continue
      }
      issues.push({
        code: 'E_UNKNOWN_OVERRIDE',
        message: `override '${address}' is not an address in config`,
        ...configAt(`${path}.overrides.${address}`),
        fix: 'use an address that kalup ir lists, or remove the override',
      })
    }
  }
  if (requested !== undefined && !(requested in config.targets)) {
    const declared = Object.keys(config.targets)
    issues.push({
      code: 'E_UNKNOWN_TARGET',
      message: `target '${requested}' is not declared`,
      ...configAt('targets'),
      fix:
        declared.length > 0
          ? `use one of ${declared.join(', ')}, or declare targets.${requested}`
          : `declare targets.${requested}`,
    })
  }
}

function checkLifecycle(
  resource: IRResource,
  d: Record<string, unknown>,
  at: (suffix: string) => Pick<Issue, 'file' | 'line' | 'configPath'>,
  issues: Issue[],
): void {
  const { lifecycle } = resource
  if (!lifecycle) {
    return
  }
  const values = new Set(((d.options as { value: string }[] | undefined) ?? []).map((o) => o.value))
  for (const value of lifecycle.removedOptions ?? []) {
    if (!values.has(value)) {
      continue
    }
    issues.push({
      code: 'E_LIFECYCLE',
      message: `removedOptions names '${value}', which is still in options`,
      ...at('.lifecycle.removedOptions'),
      fix: 'remove it from options or from removedOptions',
    })
  }
  for (const field of lifecycle.ignoreChanges ?? []) {
    if (DEFINITION_FIELDS.includes(field)) {
      continue
    }
    issues.push({
      code: 'E_LIFECYCLE',
      message: `ignoreChanges names '${field}', which is not a definition field`,
      ...at('.lifecycle.ignoreChanges'),
      fix: `use one of ${DEFINITION_FIELDS.join(', ')}`,
    })
  }
}

interface Unresolved {
  from: string
  id: string
  kind: string
}

function walkUnresolved(value: unknown, visit: (marker: Unresolved) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkUnresolved(item, visit)
    }
    return
  }
  if (value === null || typeof value !== 'object') {
    return
  }
  const record = value as Record<string, unknown>
  const marker = record.$unresolved as Partial<Unresolved> | undefined
  if (marker && typeof marker === 'object') {
    visit({ kind: String(marker.kind), id: String(marker.id), from: String(marker.from) })
    return
  }
  for (const item of Object.values(record)) {
    walkUnresolved(item, visit)
  }
}
