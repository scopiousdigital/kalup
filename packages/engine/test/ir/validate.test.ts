import { expect, test } from 'vitest'
import { type JsonSchema, validateIR, validateSchema } from '../../src/ir/validate.js'
import { fixture } from './fixture.js'

// Untyped: test documents are broken on purpose, one field at a time.
type Doc = Record<string, any>

function broken(change: (ir: Doc) => void): Doc {
  const ir = fixture<Doc>('acme.ir.json')
  change(ir)
  return ir
}

/** Removes `field` from `parent[key]`. The schema tells a missing field from one set to undefined, so it is not set. */
function drop(parent: Doc, key: string, field: string): void {
  const { [field]: _dropped, ...rest } = parent[key]
  parent[key] = rest
}

test('the golden IR fixtures conform to ir-1.schema.json', () => {
  expect(validateIR(fixture('spec-example.ir.json'))).toEqual([])
  expect(validateIR(fixture('acme.ir.json'))).toEqual([])
})

test('a snapshot carries the observation block, which a portal-frontend document requires', () => {
  expect(validateIR(fixture('snapshot.ir.json'))).toEqual([])
  expect(validateIR(fixture('snapshot-no-observation.ir.json'))).toEqual([
    { code: 'E_IR_SCHEMA', message: 'missing required field "observation"', configPath: 'observation' },
  ])
  // Optional on a derived IR.
  const derived = broken((ir) => {
    ir.observation = fixture<Doc>('snapshot.ir.json').observation
  })
  expect(validateIR(derived)).toEqual([])
})

test('otherObjects is a list of names or the string unknown', () => {
  const snapshot = (otherObjects: unknown) => {
    const doc = fixture<Doc>('snapshot.ir.json')
    doc.observation.coverage.otherObjects = otherObjects
    return validateIR(doc)
  }
  expect(snapshot([])).toEqual([])
  expect(snapshot('unknown')).toEqual([])
  expect(snapshot('none')).toEqual([
    { code: 'E_IR_SCHEMA', message: 'expected "unknown"', configPath: 'observation.coverage.otherObjects' },
  ])
  expect(snapshot([7])).toEqual([
    { code: 'E_IR_SCHEMA', message: 'expected string, got number', configPath: 'observation.coverage.otherObjects[0]' },
  ])
})

test('a custom object schema without a label is recorded in coverage as returned', () => {
  const doc = fixture<Doc>('snapshot.ir.json')
  doc.observation.coverage.objects.shipment.unsupportedSchema = {
    labels: { plural: 'Shipments' },
    primaryDisplayProperty: 'shipment_ref',
    requiredProperties: [],
    searchableProperties: [],
    secondaryDisplayProperties: [],
  }
  expect(validateIR(doc)).toEqual([])
})

test('a property config names that the read could not address is recorded in coverage by name', () => {
  const doc = fixture<Doc>('snapshot.ir.json')
  doc.observation.coverage.objects.companies.unaddressable = ['fleet_tier']
  expect(validateIR(doc)).toEqual([])
  doc.observation.coverage.objects.companies.unaddressable = [7]
  expect(validateIR(doc)).toEqual([
    {
      code: 'E_IR_SCHEMA',
      message: 'expected string, got number',
      configPath: 'observation.coverage.objects.companies.unaddressable[0]',
    },
  ])
})

const snapshotCases: [string, (doc: Doc) => void, string, RegExp][] = [
  [
    'an unknown field in the observation block',
    (doc) => {
      doc.observation.source = 'cli'
    },
    'observation.source',
    /unexpected field "source"/,
  ],
  [
    'an observedAt that is not an ISO 8601 UTC time',
    (doc) => {
      doc.observation.observedAt = '23/09/2026 10:15'
    },
    'observation.observedAt',
    /does not match/,
  ],
  [
    'an object status outside read, unreadable, absent and excluded',
    (doc) => {
      doc.observation.coverage.objects.deals.status = 'skipped'
    },
    'observation.coverage.objects.deals.status',
    /expected one of "read", "unreadable", "absent", "excluded"/,
  ],
  [
    'an unsupported property without its group',
    (doc) => drop(doc.observation.coverage.objects.companies.unsupported, '0', 'group'),
    'observation.coverage.objects.companies.unsupported[0].group',
    /missing required field "group"/,
  ],
  [
    'a renamed key that is not an address',
    (doc) => {
      doc.observation.coverage.objects.companies.renamed = { fleet_tier: 'fleettier' }
    },
    'observation.coverage.objects.companies.renamed.fleet_tier',
    /unexpected field "fleet_tier"/,
  ],
  [
    'an unsupported schema with a field the schemas list does not return',
    (doc) => {
      doc.observation.coverage.objects.shipment.unsupportedSchema = { labels: {}, pipelines: [] }
    },
    'observation.coverage.objects.shipment.unsupportedSchema.pipelines',
    /unexpected field "pipelines"/,
  ],
  [
    'notCaptured without the object list',
    (doc) => drop(doc.observation.coverage, 'notCaptured', 'object'),
    'observation.coverage.notCaptured.object',
    /missing required field "object"/,
  ],
]

for (const [name, change, configPath, message] of snapshotCases) {
  test(`rejects a snapshot with ${name}`, () => {
    const doc = fixture<Doc>('snapshot.ir.json')
    change(doc)
    const issues = validateIR(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'E_IR_SCHEMA', configPath })
    expect(issues[0]?.message).toMatch(message)
  })
}

test('readers keep unknown fields: extra fields on the document and on a resource pass', () => {
  const doc = broken((ir) => {
    ir.sources = { 'group:companies/billing': { file: 'hubspot/objects/companies.ts', line: 4 } }
    ir.resources['group:companies/billing'].note = 'kept'
  })
  expect(validateIR(doc)).toEqual([])
})

test('an unmanaged property may carry a partial definition, such as options only', () => {
  const doc = broken((ir) => {
    ir.resources['property:companies/lead_source'].definition = { options: [{ value: 'a', label: 'A' }] }
  })
  expect(validateIR(doc)).toEqual([])
})

test('an unknown resource type takes a free-form definition', () => {
  const doc = broken((ir) => {
    ir.resources['workflow:renewal_reminder'] = {
      type: 'workflow',
      managed: true,
      definition: { name: 'Renewal reminder', owner: { $unresolved: { kind: 'owner', id: '1234', from: 'sandbox' } } },
    }
  })
  expect(validateIR(doc)).toEqual([])
})

const cases: [string, (ir: Doc) => void, string, RegExp][] = [
  [
    'a wrong irVersion',
    (ir) => {
      ir.irVersion = 2
    },
    'irVersion',
    /expected 1/,
  ],
  [
    'a missing managed flag',
    (ir) => drop(ir.resources, 'group:companies/billing', 'managed'),
    'resources.group:companies/billing.managed',
    /missing required field "managed"/,
  ],
  [
    'a managed resource without a definition',
    (ir) => drop(ir.resources, 'group:companies/billing', 'definition'),
    'resources.group:companies/billing.definition',
    /missing required field "definition"/,
  ],
  [
    'a managed property without fieldType',
    (ir) => drop(ir.resources['property:companies/billing_id'], 'definition', 'fieldType'),
    'resources.property:companies/billing_id.definition.fieldType',
    /missing required field "fieldType"/,
  ],
  [
    'a group as a plain string instead of a $ref',
    (ir) => {
      ir.resources['property:companies/billing_id'].definition.group = 'billing'
    },
    'resources.property:companies/billing_id.definition.group',
    /expected object, got string/,
  ],
  [
    'a $ref that is not an address',
    (ir) => {
      ir.resources['property:companies/billing_id'].definition.group = { $ref: 'billing' }
    },
    'resources.property:companies/billing_id.definition.group.$ref',
    /does not match/,
  ],
  [
    'a definition field the property shape does not know',
    (ir) => {
      ir.resources['property:companies/billing_id'].definition.lable = 'x'
    },
    'resources.property:companies/billing_id.definition.lable',
    /unexpected field "lable"/,
  ],
  [
    'an alias inside an option',
    (ir) => {
      ir.resources['property:companies/billing_status'].definition.options[1].as = 'past_due'
    },
    'resources.property:companies/billing_status.definition.options[1].as',
    /unexpected field "as"/,
  ],
  [
    'an unknown codec',
    (ir) => {
      ir.resources['property:companies/name'].binding.codec = 'text'
    },
    'resources.property:companies/name.binding.codec',
    /expected one of/,
  ],
  [
    'a lifecycle without options',
    (ir) => drop(ir.resources['property:companies/billing_id'], 'lifecycle', 'options'),
    'resources.property:companies/billing_id.lifecycle.options',
    /missing required field "options"/,
  ],
  [
    'a resource key that is not an address',
    (ir) => {
      ir.resources.billing = { type: 'group', managed: false }
    },
    'resources.billing',
    /unexpected field "billing"/,
  ],
  [
    'credentials on a target',
    (ir) => {
      ir.targets.sandbox.credentials = { read: { env: 'HUBSPOT_SANDBOX_KEY' } }
    },
    'targets.sandbox.credentials',
    /unexpected field "credentials"/,
  ],
  [
    'a portalId that is not a positive integer',
    (ir) => {
      ir.targets.sandbox.portalId = 0
    },
    'targets.sandbox.portalId',
    /at least 1/,
  ],
  [
    'an override key the sheet does not list',
    (ir) => {
      ir.targets.production.overrides['object:subscription'] = { rename: 'x' }
    },
    'targets.production.overrides.object:subscription.rename',
    /unexpected field "rename"/,
  ],
  [
    'skip set to false',
    (ir) => {
      ir.targets.production.overrides['object:subscription'] = { skip: false }
    },
    'targets.production.overrides.object:subscription.skip',
    /expected true/,
  ],
  [
    'a tombstone action outside destroy and release',
    (ir) => {
      ir.tombstones['property:companies/old_flag'].action = 'delete'
    },
    'tombstones.property:companies/old_flag.action',
    /expected one of "destroy", "release"/,
  ],
  [
    'a provenance without a hash',
    (ir) => drop(ir.resources['property:companies/billing_status'], 'provenance', 'hash'),
    'resources.property:companies/billing_status.provenance.hash',
    /missing required field "hash"/,
  ],
  [
    'a lookup value that is not a string',
    (ir) => {
      ir.resources['team:sales_emea'].lookup.name = 8841
    },
    'resources.team:sales_emea.lookup.name',
    /expected string, got number/,
  ],
]

for (const [name, change, configPath, message] of cases) {
  test(`rejects ${name}`, () => {
    const issues = validateIR(broken(change))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'E_IR_SCHEMA', configPath })
    expect(issues[0]?.message).toMatch(message)
  })
}

test('a document that is not an object is one issue with no path', () => {
  expect(validateIR('{}')).toEqual([{ code: 'E_IR_SCHEMA', message: 'expected object, got string' }])
})

test('a value that breaks several keywords reports every error, in keyword order', () => {
  const schema: JsonSchema = {
    $defs: { word: { type: 'string', pattern: '^[a-z]+$' } },
    type: 'object',
    required: ['id', 'status'],
    properties: {
      id: { type: 'integer' },
      status: {
        $ref: '#/$defs/word',
        type: ['string', 'null'],
        enum: ['open', 'closed'],
        minimum: 10,
        allOf: [{ const: 'open' }, { minimum: 7 }],
        // JSON text: a `then` key in an object literal trips lint/suspicious/noThenProperty.
        ...(JSON.parse('{ "if": { "type": "number" }, "then": { "minimum": 6 } }') as JsonSchema),
      },
      tags: { enum: [[]], items: { type: 'string' }, allOf: [{ const: [] }] },
      meta: { const: {}, required: ['b'], additionalProperties: { type: 'string' }, allOf: [{ required: ['c'] }] },
      x_count: { type: 'integer' },
    },
    patternProperties: {
      '^x_': { type: 'string', pattern: '^[0-9]+$' },
      _count$: { enum: [1, 2] },
    },
    additionalProperties: false,
  }
  const document = { status: 5, tags: ['ok', 3], meta: { a: 1 }, x_count: 'many', extra: true }
  expect(validateSchema(schema, document)).toEqual([
    { path: 'id', message: 'missing required field "id"' },
    { path: 'status', message: 'expected string, got number' },
    { path: 'status', message: 'expected string or null, got number' },
    { path: 'status', message: 'expected one of "open", "closed"' },
    { path: 'status', message: 'expected at least 10' },
    { path: 'status', message: 'expected "open"' },
    { path: 'status', message: 'expected at least 7' },
    { path: 'status', message: 'expected at least 6' },
    { path: 'tags', message: 'expected one of []' },
    { path: 'tags[1]', message: 'expected string, got number' },
    { path: 'tags', message: 'expected []' },
    { path: 'meta', message: 'expected {}' },
    { path: 'meta.b', message: 'missing required field "b"' },
    { path: 'meta.a', message: 'expected string, got number' },
    { path: 'meta.c', message: 'missing required field "c"' },
    { path: 'x_count', message: 'expected integer, got string' },
    { path: 'x_count', message: 'does not match ^[0-9]+$' },
    { path: 'x_count', message: 'expected one of 1, 2' },
    { path: 'extra', message: 'unexpected field "extra"' },
  ])
  // `if` rejects a string, so `then` is skipped and the errors `if` found stay out of the result.
  expect(validateSchema(schema, { id: 1, status: 'open' })).toEqual([])
})

test('uniqueItems compares items by value, whatever their key order, and names the first repeat', () => {
  const schema: JsonSchema = { type: 'array', uniqueItems: true }
  expect(validateSchema(schema, ['a', 'b', { x: 1, y: 2 }])).toEqual([])
  expect(validateSchema(schema, ['a', { x: 1, y: 2 }, 'b', { y: 2, x: 1 }, 'a'])).toEqual([
    { path: '', message: 'expected unique items, item 3 repeats an earlier one' },
  ])
  expect(validateSchema({ uniqueItems: false }, ['a', 'a'])).toEqual([])
})

const inheritedKeys = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']

test.each(inheritedKeys)('an own %s key is an unexpected field where the schema is closed', (key) => {
  // JSON.parse makes __proto__ an own key, as in a document read from disk, and spreading keeps it own.
  const doc = broken((ir) => {
    ir.generator = { ...ir.generator, ...JSON.parse(`{"${key}": "x"}`) }
  })
  expect(validateIR(doc)).toEqual([
    { code: 'E_IR_SCHEMA', message: `unexpected field "${key}"`, configPath: `generator.${key}` },
  ])
})

test('a required field must be an own key, not one every object inherits', () => {
  expect(validateSchema({ type: 'object', required: inheritedKeys }, {})).toEqual(
    inheritedKeys.map((name) => ({ path: name, message: `missing required field "${name}"` })),
  )
})

test('a $ref resolves to an own $defs entry only', () => {
  expect(() => validateSchema({ $defs: {}, $ref: '#/$defs/constructor' }, {})).toThrow(
    'unknown $ref #/$defs/constructor',
  )
})

test('a schema keyword the validator does not implement throws instead of being skipped', () => {
  expect(() => validateSchema({ type: 'string', maxLength: 3 }, 'abcd')).toThrow(
    'unsupported JSON Schema keyword "maxLength" at #',
  )
  // In a branch this document never reaches.
  expect(() => validateSchema({ properties: { a: { format: 'email' } } }, {})).toThrow(
    'unsupported JSON Schema keyword "format" at #/properties/a',
  )
  expect(() => validateSchema({ $defs: { a: { else: {} } } }, {})).toThrow(
    'unsupported JSON Schema keyword "else" at #/$defs/a',
  )
  // $id would move $ref resolution, which follows #/$defs/ from the root only.
  expect(() => validateSchema({ $defs: { a: { $id: 'a.json' } } }, {})).toThrow(
    'unsupported JSON Schema keyword "$id" at #/$defs/a',
  )
  // Only additionalProperties takes a boolean. JSON text, as JsonSchema types these as schemas.
  expect(() => validateSchema(JSON.parse('{ "items": false }'), [])).toThrow('unsupported boolean schema at #/items')
  expect(() => validateSchema(JSON.parse('{ "additionalProperties": null }'), {})).toThrow(
    'unsupported null schema at #/additionalProperties',
  )
})

test('patterns match code points, as JSON Schema 2020-12 and Ajv read them', () => {
  const schema: JsonSchema = { patternProperties: { '^.$': { pattern: '^.$' } }, additionalProperties: false }
  expect(validateSchema(schema, { '\u{1F600}': '\u{1F600}' })).toEqual([])
})
