import irSchema from '../../schemas/ir-1.schema.json' with { type: 'json' }
import { stableStringify } from './serialize.js'
import type { Issue } from './types.js'

/** The JSON Schema keywords the shipped schemas use. validateSchema throws on any other keyword. */
export interface JsonSchema {
  $defs?: Record<string, JsonSchema>
  $ref?: string
  additionalProperties?: boolean | JsonSchema
  allOf?: JsonSchema[]
  const?: unknown
  enum?: unknown[]
  if?: JsonSchema
  items?: JsonSchema
  maximum?: number
  minimum?: number
  pattern?: string
  patternProperties?: Record<string, JsonSchema>
  properties?: Record<string, JsonSchema>
  required?: string[]
  then?: JsonSchema
  type?: string | string[]
  uniqueItems?: boolean
  [keyword: string]: unknown
}

export interface SchemaError {
  message: string
  path: string
}

// TypeScript gives heterogeneous JSON arrays `?: undefined` members, so the literal type does not fit JsonSchema.
const IR_SCHEMA = irSchema as unknown as JsonSchema

/** Checks a document against ir-1.schema.json. Empty when it conforms. */
export function validateIR(document: unknown): Issue[] {
  return validateSchema(IR_SCHEMA, document).map(({ path, message }) => ({
    code: 'E_IR_SCHEMA',
    message,
    ...(path ? { configPath: path } : {}),
  }))
}

export function validateSchema(root: JsonSchema, document: unknown): SchemaError[] {
  assertSupported(root, '#', true)
  const errors: SchemaError[] = []
  check(root, document, '')
  return errors

  function check(schema: JsonSchema, value: unknown, path: string, out = errors): void {
    if (schema.$ref) {
      check(resolve(root, schema.$ref), value, path, out)
    }
    for (const message of mismatches(schema, value)) {
      out.push({ path, message })
    }
    if (Array.isArray(value) && schema.items) {
      for (const [index, item] of value.entries()) {
        check(schema.items, item, `${path}[${index}]`, out)
      }
    }
    if (isType('object', value)) {
      checkObject(schema, value as Record<string, unknown>, path, out)
    }
    for (const part of schema.allOf ?? []) {
      check(part, value, path, out)
    }
    if (schema.if && schema.then && passes(schema.if, value, path)) {
      check(schema.then, value, path, out)
    }
  }

  function passes(schema: JsonSchema, value: unknown, path: string): boolean {
    const scratch: SchemaError[] = []
    check(schema, value, path, scratch)
    return scratch.length === 0
  }

  function checkObject(schema: JsonSchema, value: Record<string, unknown>, path: string, out: SchemaError[]): void {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) {
        out.push({ path: join(path, name), message: `missing required field "${name}"` })
      }
    }
    for (const [name, field] of Object.entries(value)) {
      checkField(schema, name, field, join(path, name), out)
    }
  }

  // properties and patternProperties both apply; additionalProperties only when neither names the field.
  function checkField(schema: JsonSchema, name: string, field: unknown, path: string, out: SchemaError[]): void {
    const own = ownEntry(schema.properties, name)
    const patterns = Object.entries(schema.patternProperties ?? {}).filter(([pattern]) =>
      new RegExp(pattern, 'u').test(name),
    )
    if (own) {
      check(own, field, path, out)
    }
    for (const [, pattern] of patterns) {
      check(pattern, field, path, out)
    }
    if (own || patterns.length > 0) {
      return
    }
    if (schema.additionalProperties === false) {
      out.push({ path, message: `unexpected field "${name}"` })
    } else if (typeof schema.additionalProperties === 'object') {
      check(schema.additionalProperties, field, path, out)
    }
  }
}

/** The keywords that look at the value alone: type, const, enum, pattern, minimum, maximum and uniqueItems. */
function mismatches(schema: JsonSchema, value: unknown): string[] {
  const messages: string[] = []
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => isType(type, value))) {
      messages.push(`expected ${types.join(' or ')}, got ${describe(value)}`)
    }
  }
  if (Object.hasOwn(schema, 'const') && !same(value, schema.const)) {
    messages.push(`expected ${JSON.stringify(schema.const)}`)
  }
  if (schema.enum && !schema.enum.some((allowed) => same(value, allowed))) {
    messages.push(`expected one of ${schema.enum.map((allowed) => JSON.stringify(allowed)).join(', ')}`)
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
    messages.push(`does not match ${schema.pattern}`)
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    messages.push(`expected at least ${schema.minimum}`)
  }
  if (typeof value === 'number' && schema.maximum !== undefined && value > schema.maximum) {
    messages.push(`expected at most ${schema.maximum}`)
  }
  if (Array.isArray(value) && schema.uniqueItems === true) {
    const texts = value.map((item) => stableStringify(item))
    const repeated = texts.findIndex((text, index) => texts.indexOf(text) !== index)
    if (repeated !== -1) {
      messages.push(`expected unique items, item ${repeated} repeats an earlier one`)
    }
  }
  return messages
}

function resolve(root: JsonSchema, ref: string): JsonSchema {
  const name = ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : undefined
  const target = name === undefined ? undefined : ownEntry(root.$defs, name)
  if (!target) {
    throw new Error(`unknown $ref ${ref}`)
  }
  return target
}

// $schema and $id on the root only: a nested $id would move $ref resolution, which follows #/$defs/ from the root.
const ANNOTATIONS = ['description', 'title']
const ROOT_KEYWORDS = new Set(['$schema', '$id', ...ANNOTATIONS])
const KEYWORDS = new Set([
  ...ANNOTATIONS,
  '$defs',
  '$ref',
  'additionalProperties',
  'allOf',
  'const',
  'enum',
  'if',
  'items',
  'maximum',
  'minimum',
  'pattern',
  'patternProperties',
  'properties',
  'required',
  'then',
  'type',
  'uniqueItems',
])

/**
 * Throws on a keyword validateSchema does not implement, so no part of a published contract is skipped silently.
 * `value` is unknown because the shipped schemas are JSON cast to JsonSchema: any part may be any JSON value.
 */
function assertSupported(value: unknown, at: string, root = false): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`unsupported ${describe(value)} schema at ${at}`)
  }
  const schema = value as JsonSchema
  for (const keyword of Object.keys(schema)) {
    if (!(KEYWORDS.has(keyword) || (root && ROOT_KEYWORDS.has(keyword)))) {
      throw new Error(`unsupported JSON Schema keyword "${keyword}" at ${at}`)
    }
  }
  for (const keyword of ['additionalProperties', 'items', 'if', 'then'] as const) {
    const part = schema[keyword]
    // additionalProperties is the one place a boolean schema is implemented.
    if (part !== undefined && !(keyword === 'additionalProperties' && typeof part === 'boolean')) {
      assertSupported(part, `${at}/${keyword}`)
    }
  }
  for (const [index, part] of (schema.allOf ?? []).entries()) {
    assertSupported(part, `${at}/allOf/${index}`)
  }
  for (const keyword of ['$defs', 'properties', 'patternProperties'] as const) {
    for (const [name, part] of Object.entries(schema[keyword] ?? {})) {
      assertSupported(part, `${at}/${keyword}/${name}`)
    }
  }
}

function ownEntry<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined
}

function isType(type: string, value: unknown): boolean {
  if (type === 'null') {
    return value === null
  }
  if (type === 'array') {
    return Array.isArray(value)
  }
  if (type === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
  if (type === 'integer') {
    return Number.isInteger(value)
  }
  return typeof value === type
}

function describe(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

function same(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function join(path: string, name: string): string {
  return path ? `${path}.${name}` : name
}
