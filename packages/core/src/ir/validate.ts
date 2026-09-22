import irSchema from '../../schemas/ir-1.schema.json' with { type: 'json' }
import { stableStringify } from './serialize.js'
import type { Issue } from './types.js'

/** The JSON Schema keywords the shipped schemas use. Anything else is not interpreted. */
export interface JsonSchema {
  $defs?: Record<string, JsonSchema>
  $ref?: string
  additionalProperties?: boolean | JsonSchema
  allOf?: JsonSchema[]
  const?: unknown
  enum?: unknown[]
  if?: JsonSchema
  items?: JsonSchema
  minimum?: number
  pattern?: string
  patternProperties?: Record<string, JsonSchema>
  properties?: Record<string, JsonSchema>
  required?: string[]
  then?: JsonSchema
  type?: string | string[]
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
      if (!(name in value)) {
        out.push({ path: join(path, name), message: `missing required field "${name}"` })
      }
    }
    for (const [name, field] of Object.entries(value)) {
      checkField(schema, name, field, join(path, name), out)
    }
  }

  // properties and patternProperties both apply; additionalProperties only when neither names the field.
  function checkField(schema: JsonSchema, name: string, field: unknown, path: string, out: SchemaError[]): void {
    const own = schema.properties?.[name]
    const patterns = Object.entries(schema.patternProperties ?? {}).filter(([pattern]) =>
      new RegExp(pattern).test(name),
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

/** The keywords that look at the value alone: type, const, enum, pattern and minimum. */
function mismatches(schema: JsonSchema, value: unknown): string[] {
  const messages: string[] = []
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => isType(type, value))) {
      messages.push(`expected ${types.join(' or ')}, got ${describe(value)}`)
    }
  }
  if ('const' in schema && !same(value, schema.const)) {
    messages.push(`expected ${JSON.stringify(schema.const)}`)
  }
  if (schema.enum && !schema.enum.some((allowed) => same(value, allowed))) {
    messages.push(`expected one of ${schema.enum.map((allowed) => JSON.stringify(allowed)).join(', ')}`)
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    messages.push(`does not match ${schema.pattern}`)
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    messages.push(`expected at least ${schema.minimum}`)
  }
  return messages
}

function resolve(root: JsonSchema, ref: string): JsonSchema {
  const name = ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : undefined
  const target = name === undefined ? undefined : root.$defs?.[name]
  if (!target) {
    throw new Error(`unknown $ref ${ref}`)
  }
  return target
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
