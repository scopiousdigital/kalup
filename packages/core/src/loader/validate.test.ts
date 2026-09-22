import { expect, test } from 'vitest'
import { fixtureText, project } from './fixture.js'
import { type Loaded, loadFiles } from './load.js'
import { FIELD_TYPES, HUBSPOT_TYPES } from './tables.js'
import { validate } from './validate.js'

const FILE = 'kalup/objects/deals.ts'
const CONFIG = 'kalup.config.ts'
const rule = (name: string): string => fixtureText(`rules/${name}`)

function objectRule(code: string): Loaded {
  return loadFiles({ [CONFIG]: rule('base.config.ts'), [FILE]: rule(`${code}.ts`) })
}

function configRule(code: string): Loaded {
  return loadFiles({ [CONFIG]: rule(`${code}.config.ts`), [FILE]: rule('base.ts') })
}

test('the spec example, the base project and the app project validate clean', () => {
  expect(validate(loadFiles(project('spec')))).toEqual({ issues: [], warnings: [] })
  expect(validate(loadFiles(project('app')))).toEqual({ issues: [], warnings: [] })
  expect(validate(loadFiles(project('payload')))).toEqual({ issues: [], warnings: [] })
  expect(validate(configRule('base'), { target: 'sandbox' })).toEqual({ issues: [], warnings: [] })
})

test('E_KEY_COLLISION: two properties of one object map to the same app key', () => {
  expect(validate(objectRule('E_KEY_COLLISION')).issues).toEqual([
    {
      code: 'E_KEY_COLLISION',
      message:
        "key 'amount' is used by two properties of deals: property:deals/amount and property:deals/amount_in_home_currency",
      file: FILE,
      line: 13,
      configPath: 'DealExtra.properties.amount',
      fix: 'rename one of the two keys',
    },
  ])
})

test('E_TYPE_FIELDTYPE: a fieldType the builder does not allow, with the table as data', () => {
  expect(validate(objectRule('E_TYPE_FIELDTYPE')).issues).toEqual([
    {
      code: 'E_TYPE_FIELDTYPE',
      message: "fieldType 'checkbox' is not allowed for p.enum (type enumeration)",
      file: FILE,
      line: 8,
      configPath: 'Deal.properties.paymentTerms.fieldType',
      fix: "use one of 'select', 'radio', 'booleancheckbox'",
    },
    {
      code: 'E_TYPE_FIELDTYPE',
      message: "fieldType 'text' is not allowed for p.number (type number)",
      file: FILE,
      line: 14,
      configPath: 'Deal.properties.termDays.fieldType',
      fix: "use one of 'number'",
    },
  ])
  expect(FIELD_TYPES.multiEnum).toEqual(['checkbox'])
  expect(FIELD_TYPES.enum).not.toContain('checkbox')
  expect(FIELD_TYPES.json).toEqual(['text', 'textarea', 'file', 'phonenumber'])
  expect(HUBSPOT_TYPES).toEqual({
    string: 'string',
    number: 'number',
    boolean: 'bool',
    date: 'date',
    datetime: 'datetime',
    enum: 'enumeration',
    multiEnum: 'enumeration',
    stringArray: 'string',
    json: 'string',
  })
})

test('E_LIFECYCLE: removedOptions still in options, ignoreChanges naming no definition field', () => {
  expect(validate(objectRule('E_LIFECYCLE')).issues).toEqual([
    {
      code: 'E_LIFECYCLE',
      message: "removedOptions names 'net60', which is still in options",
      file: FILE,
      line: 8,
      configPath: 'Deal.properties.paymentTerms.lifecycle.removedOptions',
      fix: 'remove it from options or from removedOptions',
    },
    {
      code: 'E_LIFECYCLE',
      message: "ignoreChanges names 'lable', which is not a definition field",
      file: FILE,
      line: 8,
      configPath: 'Deal.properties.paymentTerms.lifecycle.ignoreChanges',
      fix: 'use one of label, group, fieldType, description, options, hasUniqueValue, formField',
    },
  ])
})

test('E_UNKNOWN_GROUP: a group that is not in the groups block', () => {
  expect(validate(objectRule('E_UNKNOWN_GROUP')).issues).toEqual([
    {
      code: 'E_UNKNOWN_GROUP',
      message: "group 'deal_terms' is not in the groups of deals",
      file: FILE,
      line: 5,
      configPath: 'Deal.properties.termDays.group',
      fix: "add deal_terms: { label: '...' } to the groups block",
    },
  ])
})

test('.managed(false) keeps its lifecycle in the IR and every definition rule still fires on it', () => {
  const loaded = objectRule('MANAGED_FALSE')
  expect(loaded.ir.resources['property:deals/kind']).toEqual({
    type: 'property',
    managed: false,
    definition: {
      label: 'Kind',
      group: { $ref: 'group:deals/other' },
      type: 'enumeration',
      fieldType: 'checkbox',
      options: [{ value: 'x', label: 'X' }],
    },
    binding: { key: 'kind', codec: 'enum' },
    lifecycle: { options: 'additive', removedOptions: ['x'], ignoreChanges: ['nope'], preventDestroy: true },
  })
  const { issues, warnings } = validate(loaded)
  expect(issues.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_TYPE_FIELDTYPE', 9, 'Deal.properties.kind.fieldType'],
    ['E_UNKNOWN_GROUP', 9, 'Deal.properties.kind.group'],
    ['E_LIFECYCLE', 9, 'Deal.properties.kind.lifecycle.removedOptions'],
    ['E_LIFECYCLE', 9, 'Deal.properties.kind.lifecycle.ignoreChanges'],
  ])
  expect(warnings).toEqual([])
})

test('E_HS_PREFIX: a managed property named hs_*; a reference may carry the prefix', () => {
  expect(validate(objectRule('E_HS_PREFIX')).issues).toEqual([
    {
      code: 'E_HS_PREFIX',
      message: "'hs_forecast_amount' starts with hs_, the prefix HubSpot uses for its own properties",
      file: FILE,
      line: 10,
      configPath: 'Deal.properties.forecast',
      fix: 'rename the property, or drop label, group and fieldType to reference it',
    },
  ])
})

test('E_PORTAL_ID: missing, zero, fractional and negative, one located issue each and nothing from the schema', () => {
  expect(validate(configRule('E_PORTAL_ID')).issues).toEqual([
    {
      code: 'E_PORTAL_ID',
      message: "target 'missing' has no portalId",
      file: CONFIG,
      line: 5,
      configPath: 'targets.missing',
      fix: 'add portalId: <the portal ID, a positive integer>',
    },
    {
      code: 'E_PORTAL_ID',
      message: 'portalId 0 is not a positive integer',
      file: CONFIG,
      line: 6,
      configPath: 'targets.zero.portalId',
      fix: 'set portalId to the portal ID shown in HubSpot, a positive integer',
    },
    {
      code: 'E_PORTAL_ID',
      message: 'portalId 12.5 is not a positive integer',
      file: CONFIG,
      line: 7,
      configPath: 'targets.fraction.portalId',
      fix: 'set portalId to the portal ID shown in HubSpot, a positive integer',
    },
    {
      code: 'E_PORTAL_ID',
      message: 'portalId -3 is not a positive integer',
      file: CONFIG,
      line: 8,
      configPath: 'targets.negative.portalId',
      fix: 'set portalId to the portal ID shown in HubSpot, a positive integer',
    },
  ])
})

test("E_TARGET_NAME: a target named 'config'", () => {
  expect(validate(configRule('E_TARGET_NAME')).issues).toEqual([
    {
      code: 'E_TARGET_NAME',
      message: "a target may not be named 'config': compare uses that word for the config side",
      file: CONFIG,
      line: 5,
      configPath: 'targets.config',
      fix: 'rename the target',
    },
  ])
})

test('E_UNKNOWN_OVERRIDE: an override key that is not an address in config', () => {
  expect(validate(configRule('E_UNKNOWN_OVERRIDE')).issues).toEqual([
    {
      code: 'E_UNKNOWN_OVERRIDE',
      message: "override 'property:deals/discount' is not an address in config",
      file: CONFIG,
      line: 9,
      configPath: 'targets.sandbox.overrides.property:deals/discount',
      fix: 'use an address that kalup ir lists, or remove the override',
    },
  ])
})

test('E_UNKNOWN_TARGET: the requested target is not declared', () => {
  expect(validate(configRule('base'), { target: 'staging' }).issues).toEqual([
    {
      code: 'E_UNKNOWN_TARGET',
      message: "target 'staging' is not declared",
      file: CONFIG,
      line: 4,
      configPath: 'targets',
      fix: 'use one of sandbox, or declare targets.staging',
    },
  ])
  const none = loadFiles({ [CONFIG]: "import { defineConfig } from 'kalup'\n\nexport default defineConfig({})\n" })
  expect(validate(none, { target: 'staging' }).issues).toEqual([
    {
      code: 'E_UNKNOWN_TARGET',
      message: "target 'staging' is not declared",
      file: CONFIG,
      configPath: 'targets',
      fix: 'declare targets.staging',
    },
  ])
})

test('warning: a managed property without the project prefix', () => {
  const loaded = loadFiles({ [CONFIG]: rule('W_PREFIX.config.ts'), [FILE]: rule('W_PREFIX.ts') })
  expect(validate(loaded)).toEqual({
    issues: [],
    warnings: [
      {
        code: 'W_PREFIX',
        message: "'term_days' does not carry the project prefix 'acme_'",
        file: FILE,
        line: 15,
        configPath: 'Deal.properties.termDays',
        fix: 'rename it to acme_term_days, or clear prefix in kalup.config.ts',
      },
    ],
  })
})

test('warning: a p.json definition whose fieldType is not textarea', () => {
  expect(validate(objectRule('W_JSON_FIELDTYPE'))).toEqual({
    issues: [],
    warnings: [
      {
        code: 'W_JSON_FIELDTYPE',
        message: "p.json 'deal_meta' has fieldType 'text'; JSON text belongs in a textarea",
        file: FILE,
        line: 9,
        configPath: 'Deal.properties.meta.fieldType',
        fix: "set fieldType: 'textarea'",
      },
    ],
  })
})

test('warning: an $unresolved marker anywhere in a definition', () => {
  const loaded = configRule('base')
  loaded.ir.resources['workflow:renewal_reminder'] = {
    type: 'workflow',
    managed: true,
    definition: {
      name: 'Renewal reminder',
      actions: [{ owner: { $unresolved: { kind: 'owner', id: '1234', from: 'sandbox' } } }],
    },
  }
  loaded.sources['workflow:renewal_reminder'] = {
    file: 'kalup/workflows/renewal.ts',
    line: 3,
    configPath: 'RenewalReminder',
  }
  expect(validate(loaded)).toEqual({
    issues: [],
    warnings: [
      {
        code: 'W_UNRESOLVED',
        message: 'workflow:renewal_reminder carries owner ID 1234 from target sandbox, which no address maps to',
        file: 'kalup/workflows/renewal.ts',
        line: 3,
        configPath: 'RenewalReminder',
        fix: 'run kalup bind workflow:renewal_reminder 1234 --target <target> to map it, or replace it with a $ref',
      },
    ],
  })
})
