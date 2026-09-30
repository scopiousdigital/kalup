// Checks a blueprint: blueprint-1.schema.json, then the rules a schema cannot state. Every issue is
// E_BLUEPRINT_SCHEMA. The text in a message may quote the blueprint, which is third-party: the CLI sanitizes it.
import blueprintSchema from '../../schemas/blueprint-1.schema.json' with { type: 'json' }
import type { BuilderKind } from '../grammar/types.js'
import type { Issue } from '../ir/types.js'
import { type JsonSchema, validateSchema } from '../ir/validate.js'
import { FIELD_TYPES, HUBSPOT_TYPES } from '../loader/tables.js'
import type { Blueprint, BlueprintResource } from './types.js'

// TypeScript gives heterogeneous JSON arrays `?: undefined` members, so the literal type does not fit JsonSchema.
const SCHEMA = blueprintSchema as unknown as JsonSchema

/** `<group|property>:<object>/<name>`. */
const ON_OBJECT = /^(group|property):([^\s/]+)\/([^\s/]+)$/
/** Object keys, group names and property names: lowercase, digits and underscores, a letter first. */
const NAME = /^[a-z][a-z0-9_]*$/

/** The codec each HubSpot type implies when a blueprint's binding names none. */
const CODECS: Record<string, BuilderKind> = {
  string: 'string',
  number: 'number',
  bool: 'boolean',
  date: 'date',
  datetime: 'datetime',
}

/** The codec a property's HubSpot type and fieldType imply: checkbox is p.multiEnum's, any other enumeration p.enum's. */
export function defaultCodec(type: unknown, fieldType: unknown): BuilderKind | undefined {
  if (type === 'enumeration') {
    return fieldType === 'checkbox' ? 'multiEnum' : 'enum'
  }
  // An own key only: a type such as 'constructor' implies nothing.
  return typeof type === 'string' && Object.hasOwn(CODECS, type) ? CODECS[type] : undefined
}

/** Checks a document against blueprint-1.schema.json, then the fragment's own rules. Empty when it is a blueprint. */
export function validateBlueprint(document: unknown): Issue[] {
  const schema = validateSchema(SCHEMA, document).map(({ path, message }) => issue(path, message))
  return schema.length > 0 ? schema : rules(document as Blueprint)
}

function issue(configPath: string, message: string): Issue {
  return { code: 'E_BLUEPRINT_SCHEMA', message, ...(configPath ? { configPath } : {}) }
}

type Report = (configPath: string, message: string) => void

// Addresses parse and match their type; names are plain and not HubSpot's; each property passes the loader's rules.
function rules(blueprint: Blueprint): Issue[] {
  const issues: Issue[] = []
  const report: Report = (configPath, message) => issues.push(issue(configPath, message))
  for (const [address, resource] of Object.entries(blueprint.resources)) {
    const at = `resources.${address}`
    const parts = ON_OBJECT.exec(address)
    if (!parts) {
      report(at, `'${address}' is not of the form group:<object>/<name> or property:<object>/<name>`)
      continue
    }
    const [, type, object, name] = parts as unknown as [string, 'group' | 'property', string, string]
    if (type !== resource.type) {
      report(`${at}.type`, `'${address}' is a ${type} address, but its type is ${resource.type}`)
      continue
    }
    if (!NAME.test(object)) {
      report(at, `object key '${object}' is not lowercase letters, digits and underscores starting with a letter`)
    }
    checkName(report, at, type, name)
    if (type === 'property') {
      checkProperty(report, at, object, resource)
    }
  }
  return issues
}

/** A group or property name: plain, and never HubSpot's own `hs_`. */
function checkName(report: Report, at: string, type: 'group' | 'property', name: string): void {
  if (!NAME.test(name)) {
    report(at, `${type} name '${name}' is not lowercase letters, digits and underscores starting with a letter`)
  } else if (name.startsWith('hs_')) {
    report(at, `${type} name '${name}' starts with hs_, the prefix HubSpot uses for its own names`)
  }
}

function checkProperty(report: Report, at: string, object: string, resource: BlueprintResource): void {
  const d = resource.definition
  const group = (d.group as { $ref: string }).$ref
  const parts = ON_OBJECT.exec(group)
  if (!(parts && parts[1] === 'group' && parts[2] === object)) {
    report(`${at}.definition.group`, `the group '${group}' is not a group of ${object}, group:${object}/<name>`)
  } else if (!NAME.test(parts[3] as string)) {
    // A group outside the fragment is quoted in E_BLUEPRINT_REF, so it must be a plain name too.
    report(
      `${at}.definition.group`,
      `group name '${parts[3]}' is not lowercase letters, digits and underscores starting with a letter`,
    )
  }
  const options = (d.options as { value: string }[] | undefined) ?? []
  const values = new Set<string>()
  for (const [index, { value }] of options.entries()) {
    if (values.has(value)) {
      report(`${at}.definition.options[${index}]`, `option value '${value}' is listed twice`)
    }
    values.add(value)
  }
  const binding = resource.binding ?? {}
  const codec = binding.codec ?? defaultCodec(d.type, d.fieldType)
  checkCodec(report, at, codec, d)
  if (binding.strict && codec !== 'enum' && codec !== 'multiEnum') {
    report(`${at}.binding.strict`, `strict is for the enum and multiEnum codecs, not ${String(codec)}`)
  } else if (binding.strict && options.length === 0) {
    report(`${at}.binding.strict`, 'strict needs options: without them the codec throws on every value')
  }
  for (const value of Object.keys(binding.aliases ?? {})) {
    if (!values.has(value)) {
      report(`${at}.binding.aliases`, `an alias names option '${value}', which the options do not list`)
    }
  }
  // An object literal key `__proto__` sets the prototype of the app's properties object instead of adding a key.
  if (binding.key === '__proto__') {
    report(`${at}.binding.key`, "'__proto__' cannot be a key")
  }
}

// The codec takes the HubSpot type and the fieldType, as the loader's E_TYPE_FIELDTYPE rule has it.
function checkCodec(report: Report, at: string, codec: BuilderKind | undefined, d: Record<string, unknown>): void {
  if (codec === undefined) {
    report(`${at}.definition.type`, `no codec carries type ${String(d.type)}`)
  } else if (HUBSPOT_TYPES[codec] !== d.type) {
    report(`${at}.binding.codec`, `codec ${codec} is for type ${HUBSPOT_TYPES[codec]}, not ${String(d.type)}`)
  } else if (!FIELD_TYPES[codec].includes(String(d.fieldType))) {
    const allowed = FIELD_TYPES[codec].map((f) => `'${f}'`).join(', ')
    report(
      `${at}.definition.fieldType`,
      `fieldType '${String(d.fieldType)}' is not allowed for ${codec}: use ${allowed}`,
    )
  }
}
