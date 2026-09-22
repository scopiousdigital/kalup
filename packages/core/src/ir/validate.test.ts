import { expect, test } from 'vitest'
import { fixture } from './fixture.js'
import { validateIR } from './validate.js'

// biome-ignore lint/suspicious/noExplicitAny: test documents are broken on purpose, one field at a time
type Doc = Record<string, any>

function broken(change: (ir: Doc) => void): Doc {
  const ir = fixture<Doc>('acme.ir.json')
  change(ir)
  return ir
}

test('the golden IR fixtures conform to ir-1.schema.json', () => {
  expect(validateIR(fixture('spec-example.ir.json'))).toEqual([])
  expect(validateIR(fixture('acme.ir.json'))).toEqual([])
})

test('readers keep unknown fields: extra fields on the document and on a resource pass', () => {
  const ir = broken((ir) => {
    ir.sources = { 'group:companies/billing': { file: 'kalup/objects/companies.ts', line: 4 } }
    ir.resources['group:companies/billing'].note = 'kept'
  })
  expect(validateIR(ir)).toEqual([])
})

test('an unmanaged property may carry a partial definition, such as options only', () => {
  const ir = broken((ir) => {
    ir.resources['property:companies/lead_source'].definition = { options: [{ value: 'a', label: 'A' }] }
  })
  expect(validateIR(ir)).toEqual([])
})

test('an unknown resource type takes a free-form definition', () => {
  const ir = broken((ir) => {
    ir.resources['workflow:renewal_reminder'] = {
      type: 'workflow',
      managed: true,
      definition: { name: 'Renewal reminder', owner: { $unresolved: { kind: 'owner', id: '1234', from: 'sandbox' } } },
    }
  })
  expect(validateIR(ir)).toEqual([])
})

const cases: [string, (ir: Doc) => void, string, RegExp][] = [
  ['a wrong irVersion', (ir) => (ir.irVersion = 2), 'irVersion', /expected 1/],
  [
    'a missing managed flag',
    (ir) => delete ir.resources['group:companies/billing'].managed,
    'resources.group:companies/billing.managed',
    /missing required field "managed"/,
  ],
  [
    'a managed resource without a definition',
    (ir) => delete ir.resources['group:companies/billing'].definition,
    'resources.group:companies/billing.definition',
    /missing required field "definition"/,
  ],
  [
    'a managed property without fieldType',
    (ir) => delete ir.resources['property:companies/billing_id'].definition.fieldType,
    'resources.property:companies/billing_id.definition.fieldType',
    /missing required field "fieldType"/,
  ],
  [
    'a group as a plain string instead of a $ref',
    (ir) => (ir.resources['property:companies/billing_id'].definition.group = 'billing'),
    'resources.property:companies/billing_id.definition.group',
    /expected object, got string/,
  ],
  [
    'a $ref that is not an address',
    (ir) => (ir.resources['property:companies/billing_id'].definition.group = { $ref: 'billing' }),
    'resources.property:companies/billing_id.definition.group.$ref',
    /does not match/,
  ],
  [
    'a definition field the property shape does not know',
    (ir) => (ir.resources['property:companies/billing_id'].definition.lable = 'x'),
    'resources.property:companies/billing_id.definition.lable',
    /unexpected field "lable"/,
  ],
  [
    'an alias inside an option',
    (ir) => (ir.resources['property:companies/billing_status'].definition.options[1].as = 'past_due'),
    'resources.property:companies/billing_status.definition.options[1].as',
    /unexpected field "as"/,
  ],
  [
    'an unknown codec',
    (ir) => (ir.resources['property:companies/name'].binding.codec = 'text'),
    'resources.property:companies/name.binding.codec',
    /expected one of/,
  ],
  [
    'a lifecycle without options',
    (ir) => delete ir.resources['property:companies/billing_id'].lifecycle.options,
    'resources.property:companies/billing_id.lifecycle.options',
    /missing required field "options"/,
  ],
  [
    'a resource key that is not an address',
    (ir) => (ir.resources.billing = { type: 'group', managed: false }),
    'resources.billing',
    /unexpected field "billing"/,
  ],
  [
    'credentials on a target',
    (ir) => (ir.targets.sandbox.credentials = { read: { env: 'HUBSPOT_SANDBOX_KEY' } }),
    'targets.sandbox.credentials',
    /unexpected field "credentials"/,
  ],
  [
    'a portalId that is not a positive integer',
    (ir) => (ir.targets.sandbox.portalId = 0),
    'targets.sandbox.portalId',
    /at least 1/,
  ],
  [
    'an override key the sheet does not list',
    (ir) => (ir.targets.production.overrides['object:subscription'] = { rename: 'x' }),
    'targets.production.overrides.object:subscription.rename',
    /unexpected field "rename"/,
  ],
  [
    'skip set to false',
    (ir) => (ir.targets.production.overrides['object:subscription'] = { skip: false }),
    'targets.production.overrides.object:subscription.skip',
    /expected true/,
  ],
  [
    'a tombstone action outside destroy and release',
    (ir) => (ir.tombstones['property:companies/old_flag'].action = 'delete'),
    'tombstones.property:companies/old_flag.action',
    /expected one of "destroy", "release"/,
  ],
  [
    'a provenance without a hash',
    (ir) => delete ir.resources['property:companies/billing_status'].provenance.hash,
    'resources.property:companies/billing_status.provenance.hash',
    /missing required field "hash"/,
  ],
  [
    'a lookup value that is not a string',
    (ir) => (ir.resources['team:sales_emea'].lookup.name = 8841),
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
