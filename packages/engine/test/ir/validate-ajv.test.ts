import Ajv2020 from 'ajv/dist/2020.js'
import { expect, test } from 'vitest'
import blueprintSchema from '../../schemas/blueprint-1.schema.json' with { type: 'json' }
import lockSchema from '../../schemas/blueprints-lock-1.schema.json' with { type: 'json' }
import irSchema from '../../schemas/ir-1.schema.json' with { type: 'json' }
import planSchema from '../../schemas/plan-1.schema.json' with { type: 'json' }
import stateSchema from '../../schemas/state-1.schema.json' with { type: 'json' }
import { type JsonSchema, validateSchema } from '../../src/ir/validate.js'
import { fixture } from './fixture.js'

// Ajv is the reference: validateSchema must reach its verdict on every document. Ajv stays a dev dependency, so
// @kalup/core keeps no runtime dependencies.
const ajv = new Ajv2020.default({ strictTypes: false })

type Node = Record<string, unknown> | unknown[]
type Path = string[]

// Keys every object inherits from Object.prototype, or reaches through it for __proto__. Each is added with a value
// that an open map of strings accepts, one a free-form object accepts, and one a map of targets accepts.
const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']
const ADDED = ['x', {}, { portalId: 1 }]
// One of each JSON type, plus values that miss the consts, enums, minimums and address patterns, and values that
// switch an if/then on: a portal frontend, an unknown step action or otherObjects, a blocked risk, a create, a delete
// and a release.
const VALUES = [
  null,
  true,
  false,
  0,
  2,
  1.5,
  -1,
  '',
  'x',
  'group:a b',
  [],
  {},
  'portal',
  'unknown',
  'blocked',
  'create',
  'delete',
  'release',
]
// Keys that fail the address pattern on resources, tombstones and overrides.
const RENAMES = ['x', 'Group:billing', 'group:a b']
// Several thousand documents per fixture: up to 3 s alone, much longer while turbo builds the other packages.
const EXHAUSTIVE = 60_000

function containers(value: unknown, path: Path = []): Path[] {
  if (typeof value !== 'object' || value === null) {
    return []
  }
  return [path, ...Object.entries(value).flatMap(([key, child]) => containers(child, [...path, key]))]
}

function at(document: unknown, path: Path): Node {
  return path.reduce((node, key) => (node as Record<string, unknown>)[key], document) as Node
}

/** A copy with `change` applied at `path`, read back from JSON text so every key, __proto__ too, is own. */
function edit(document: unknown, path: Path, change: (node: Node) => void): unknown {
  const copy = structuredClone(document)
  change(at(copy, path))
  return JSON.parse(JSON.stringify(copy))
}

// defineProperty, not assignment: assigning __proto__ would replace the prototype instead of adding a key.
function put(node: Node, key: string, value: unknown): void {
  Object.defineProperty(node, key, { value, enumerable: true, writable: true, configurable: true })
}

function* mutations(document: unknown): Generator<[string, unknown]> {
  yield ['unchanged', document]
  for (const path of containers(document)) {
    const node = at(document, path)
    const where = path.join('.') || '(root)'
    for (const key of Object.keys(node)) {
      for (const value of VALUES) {
        yield [`${where}.${key} = ${JSON.stringify(value)}`, edit(document, path, (n) => put(n, key, value))]
      }
    }
    if (Array.isArray(node)) {
      continue
    }
    for (const key of INHERITED) {
      for (const value of ADDED) {
        yield [`${where}.${key} added as ${JSON.stringify(value)}`, edit(document, path, (n) => put(n, key, value))]
      }
    }
    for (const key of Object.keys(node)) {
      yield [`${where}.${key} removed`, edit(document, path, (n) => Reflect.deleteProperty(n, key))]
      for (const name of RENAMES.filter((rename) => rename !== key)) {
        const renamed = edit(document, path, (n) => {
          put(n, name, (n as Record<string, unknown>)[key])
          Reflect.deleteProperty(n, key)
        })
        yield [`${where}.${key} renamed to ${name}`, renamed]
      }
    }
  }
}

test.each([
  ['acme.ir.json', irSchema],
  ['spec-example.ir.json', irSchema],
  ['snapshot.ir.json', irSchema],
  ['state-example.json', stateSchema],
  ['plan-example.json', planSchema],
  ['plan-architecture.json', planSchema],
  ['blueprint-example.json', blueprintSchema],
  ['blueprints-lock-example.json', lockSchema],
])(
  'validateSchema and Ajv agree on %s and every mutation of it',
  (name, schema) => {
    const reference = ajv.compile(schema)
    const verdicts = { valid: 0, invalid: 0 }
    const disagreements: string[] = []
    for (const [mutation, document] of mutations(fixture(name))) {
      const ours = validateSchema(schema as unknown as JsonSchema, document).length === 0
      verdicts[ours ? 'valid' : 'invalid'] += 1
      if (ours !== reference(document)) {
        disagreements.push(`${mutation}: validateSchema says ${ours ? 'valid' : 'invalid'}, Ajv the opposite`)
      }
    }
    expect(disagreements.length, disagreements.slice(0, 20).join('\n')).toBe(0)
    // Both verdicts occur, so agreement is not agreement on everything or nothing.
    expect(verdicts.valid).toBeGreaterThan(0)
    expect(verdicts.invalid).toBeGreaterThan(0)
  },
  EXHAUSTIVE,
)

test('an added __proto__ reaches both validators as an own key', () => {
  const added = [...mutations(fixture('state-example.json'))].find(([mutation]) =>
    mutation.startsWith('(root).__proto__'),
  )
  expect(Object.hasOwn(added?.[1] as object, '__proto__')).toBe(true)
})
