import { expect, test } from 'vitest'
import type { Blueprint } from '../../src/blueprint/types.js'
import { defaultCodec, validateBlueprint } from '../../src/blueprint/validate.js'
import { fixture } from '../../src/ir/fixture.js'

const example = (): Blueprint => fixture<Blueprint>('blueprint-example.json')

/** The example with one change made to a copy. */
function changed(change: (b: Blueprint & Record<string, unknown>) => void): unknown {
  const copy = example() as Blueprint & Record<string, unknown>
  change(copy)
  return copy
}

function property(b: Blueprint, address = 'property:deals/renewal_date') {
  return b.resources[address] as NonNullable<Blueprint['resources'][string]>
}

const messages = (document: unknown) => validateBlueprint(document).map((i) => `${i.configPath}: ${i.message}`)

test('the example is a blueprint', () => {
  expect(validateBlueprint(example())).toEqual([])
})

test('every issue is E_BLUEPRINT_SCHEMA with a path', () => {
  const issues = validateBlueprint(changed((b) => Object.assign(b, { blueprintVersion: 2 })))
  expect(issues).toEqual([{ code: 'E_BLUEPRINT_SCHEMA', message: 'expected 1', configPath: 'blueprintVersion' }])
})

test.each([
  [
    'irVersion 2',
    (b: Blueprint & Record<string, unknown>) => Object.assign(b, { irVersion: 2 }),
    'irVersion: expected 1',
  ],
  [
    'a missing version',
    (b: Record<string, unknown>) => Reflect.deleteProperty(b, 'version'),
    'version: missing required field "version"',
  ],
  [
    'a version that is not semver',
    (b: Record<string, unknown>) => Object.assign(b, { version: '1.1' }),
    'version: does not match',
  ],
  [
    'a name with capitals',
    (b: Record<string, unknown>) => Object.assign(b, { name: 'Acme/Renewals' }),
    'name: does not match',
  ],
  [
    'a name with three segments',
    (b: Record<string, unknown>) => Object.assign(b, { name: 'a/b/c' }),
    'name: does not match',
  ],
  // acme--renewals would share kalup/.blueprints/acme--renewals@<version>.json with acme/renewals.
  [
    'a name with two dashes in a row',
    (b: Record<string, unknown>) => Object.assign(b, { name: 'acme--renewals' }),
    'name: does not match',
  ],
  [
    'a name segment that ends in a dash',
    (b: Record<string, unknown>) => Object.assign(b, { name: 'acme-/renewals' }),
    'name: does not match',
  ],
  [
    'an unknown top-level field',
    (b: Record<string, unknown>) => Object.assign(b, { docs: 'x' }),
    'docs: unexpected field "docs"',
  ],
  [
    'a requires entry that is not an object',
    (b: Blueprint) => Object.assign(b, { requires: [{ $ref: 'group:deals/x' }] }),
    'requires[0].$ref: does not match',
  ],
  [
    'an unknown resource type',
    (b: Blueprint) => Object.assign(property(b), { type: 'pipeline' }),
    '.type: expected one of "group", "property"',
  ],
  [
    'provenance on a resource',
    (b: Blueprint) => Object.assign(property(b), { provenance: {} }),
    'unexpected field "provenance"',
  ],
  ['x on a resource', (b: Blueprint) => Object.assign(property(b), { x: {} }), 'unexpected field "x"'],
  [
    'managed on a resource',
    (b: Blueprint) => Object.assign(property(b), { managed: false }),
    'unexpected field "managed"',
  ],
  [
    'a property without a group',
    (b: Blueprint) => Reflect.deleteProperty(property(b).definition, 'group'),
    'missing required field "group"',
  ],
  [
    'an unknown definition field',
    (b: Blueprint) => Object.assign(property(b).definition, { validator: 'x' }),
    'unexpected field "validator"',
  ],
  [
    'a json codec',
    (b: Blueprint) => Object.assign(property(b), { binding: { codec: 'json' } }),
    '.binding.codec: expected one of',
  ],
  [
    'binding.export',
    (b: Blueprint) => Object.assign(property(b), { binding: { export: 'Deal' } }),
    'unexpected field "export"',
  ],
  [
    'a key that is not an identifier',
    (b: Blueprint) => Object.assign(property(b), { binding: { key: "a'b" } }),
    '.binding.key: does not match',
  ],
  [
    'a lifecycle without options',
    (b: Blueprint) => Object.assign(property(b), { lifecycle: {} }),
    'missing required field "options"',
  ],
  [
    'a group with a binding',
    (b: Blueprint) => Object.assign(b.resources['group:deals/renewal'] as object, { binding: {} }),
    'unexpected field "binding"',
  ],
  [
    'a group with a description',
    (b: Blueprint) =>
      Object.assign((b.resources['group:deals/renewal'] as { definition: object }).definition, { description: '' }),
    'unexpected field "description"',
  ],
])('the schema refuses %s', (_, change, expected) => {
  expect(messages(changed(change as (b: Blueprint & Record<string, unknown>) => void)).join('\n')).toContain(expected)
})

test('a resource key that is not an address is refused, and so is one whose type is not its resource type', () => {
  const notAddress = changed((b) => Object.assign(b.resources, { renewal: property(b) }))
  expect(messages(notAddress)).toEqual(['resources.renewal: unexpected field "renewal"'])
  const mismatch = changed((b) => Object.assign(b.resources, { 'group:deals/renewal_date': property(b) }))
  expect(messages(mismatch)).toEqual([
    "resources.group:deals/renewal_date.type: 'group:deals/renewal_date' is a group address, but its type is property",
  ])
  const unknown = changed((b) => Object.assign(b.resources, { 'pipeline:deals/renewals': property(b) }))
  expect(messages(unknown)).toEqual([
    "resources.pipeline:deals/renewals: 'pipeline:deals/renewals' is not of the form group:<object>/<name> or property:<object>/<name>",
  ])
})

test('hs_ names and names that are not plain are refused, for properties, groups and object keys', () => {
  const b = example()
  const document = {
    ...b,
    resources: {
      'group:deals/hs_renewal': { type: 'group', definition: { label: 'Renewal' } },
      'property:deals/hs_renewal_date': property(b),
      'property:deals/RenewalDate': property(b),
      'property:Deals/renewal_date': property(b),
    },
  }
  expect(messages(document)).toEqual([
    "resources.group:deals/hs_renewal: group name 'hs_renewal' starts with hs_, the prefix HubSpot uses for its own names",
    "resources.property:deals/hs_renewal_date: property name 'hs_renewal_date' starts with hs_, the prefix HubSpot uses for its own names",
    "resources.property:deals/RenewalDate: property name 'RenewalDate' is not lowercase letters, digits and underscores starting with a letter",
    "resources.property:Deals/renewal_date: object key 'Deals' is not lowercase letters, digits and underscores starting with a letter",
    "resources.property:Deals/renewal_date.definition.group: the group 'group:deals/renewal' is not a group of Deals, group:Deals/<name>",
  ])
})

test("a property's group is a group of its own object", () => {
  const document = changed((b) => Object.assign(property(b).definition, { group: { $ref: 'group:companies/renewal' } }))
  expect(messages(document)).toMatchInlineSnapshot(`
    [
      "resources.property:deals/renewal_date.definition.group: the group 'group:companies/renewal' is not a group of deals, group:deals/<name>",
    ]
  `)
  const notGroup = changed((b) => Object.assign(property(b).definition, { group: { $ref: 'property:deals/renewal' } }))
  expect(messages(notGroup)).toHaveLength(1)
})

test("a group $ref's name is plain: control characters and other text never reach E_BLUEPRINT_REF", () => {
  const ref = 'group:deals/x\u001b[31mRED\u202e'
  const document = changed((b) => Object.assign(property(b).definition, { group: { $ref: ref } }))
  expect(messages(document)).toEqual([
    `resources.property:deals/renewal_date.definition.group: group name 'x\u001b[31mRED\u202e' is not lowercase letters, digits and underscores starting with a letter`,
  ])
  const plain = changed((b) =>
    Object.assign(property(b).definition, { group: { $ref: 'group:deals/dealinformation' } }),
  )
  expect(messages(plain)).toEqual([])
})

test('option values are unique, and an alias names an option', () => {
  const stage = 'property:deals/renewal_stage'
  const document = changed((b) => {
    const d = property(b, stage).definition as { options: object[] }
    d.options.push({ value: 'open', label: 'Open again' })
    Object.assign(property(b, stage), { binding: { aliases: { WON: 'won', lost: 'lost' } } })
  })
  expect(messages(document)).toMatchInlineSnapshot(`
    [
      "resources.property:deals/renewal_stage.definition.options[2]: option value 'open' is listed twice",
      "resources.property:deals/renewal_stage.binding.aliases: an alias names option 'lost', which the options do not list",
    ]
  `)
})

test('the codec takes the HubSpot type and fieldType, stated or implied', () => {
  const codec = (binding: object, definition: object = {}) =>
    messages(
      changed((b) => {
        Object.assign(property(b), { binding })
        Object.assign(property(b).definition, definition)
      }),
    )
  expect({
    numberOnDate: codec({ codec: 'number' }),
    textOnDate: codec({}, { fieldType: 'text' }),
    checkboxOnEnum: codec({ codec: 'enum' }, { type: 'enumeration', fieldType: 'checkbox' }),
  }).toMatchInlineSnapshot(`
    {
      "checkboxOnEnum": [
        "resources.property:deals/renewal_date.definition.fieldType: fieldType 'checkbox' is not allowed for enum: use 'select', 'radio', 'booleancheckbox'",
      ],
      "numberOnDate": [
        "resources.property:deals/renewal_date.binding.codec: codec number is for type number, not date",
      ],
      "textOnDate": [
        "resources.property:deals/renewal_date.definition.fieldType: fieldType 'text' is not allowed for date: use 'date'",
      ],
    }
  `)
  expect(codec({}, { type: 'enumeration', fieldType: 'checkbox' })).toEqual([])
  expect(codec({ codec: 'stringArray' }, { type: 'string', fieldType: 'textarea' })).toEqual([])
})

test("'__proto__' is refused as a key: it would set the prototype of the app's properties", () => {
  const document = JSON.parse(JSON.stringify(example()).replace('"key":"renewalDate"', '"key":"__proto__"')) as unknown
  expect(messages(document)).toEqual(["resources.property:deals/renewal_date.binding.key: '__proto__' cannot be a key"])
})

test('a string that looks like JavaScript is data: the blueprint passes and keeps it as written', () => {
  const code = "'); require('child_process').exec('rm -rf ~'); ('"
  const document = changed((b) =>
    Object.assign(property(b).definition, { label: code, description: 'process.exit(1)' }),
  )
  expect(validateBlueprint(document)).toEqual([])
  expect((document as Blueprint).resources['property:deals/renewal_date']?.definition.label).toBe(code)
})

test('non-objects are refused without throwing', () => {
  for (const value of [null, 'x', 1, [], true]) {
    expect(validateBlueprint(value)[0]).toMatchObject({ code: 'E_BLUEPRINT_SCHEMA' })
  }
})

test('defaultCodec follows the HubSpot type, checkbox to multiEnum, and implies nothing for an unknown type', () => {
  expect(defaultCodec('string', 'text')).toBe('string')
  expect(defaultCodec('bool', 'booleancheckbox')).toBe('boolean')
  expect(defaultCodec('enumeration', 'select')).toBe('enum')
  expect(defaultCodec('enumeration', 'checkbox')).toBe('multiEnum')
  expect(defaultCodec('constructor', 'text')).toBeUndefined()
  expect(defaultCodec(undefined, undefined)).toBeUndefined()
})
