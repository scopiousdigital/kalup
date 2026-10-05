// Offline validation of a loaded project: the E_* table from the spec and the warnings. The loader itself raises
// E_DUPLICATE_ADDRESS, E_DUPLICATE_KEY, E_REFERENCE_DEFINITION and E_NOT_DATA for a custom object without labels,
// because one IR cannot hold those; everything here is a rule a well-formed IR can still break. The ir/1 schema check
// belongs to `kalup ir --check`, not here: on a loader-derived IR it only repeats these rules without a file or line.
import type { BuilderKind, Definition, LifecycleFields, Override } from '../grammar/types.js'
import { isAddress, parseAddress } from '../ir/address.js'
import { PROPERTY_FIELDS } from '../ir/defaults.js'
import type { Address, IR, IRResource, Issue } from '../ir/types.js'
import { STANDARD_OBJECTS } from '../lib/pull/scope.js'
import {
  effectiveResources,
  OVERRIDABLE,
  OVERRIDABLE_LIFECYCLE,
  type Overridable,
  withDefinition,
} from './effective.js'
import { DEFAULT_DIR, LEGACY_DIR } from './layout.js'
import type { Loaded } from './load.js'
import {
  BUILDER_FIELDS,
  CALCULATION,
  FIELD_TYPES,
  HUBSPOT_TYPES,
  hasPipelines,
  OBJECT_DEFAULT_PROPERTIES,
  OBJECT_DISPLAY_FIELDS,
  OBJECT_NAME,
  OBJECT_NAME_MAX,
  PIPELINE_ID_MAX,
  reservedPrefix,
  STAGE_FIELDS,
  STAGE_ID_MAX,
  type StageField,
  stageField,
} from './tables.js'

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

/** The address types a tombstone may name, each with its form and the shape of its path. */
export const REMOVABLE: Readonly<Record<string, { form: string; path: RegExp }>> = {
  object: { form: 'object:<name>', path: /^[^\s/]+$/ },
  property: { form: 'property:<object>/<name>', path: /^[^\s/]+\/[^\s/]+$/ },
  group: { form: 'group:<object>/<name>', path: /^[^\s/]+\/[^\s/]+$/ },
  pipeline: { form: 'pipeline:<object>/<id>', path: /^[^\s/]+\/[^\s/]+$/ },
  stage: { form: 'stage:<object>/<pipeline>/<stage>', path: /^[^\s/]+\/[^\s/]+\/[^\s/]+$/ },
}

/** The definition fields a property can own, the names `lifecycle.ignoreChanges` may use. */
const DEFINITION_FIELDS = PROPERTY_FIELDS.filter(
  (field) => field !== 'type' && field !== 'externalOptions' && field !== 'referencedObjectType',
) as string[]

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

  if (loaded.layout.legacy) {
    warnings.push({
      code: 'W_LEGACY_DIR',
      message: `the object files are in ${LEGACY_DIR}/, the old default folder; the default is now ${DEFAULT_DIR}/`,
      file: CONFIG,
      fix: `add dir: '${LEGACY_DIR}' to ${CONFIG}, or move ${LEGACY_DIR}/ to ${DEFAULT_DIR}/`,
    })
  }
  checkTargets(loaded, options.target, { issues, warnings })
  checkScopes(loaded, { issues, warnings })
  checkTombstones(loaded, issues)
  checkPipelines(loaded, issues)
  checkObjects(loaded, { issues, warnings })
  return { issues, warnings }
}

/**
 * The rules HubSpot keeps for a custom object schema (observed 2026-10-05): a name of a letter, then letters, digits and
 * underscores, at most 50 characters, and labels of at most 50. A display, required or searchable field names a
 * property: one the object file lists, or one HubSpot gives every custom object. HubSpot refuses a schema write naming
 * a property it does not hold; one the file does not list may still be in the portal, so it is a warning here, and plan
 * blocks the write when the portal lacks it too.
 */
function checkObjects(loaded: Loaded, { issues, warnings }: Validation): void {
  const { ir, sources } = loaded
  for (const [address, resource] of Object.entries(ir.resources)) {
    if (resource.type !== 'object') {
      continue
    }
    const name = parseAddress(address).path
    const d = resource.definition ?? {}
    const source = sources[address] ?? { file: '', line: 0, configPath: address }
    const at = (suffix: string): Pick<Issue, 'file' | 'line' | 'configPath'> => ({
      file: source.file,
      line: source.line,
      configPath: source.configPath + suffix,
    })
    issues.push(...objectNameRules(address, d, at))
    for (const field of OBJECT_DISPLAY_FIELDS) {
      for (const property of [d[field] ?? []].flat() as string[]) {
        if (OBJECT_DEFAULT_PROPERTIES.has(property) || Object.hasOwn(ir.resources, `property:${name}/${property}`)) {
          continue
        }
        warnings.push({
          code: 'W_OBJECT_PROPERTY',
          message: `${field} of ${address} names ${property}, which the object file does not list; HubSpot refuses a schema write naming a property it does not hold`,
          ...at(`.${field}`),
          fix: `add ${property} to the object's properties, as a reference if HubSpot holds it already: p.string('${property}')`,
        })
      }
    }
  }
}

// A custom object's name and labels as HubSpot takes them.
function objectNameRules(
  address: Address,
  d: Record<string, unknown>,
  at: (suffix: string) => Pick<Issue, 'file' | 'line' | 'configPath'>,
): Issue[] {
  const name = parseAddress(address).path
  const out: Issue[] = []
  if (!OBJECT_NAME.test(name) || name.length > OBJECT_NAME_MAX) {
    out.push({
      code: 'E_OBJECT_FIELD',
      message: `'${name}' is not a custom object name HubSpot takes: a letter, then letters, digits and underscores, at most ${OBJECT_NAME_MAX} characters`,
      ...at(''),
      fix: 'choose another name; HubSpot never changes a custom object name once it creates the object',
    })
  }
  const labels = (d.labels ?? {}) as Record<string, unknown>
  for (const form of ['singular', 'plural']) {
    const label = labels[form]
    if (typeof label === 'string' && label.length > OBJECT_NAME_MAX) {
      out.push({
        code: 'E_OBJECT_FIELD',
        message: `the ${form} label of ${address} is longer than ${OBJECT_NAME_MAX} characters, which HubSpot refuses`,
        ...at(`.labels.${form}`),
        fix: `use a label of at most ${OBJECT_NAME_MAX} characters`,
      })
    }
  }
  return out
}

/**
 * The rules HubSpot keeps for pipelines and stages, observed 2026-10-01 and 2026-10-05: IDs of a length it stores and
 * not held elsewhere (a pipeline ID across the portal, a stage ID across one object's pipelines), at least one stage
 * and on tickets one closed one, labels unique ignoring case (a stage's also ignoring spaces around it), and each
 * stage's metadata field the one its object takes.
 */
function checkPipelines(loaded: Loaded, issues: Issue[]): void {
  const { ir, sources } = loaded
  const at = (address: Address, suffix = ''): Pick<Issue, 'file' | 'line' | 'configPath'> => {
    const source = sources[address] ?? { file: '', line: 0, configPath: address }
    return { file: source.file, line: source.line, configPath: source.configPath + suffix }
  }
  const pipelineIds = new Map<string, Address>()
  const pipelineLabels = new Map<string, Address>()
  const stageIds = new Map<string, Address>()
  for (const [address, resource] of Object.entries(ir.resources)) {
    if (resource.type !== 'pipeline') {
      continue
    }
    const [object = '', id = ''] = parseAddress(address).path.split('/')
    const d = resource.definition ?? {}
    if (!hasPipelines(object, !STANDARD_OBJECTS.has(object))) {
      issues.push({
        code: 'E_PIPELINE_FIELD',
        message: `${address} is a pipeline of ${object}, which has no pipelines`,
        ...at(address),
        fix: 'name an object that has pipelines, such as deals, tickets or a custom object',
      })
    }
    const first = pipelineIds.get(id)
    if (first === undefined) {
      pipelineIds.set(id, address)
    } else {
      issues.push({
        code: 'E_PIPELINE_ID',
        message: `${address} has the ID of ${first}, and HubSpot keeps pipeline IDs unique across objects`,
        ...at(address, '.id'),
        fix: 'give one of the two another ID',
      })
    }
    if (id.length > PIPELINE_ID_MAX) {
      issues.push(tooLong(address, PIPELINE_ID_MAX, at(address, '.id')))
    }
    const label = String(d.label).toLowerCase()
    const same = pipelineLabels.get(`${object}/${label}`)
    if (same === undefined) {
      pipelineLabels.set(`${object}/${label}`, address)
    } else {
      issues.push({
        code: 'E_DUPLICATE_LABEL',
        message: `${same} and ${address} share the label '${d.label}', ignoring case`,
        ...at(address, '.label'),
        fix: 'give one of the two another label',
      })
    }
    const order = d.displayOrder
    if (!(Number.isInteger(order) && (order as number) >= 0)) {
      issues.push({
        code: 'E_PIPELINE_FIELD',
        message: `displayOrder ${order} of ${address} is not an integer from 0 up`,
        ...at(address, '.displayOrder'),
        fix: 'use 0 or more: HubSpot lists pipelines lowest first',
      })
    }
    checkStages(ir, address, object, stageIds, at, issues)
  }
}

type AtAddress = (address: Address, suffix?: string) => Pick<Issue, 'file' | 'line' | 'configPath'>

// The stages of one pipeline: their count, their labels, their IDs and their metadata.
function checkStages(
  ir: IR,
  pipeline: Address,
  object: string,
  stageIds: Map<string, Address>,
  at: AtAddress,
  issues: Issue[],
): void {
  const ids = ((ir.resources[pipeline]?.definition?.stages as string[] | undefined) ?? []).filter((id) =>
    Object.hasOwn(ir.resources, `stage:${pipeline.slice('pipeline:'.length)}/${id}`),
  )
  if (ids.length === 0) {
    issues.push({
      code: 'E_PIPELINE_STAGES',
      message: `${pipeline} has no stage, and HubSpot needs one`,
      ...at(pipeline, '.stages'),
      fix: 'add a stage, or run kalup rm on the pipeline',
    })
  }
  const field = stageField(object, !STANDARD_OBJECTS.has(object))
  const labels = new Map<string, Address>()
  let closed = false
  for (const id of ids) {
    const address = `stage:${pipeline.slice('pipeline:'.length)}/${id}`
    const d = ir.resources[address]?.definition ?? {}
    const first = stageIds.get(`${object}/${id}`)
    if (first === undefined) {
      stageIds.set(`${object}/${id}`, address)
    } else {
      issues.push({
        code: 'E_PIPELINE_ID',
        message: `${address} has the ID of ${first}, and HubSpot keeps stage IDs unique across an object's pipelines`,
        ...at(address, '.id'),
        fix: 'give one of the two another ID, such as the pipeline ID followed by the stage',
      })
    }
    if (id.length > STAGE_ID_MAX) {
      issues.push(tooLong(address, STAGE_ID_MAX, at(address, '.id')))
    }
    const label = String(d.label).trim().toLowerCase()
    const same = labels.get(label)
    if (same === undefined) {
      labels.set(label, address)
    } else {
      issues.push({
        code: 'E_DUPLICATE_LABEL',
        message: `stages ${same} and ${address} share the label '${label}', ignoring case and spaces around it`,
        ...at(address, '.label'),
        fix: 'give one of the two another label',
      })
    }
    closed ||= d.ticketState === 'CLOSED'
    for (const rule of stageRules(object, field, d)) {
      issues.push({ code: 'E_PIPELINE_FIELD', message: rule.message, ...at(address, rule.field), fix: rule.fix })
    }
  }
  if (field === 'ticketState' && ids.length > 0 && !closed) {
    issues.push({
      code: 'E_PIPELINE_STAGES',
      message: `${pipeline} has no stage with ticketState 'CLOSED', and HubSpot needs one`,
      ...at(pipeline, '.stages'),
      fix: "mark the stage tickets end in ticketState: 'CLOSED'",
    })
  }
}

const FIELD_OBJECTS: Record<StageField, string> = {
  probability: 'deal stages',
  ticketState: 'ticket stages',
  state: 'custom object stages',
}

/**
 * What is wrong with one stage's metadata, as config or an override states it: a field its object does not take, a deal
 * stage without a probability (unless `override`, which states only what differs), a probability outside 0..1. Each
 * entry's `field` is the suffix it points at.
 */
export function stageRules(
  object: string,
  field: StageField | undefined,
  d: Record<string, unknown>,
  override = false,
): Omit<Rule, 'reads'>[] {
  const out: Omit<Rule, 'reads'>[] = []
  for (const name of STAGE_FIELDS) {
    if (d[name] === undefined || name === field) {
      continue
    }
    const takes =
      field === undefined
        ? `a stage of ${object} takes none: Kalup reads and compares its pipelines and does not write them`
        : `a stage of ${object} takes ${field}`
    out.push({
      field: `.${name}`,
      message: `${name} is for ${FIELD_OBJECTS[name]}; ${takes}`,
      fix: field === undefined ? `remove ${name}` : `replace ${name} with ${field}`,
    })
  }
  const p = d.probability
  if (field === 'probability' && p === undefined && !override) {
    out.push({
      field: '',
      message: 'a deal stage needs a probability, and HubSpot refuses one without',
      fix: 'add probability, from 0 to 1: 0 and 1 make the stage closed',
    })
  } else if (field === 'probability' && p !== undefined && !(typeof p === 'number' && p >= 0 && p <= 1)) {
    out.push({ field: '.probability', message: `probability ${p} is not from 0 to 1`, fix: 'use a number from 0 to 1' })
  }
  return out
}

function tooLong(address: Address, max: number, at: Pick<Issue, 'file' | 'line' | 'configPath'>): Issue {
  return {
    code: 'E_PIPELINE_ID',
    message: `the ID of ${address} is longer than ${max} characters, which HubSpot answers with an error and does not store`,
    ...at,
    fix: `use an ID of at most ${max} characters`,
  }
}

/**
 * The settings under objects and targets.<t>.objects: a name include and exclude both list, a target object objects
 * does not declare, and a target mode that overrides an object's mode the target says nothing more about.
 */
function checkScopes(loaded: Loaded, { issues, warnings }: Validation): void {
  const { config, configLines } = loaded
  const at = (configPath: string): Pick<Issue, 'file' | 'line' | 'configPath'> => ({
    file: CONFIG,
    ...(configLines[configPath] === undefined ? {} : { line: configLines[configPath] }),
    configPath,
  })
  checkExcludes(config, at, issues)
  for (const [name, target] of Object.entries(config.targets)) {
    for (const object of Object.keys(target.objects ?? {})) {
      if (!Object.hasOwn(config.objects, object)) {
        issues.push({
          code: 'E_SETTING_VALUE',
          message: `targets.${name}.objects names ${object}, which objects does not declare`,
          ...at(`targets.${name}.objects.${object}`),
          fix: `add ${object} to objects, or remove it from targets.${name}.objects`,
        })
      }
    }
    for (const object of target.mode === undefined ? [] : Object.keys(config.objects)) {
      const scope = config.objects[object]
      const stated = target.objects?.[object]?.mode !== undefined
      if (scope?.mode === undefined || scope.mode === target.mode || stated) {
        continue
      }
      warnings.push({
        code: 'W_MODE_SHADOWED',
        message: `targets.${name}.mode '${target.mode}' overrides objects.${object}.mode '${scope.mode}' on target ${name}`,
        ...at(`targets.${name}.mode`),
        fix: `state it under targets.${name}.objects.${object}.mode, or remove one of the two`,
      })
    }
  }
}

// A name include and exclude of one object both list, and pipelines asked of an object that has none.
function checkExcludes(config: Loaded['config'], at: At, issues: Issue[]): void {
  for (const [object, scope] of Object.entries(config.objects)) {
    if (scope.pipelines === true && !hasPipelines(object, !STANDARD_OBJECTS.has(object))) {
      issues.push({
        code: 'E_SETTING_VALUE',
        message: `objects.${object}.pipelines is true, and ${object} has no pipelines`,
        ...at(`objects.${object}.pipelines`),
        fix: `remove pipelines from objects.${object}`,
      })
    }
    const both = (scope.include ?? []).filter((name) => (scope.exclude ?? []).includes(name))
    if (both.length > 0) {
      issues.push({
        code: 'E_SETTING_VALUE',
        message: `objects.${object} lists ${both.map((name) => `'${name}'`).join(', ')} in both include and exclude`,
        ...at(`objects.${object}.exclude`),
        fix: 'remove each from one of the two lists',
      })
    }
  }
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
  checkOptions(resource, d, at, issues)
  checkRules(codec, d, at, issues)
  if (resource.binding?.strict && !(d.options as unknown[] | undefined)?.length) {
    issues.push({
      code: 'E_STRICT_WITHOUT_OPTIONS',
      message: `.strict() on '${name}', which lists no options, so its codec would throw on every value`,
      ...at(),
      fix: 'list the options, or drop .strict()',
    })
  }
  checkLifecycle(resource, d, at, issues)
  const reserved = reservedPrefix(name)
  if (resource.managed && reserved !== undefined) {
    issues.push({
      code: 'E_HS_PREFIX',
      message: `'${name}' starts with ${reserved}, a prefix HubSpot reserves (hs_ for its own properties, a<digits>_ for an integration's)`,
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

/**
 * Target names, portal IDs and override addresses in kalup.config.ts, then defaultTarget, then the target a command
 * asked for.
 */
function checkTargets(loaded: Loaded, requested: string | undefined, { issues, warnings }: Validation): void {
  const { ir, config, configLines } = loaded
  const configAt = (configPath: string): Pick<Issue, 'file' | 'line' | 'configPath'> => ({
    file: CONFIG,
    ...(configLines[configPath] === undefined ? {} : { line: configLines[configPath] }),
    configPath,
  })
  // The first target that pins each portal.
  const pins = new Map<number, string>()
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
      // A pending target: init wrote it before the portal ID was known. Offline commands work; the networked ones
      // refuse it with E_PENDING_TARGET.
      warnings.push({
        code: 'W_PENDING_TARGET',
        message: `target '${name}' has no portalId yet, so no command reads or writes its portal`,
        ...configAt(path),
        fix: `set targets.${name}.portalId to the Hub ID from the HubSpot account menu`,
      })
    } else if (!Number.isInteger(target.portalId) || target.portalId < 1) {
      issues.push({
        code: 'E_PORTAL_ID',
        message: `portalId ${target.portalId} is not a positive integer`,
        ...configAt(`${path}.portalId`),
        fix: 'set portalId to the portal ID shown in HubSpot, a positive integer',
      })
    } else if (pins.has(target.portalId)) {
      const first = pins.get(target.portalId)
      issues.push({
        code: 'E_DUPLICATE_PORTAL',
        message: `target '${name}' pins portal ${target.portalId}, which target '${first}' pins too`,
        ...configAt(`${path}.portalId`),
        fix: `each portal has one target; remove or rename one of ${first}, ${name}`,
      })
    } else {
      pins.set(target.portalId, name)
    }
    const overrides = target.overrides ?? {}
    const at = (suffix: string) => configAt(`${path}.overrides.${suffix}`)
    checkOverrides(ir, name, overrides, at, issues)
    checkDefinitions(ir, name, overrides, at, { issues, warnings })
    checkTargetPipelines(loaded, name, overrides, at, issues)
  }
  const declared = Object.keys(config.targets)
  // An own key only, as for the requested target: 'toString' must not find Object.prototype.
  if (config.defaultTarget !== undefined && !Object.hasOwn(config.targets, config.defaultTarget)) {
    issues.push({
      code: 'E_DEFAULT_TARGET',
      message: `defaultTarget '${config.defaultTarget}' is not a declared target`,
      ...configAt('defaultTarget'),
      fix:
        declared.length > 0
          ? `use one of ${declared.join(', ')}, or remove defaultTarget`
          : 'declare a target under targets, or remove defaultTarget',
    })
  }
  if (requested !== undefined && !Object.hasOwn(config.targets, requested)) {
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

/**
 * Every key of removed.ts is a custom object, property, group, pipeline or stage address, and none is also a resource
 * in config: removing a resource takes it out of config.
 */
function checkTombstones(loaded: Loaded, issues: Issue[]): void {
  const {
    ir,
    removedLines,
    layout: { removed },
  } = loaded
  for (const key of Object.keys(ir.tombstones)) {
    const at = {
      file: removed,
      ...(removedLines[key] === undefined ? {} : { line: removedLines[key] }),
      configPath: key,
    }
    const fix =
      "write the address of a custom object, property, group, pipeline or stage, such as 'property:companies/legacy_score'"
    if (!isAddress(key)) {
      issues.push({ code: 'E_TOMBSTONE_ADDRESS', message: `'${key}' is not an address`, ...at, fix })
      continue
    }
    const { type, path } = parseAddress(key)
    const shape = Object.hasOwn(REMOVABLE, type) ? REMOVABLE[type] : undefined
    if (!shape) {
      issues.push({
        code: 'E_TOMBSTONE_ADDRESS',
        message: `cannot remove ${key}: this version removes custom objects, properties, groups, pipelines and stages only`,
        ...at,
        fix: `remove ${key} from ${removed}`,
      })
    } else if (!shape.path.test(path)) {
      const message = `'${key}' is not of the form ${shape.form}`
      issues.push({ code: 'E_TOMBSTONE_ADDRESS', message, ...at, fix })
    } else if (Object.hasOwn(ir.resources, key)) {
      issues.push({
        code: 'E_TOMBSTONE_CONFLICT',
        message: `${key} is in ${removed} and in config`,
        ...at,
        fix: 'remove it from config, or run kalup rm, which does both',
      })
    } else if (type === 'object' && onObject(ir, path).length > 0) {
      // A custom object's tombstone takes everything on it along, so nothing on it may stay in config.
      issues.push({
        code: 'E_TOMBSTONE_CONFLICT',
        message: `${key} is in ${removed} while config still holds what is on it: ${onObject(ir, path).join(', ')}`,
        ...at,
        fix: `run kalup rm ${key}, which takes them out with the object, or remove them from config`,
      })
    }
  }
}

/** The config addresses on one object: its groups, properties, pipelines and stages, sorted. */
export function onObject(ir: Pick<IR, 'resources'>, object: string): Address[] {
  return Object.keys(ir.resources)
    .filter((address) => parseAddress(address).type !== 'object' && parseAddress(address).path.split('/')[0] === object)
    .sort()
}

/**
 * Every override key is an address in config, and no two addresses read one portal resource: a name override is
 * neither the own name of another address nor the name another override reads.
 */
function checkOverrides(
  ir: IR,
  target: string,
  overrides: Record<string, Override>,
  at: (suffix: string) => Pick<Issue, 'file' | 'line' | 'configPath'>,
  issues: Issue[],
): void {
  // The portal resource a name override reads, as the address of that name, to the first override that reads it. A
  // skip wins over a name, so a skipped address reads nothing.
  const claimed = new Map<Address, Address>()
  for (const [address, override] of Object.entries(overrides)) {
    // An own key only: a key such as 'toString' must not find Object.prototype.
    if (!Object.hasOwn(ir.resources, address)) {
      issues.push({
        code: 'E_UNKNOWN_OVERRIDE',
        message: `override '${address}' is not an address in config`,
        ...at(address),
        fix: 'use an address that kalup ir lists, or remove the override',
      })
      continue
    }
    if (override.name === undefined) {
      continue
    }
    const other = sibling(address, override.name)
    const first = claimed.get(other ?? address)
    if (override.skip !== true && first !== undefined) {
      issues.push({
        code: 'E_OVERRIDE_NAME',
        message: `the name override for ${address} on target ${target} is '${override.name}', which the name override for ${first} names too`,
        ...at(`${address}.name`),
        fix: `give each of the two its own portal name on ${target}, or remove one of the two overrides`,
      })
      continue
    }
    if (override.skip !== true) {
      claimed.set(other ?? address, address)
    }
    // Two addresses would read the same portal resource: this one through its override, the other by its own name.
    if (other === undefined || !ir.resources[other] || overrides[other]?.name !== undefined) {
      continue
    }
    issues.push({
      code: 'E_OVERRIDE_NAME',
      message: `the name override for ${address} on target ${target} is '${override.name}', the name of ${other}, which has no name override there`,
      ...at(`${address}.name`),
      fix: `give ${other} its own name override on ${target}, or rename one of the two in config`,
    })
  }
}

type At = (suffix: string) => Pick<Issue, 'file' | 'line' | 'configPath'>

/**
 * Every definition override on one target: only a managed property or a group takes one, with only the
 * fields that may differ per target and no option alias, and the effective definition passes the rules a shared one
 * must. A rule is checked only where the override states a field it reads, so a shared definition's own issue is not
 * reported again for each target.
 */
function checkDefinitions(
  ir: IR,
  target: string,
  overrides: Record<string, Override>,
  at: At,
  { issues, warnings }: Validation,
): void {
  for (const [address, override] of Object.entries(overrides)) {
    const d = override.definition
    const resource = Object.hasOwn(ir.resources, address) ? ir.resources[address] : undefined
    if (d === undefined || !resource) {
      continue
    }
    const where = located(at, `${address}.definition`)
    const report = (suffix: string, message: string, fix: string) =>
      issues.push({
        code: 'E_OVERRIDE_DEFINITION',
        message: `${address} on target ${target}: ${message}`,
        ...where(suffix),
        fix,
      })
    const refused = refusal(address, resource)
    if (refused) {
      report('', refused, `remove the definition override for ${address} under targets.${target}.overrides`)
      continue
    }
    const { type, path } = parseAddress(address) as { type: Overridable; path: string }
    checkFields(type, d, report)
    const order = (d as Record<string, unknown>).displayOrder
    if (type === 'pipeline' && order !== undefined && !(Number.isInteger(order) && (order as number) >= 0)) {
      report('.displayOrder', `displayOrder ${order} is not an integer from 0 up`, 'use 0 or more')
    }
    if (type === 'stage') {
      const object = path.slice(0, path.indexOf('/'))
      const field = stageField(object, !STANDARD_OBJECTS.has(object))
      for (const rule of stageRules(object, field, d as Record<string, unknown>, true)) {
        report(rule.field, rule.message, rule.fix)
      }
    }
    if (type === 'property') {
      checkEffective(ir, address, resource, d, report)
      checkEffectiveOptions(address, resource, d, report)
      checkOverrideOptions(address, target, resource, d, where, warnings, report)
    }
  }
}

/**
 * The pipeline rules on the resources one target's definition overrides leave: a label two pipelines or two stages
 * would share, a ticket pipeline left with no closed stage. Only what the shared files do not
 * break already is reported, as E_OVERRIDE_DEFINITION at the first override the message names, else at an override of
 * a stage of the pipeline it names.
 */
function checkTargetPipelines(
  loaded: Loaded,
  target: string,
  overrides: Record<string, Override>,
  at: At,
  issues: Issue[],
): void {
  const touched = Object.keys(overrides).filter(
    (address) =>
      (address.startsWith('pipeline:') || address.startsWith('stage:')) &&
      Object.hasOwn(loaded.ir.resources, address) &&
      overrides[address]?.definition !== undefined,
  )
  if (touched.length === 0) {
    return
  }
  const shared: Issue[] = []
  checkPipelines(loaded, shared)
  const known = new Set(shared.map((issue) => issue.message))
  const found: Issue[] = []
  checkPipelines({ ...loaded, ir: { ...loaded.ir, resources: effectiveResources(loaded.ir, target) } }, found)
  // A field rule is checkDefinitions' own, where the override states the field: here only what spans resources.
  const spanning = found.filter((i) => SPANNING.has(i.code) && !known.has(i.message))
  for (const issue of spanning) {
    const words = issue.message.split(WORD_BREAK)
    const pipelineOf = (a: Address) => (a.startsWith('stage:') ? `pipeline:${a.slice(6, a.lastIndexOf('/'))}` : a)
    const address =
      words.find((word) => touched.includes(word)) ??
      touched.find((a) => words.includes(pipelineOf(a))) ??
      (touched[0] as Address)
    issues.push({
      code: 'E_OVERRIDE_DEFINITION',
      message: `on target ${target}, ${issue.message}`,
      ...located(at, `${address}.definition`)(),
      ...(issue.fix === undefined ? {} : { fix: issue.fix }),
    })
  }
}

const SPANNING = new Set(['E_DUPLICATE_LABEL', 'E_PIPELINE_STAGES'])
// What separates the addresses in a message from the words and quotes around them.
const WORD_BREAK = /[\s,']+/

// Where an issue about the override definition at `path` points. An array item has no line of its own: an option's is
// its value's, else the definition's.
function located(at: At, path: string): (suffix?: string) => Pick<Issue, 'file' | 'line' | 'configPath'> {
  return (suffix = '') => {
    const full = `${path}${suffix}`
    const line = [full, `${full}.value`, path].map((p) => at(p).line).find((l) => l !== undefined)
    return { ...at(full), ...(line === undefined ? {} : { line }) }
  }
}

// Only the fields that may differ per target: a property's OVERRIDABLE fields and lifecycle ones, a group's label, a
// pipeline's label and displayOrder, a stage's label and metadata.
function checkFields(type: Overridable, d: Definition, report: Report): void {
  for (const field of Object.keys(d) as (keyof Definition)[]) {
    if (field === 'lifecycle' && type === 'property') {
      const inner = (Object.keys(d.lifecycle ?? {}) as (keyof LifecycleFields)[]).filter(
        (f) => !OVERRIDABLE_LIFECYCLE.includes(f),
      )
      for (const f of inner) {
        report(
          `.lifecycle.${f}`,
          `lifecycle.${f} cannot differ per target`,
          `remove ${f} from the override's lifecycle`,
        )
      }
    } else if (!(OVERRIDABLE[type] as readonly string[]).includes(field)) {
      report(`.${field}`, notOverridable(type, field), `remove ${field} from the override`)
    }
  }
}

/** Why a resource cannot take a definition override at all, or undefined when it can. */
function refusal(address: Address, resource: IRResource): string | undefined {
  const { type } = parseAddress(address)
  if (type === 'object') {
    return 'a custom object schema cannot take a definition override in this release'
  }
  if (!Object.hasOwn(OVERRIDABLE, type)) {
    return 'only a property, a group, a pipeline or a stage can take a definition override'
  }
  if (resource.managed) {
    return undefined
  }
  const d = resource.definition ?? {}
  return d.label !== undefined && d.group !== undefined && d.fieldType !== undefined
    ? 'it is .managed(false), so no target owns its definition'
    : 'it is a reference (its shared definition has no label, group and fieldType), so nothing on it can differ per target'
}

function notOverridable(type: Overridable, field: string): string {
  if (field === 'hasUniqueValue' || field === 'dataSensitivity') {
    return `${field} is fixed when HubSpot creates the property, so it cannot differ per target`
  }
  if (type === 'group') {
    return `a group override may set label only, not ${field}`
  }
  if (type === 'pipeline') {
    return `a pipeline override may set label and displayOrder only, not ${field}`
  }
  return type === 'stage'
    ? `a stage override may set label and its metadata only, not ${field}`
    : `${field} cannot differ per target`
}

type Report = (suffix: string, message: string, fix: string) => void

// The effective definition passes the shared rules: fieldType fits the builder, the group is one of the object's in
// config.
function checkEffective(ir: IR, address: Address, resource: IRResource, d: Definition, report: Report): void {
  const codec = resource.binding?.codec
  const object = address.slice('property:'.length, address.indexOf('/'))
  if (d.fieldType !== undefined && codec && !FIELD_TYPES[codec].includes(d.fieldType)) {
    report(
      '.fieldType',
      `fieldType '${d.fieldType}' is not allowed for p.${codec} (type ${HUBSPOT_TYPES[codec]})`,
      `use one of ${FIELD_TYPES[codec].map((f) => `'${f}'`).join(', ')}`,
    )
  }
  const group = `group:${object}/${d.group}`
  if (d.group !== undefined && ir.resources[group]?.type !== 'group') {
    report(
      '.group',
      `group '${d.group}' is not in the groups of ${object}`,
      `add ${d.group}: { label: '...' } to the groups block of ${object}`,
    )
  }
  const effective = withDefinition(address, resource, d).definition ?? {}
  const stated = new Set(Object.keys(d))
  for (const rule of codec ? definitionRules(codec, effective) : []) {
    if (rule.reads.some((field) => stated.has(field))) {
      report(`.${rule.field}`, rule.message, rule.fix)
    }
  }
}

// E_DEFINITION_FIELD for each rule the shared definition breaks.
function checkRules(
  codec: BuilderKind | undefined,
  d: Record<string, unknown>,
  at: (suffix: string) => Pick<Issue, 'file' | 'line' | 'configPath'>,
  issues: Issue[],
): void {
  for (const rule of codec ? definitionRules(codec, d) : []) {
    issues.push({ code: 'E_DEFINITION_FIELD', message: rule.message, ...at(`.${rule.field}`), fix: rule.fix })
  }
}

/** A definition field the builder, the fieldType or another field rules out: the field, why, the fields it reads. */
interface Rule {
  field: string
  fix: string
  message: string
  reads: string[]
}

/**
 * The definition fields HubSpot would refuse or misread for this builder: a display field of another builder, a formula
 * on a property that is no calculation (HubSpot makes it one), a currency property without the currency symbol
 * (HubSpot refuses it), a display order below -1, and options on p.owner (HubSpot fills them).
 */
export function definitionRules(codec: BuilderKind, d: Record<string, unknown>): Rule[] {
  const rules: Rule[] = []
  for (const [field, kinds] of Object.entries(BUILDER_FIELDS)) {
    if (d[field] !== undefined && !kinds.includes(codec)) {
      const on = kinds.map((k) => `p.${k}`).join(', ')
      rules.push({ field, reads: [field], message: `${field} is for ${on}, not p.${codec}`, fix: `remove ${field}` })
    }
  }
  if (d.calculationFormula !== undefined && d.fieldType !== CALCULATION) {
    rules.push({
      field: 'calculationFormula',
      reads: ['calculationFormula', 'fieldType'],
      message: `calculationFormula needs fieldType '${CALCULATION}': HubSpot turns the property into a calculation`,
      fix: `set fieldType: '${CALCULATION}', or remove calculationFormula`,
    })
  }
  if (d.currencyPropertyName === '') {
    rules.push({
      field: 'currencyPropertyName',
      reads: ['currencyPropertyName'],
      message: "currencyPropertyName '' is not nothing: HubSpot stores it and then never turns showCurrencySymbol off",
      fix: 'remove currencyPropertyName, or name a currency property',
    })
  } else if (d.currencyPropertyName !== undefined && d.showCurrencySymbol !== true) {
    rules.push({
      field: 'currencyPropertyName',
      reads: ['currencyPropertyName', 'showCurrencySymbol'],
      message: 'HubSpot takes currencyPropertyName only with showCurrencySymbol: true',
      fix: 'add showCurrencySymbol: true, or remove currencyPropertyName',
    })
  }
  const order = d.displayOrder
  if (order !== undefined && !(Number.isInteger(order) && (order as number) >= -1)) {
    rules.push({
      field: 'displayOrder',
      reads: ['displayOrder'],
      message: `displayOrder ${order} is not an integer from -1 up`,
      fix: 'use 0 or more for a place in the group, or -1 to come after every numbered property',
    })
  }
  if (codec === 'owner' && d.options !== undefined) {
    rules.push({
      field: 'options',
      reads: ['options'],
      message: "p.owner takes no options: HubSpot fills them with the account's users",
      fix: 'remove options',
    })
  }
  return rules
}

// The effective options and lifecycle pass the shared rules: option values are unique, removedOptions keeps no option,
// ignoreChanges names definition fields.
function checkEffectiveOptions(address: Address, resource: IRResource, d: Definition, report: Report): void {
  const effective = withDefinition(address, resource, d)
  const options = (effective.definition?.options as { value: string }[] | undefined) ?? []
  const values = new Set<string>()
  for (const [index, { value }] of (d.options ?? []).entries()) {
    if (values.has(value)) {
      report(`.options[${index}]`, `option value '${value}' is listed twice`, 'remove one of the two options')
    }
    values.add(value)
  }
  const kept = new Set(options.map((o) => o.value))
  const removed = d.lifecycle?.removedOptions === undefined ? '.options' : '.lifecycle.removedOptions'
  if (d.options !== undefined || d.lifecycle?.removedOptions !== undefined) {
    for (const value of new Set(effective.lifecycle?.removedOptions ?? [])) {
      if (kept.has(value)) {
        report(
          removed,
          `removedOptions names '${value}', which the target keeps in options`,
          'remove it from options or from removedOptions',
        )
      }
    }
  }
  for (const field of d.lifecycle?.ignoreChanges ?? []) {
    if (!DEFINITION_FIELDS.includes(field)) {
      report(
        '.lifecycle.ignoreChanges',
        `ignoreChanges names '${field}', which is not a definition field`,
        `use one of ${DEFINITION_FIELDS.join(', ')}`,
      )
    }
  }
}

// An override option carries value, label, hidden and description: the alias belongs to the app, in the shared file.
// A value the shared options lack is allowed. On a .strict() property it gets W_OVERRIDE_OPTION, since the app's codec
// throws on it; a lenient codec reads it as Unlisted.
function checkOverrideOptions(
  address: Address,
  target: string,
  resource: IRResource,
  d: Definition,
  where: (suffix?: string) => Pick<Issue, 'file' | 'line' | 'configPath'>,
  warnings: Issue[],
  report: Report,
): void {
  const shared = new Set(((resource.definition?.options as { value: string }[] | undefined) ?? []).map((o) => o.value))
  const { strict, key } = resource.binding ?? {}
  for (const [index, option] of (d.options ?? []).entries()) {
    if (option.as !== undefined) {
      report(
        `.options[${index}].as`,
        `option '${option.value}' carries as; aliases belong to the app and stay in the shared file`,
        'remove as from the override option',
      )
    }
    if (strict && !shared.has(option.value)) {
      warnings.push({
        code: 'W_OVERRIDE_OPTION',
        message: `${address} on target ${target}: option '${option.value}' is not in the shared options, so the app's codec for ${key} throws on this value`,
        ...where(`.options[${index}]`),
        fix: `add it to the shared options if the app reads ${key} from target ${target}`,
      })
    }
  }
}

/** The address of the same type, on the same object, whose local name is `name`. Undefined for the address itself. */
function sibling(address: Address, name: string): Address | undefined {
  const cut = address.startsWith('object:') ? address.indexOf(':') : address.lastIndexOf('/')
  const other = `${address.slice(0, cut + 1)}${name}`
  return other === address ? undefined : other
}

/** Option values must differ, and so must the aliases the app reads them as (`as ?? value`), or the codec is lossy. */
function checkOptions(
  resource: IRResource,
  d: Record<string, unknown>,
  at: (suffix: string) => Pick<Issue, 'file' | 'line' | 'configPath'>,
  issues: Issue[],
): void {
  const aliases = resource.binding?.aliases ?? {}
  const values = new Set<string>()
  const owners = new Map<string, string>()
  for (const [index, { value }] of ((d.options as { value: string }[] | undefined) ?? []).entries()) {
    if (values.has(value)) {
      issues.push({
        code: 'E_DUPLICATE_OPTION',
        message: `option value '${value}' is listed twice`,
        ...at(`.options[${index}]`),
        fix: 'remove one of the two options',
      })
      continue
    }
    values.add(value)
    const alias = (Object.hasOwn(aliases, value) ? aliases[value] : undefined) ?? value
    const owner = owners.get(alias)
    if (owner === undefined) {
      owners.set(alias, value)
      continue
    }
    issues.push({
      code: 'E_DUPLICATE_ALIAS',
      message: `options '${owner}' and '${value}' share the alias '${alias}'`,
      ...at(`.options[${index}]`),
      fix: 'give one of them another as; an option without as uses its value as the alias',
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
