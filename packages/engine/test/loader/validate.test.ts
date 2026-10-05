import { expect, test } from 'vitest'
import type { Issue } from '../../src/ir/types.js'
import { validateIR } from '../../src/ir/validate.js'
import { LEGACY_DIR, layout } from '../../src/loader/layout.js'
import { type Loaded, loadFiles } from '../../src/loader/load.js'
import { FIELD_TYPES, HUBSPOT_TYPES } from '../../src/loader/tables.js'
import { validate } from '../../src/loader/validate.js'
import { prose } from '../support/prose.js'
import { fixtureText, project } from './fixture.js'

const FILE = 'hubspot/objects/deals.ts'
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
      message: expect.any(String),
      file: FILE,
      line: 13,
      configPath: 'DealExtra.properties.amount',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(objectRule('E_KEY_COLLISION')).issues)).toMatchInlineSnapshot(`
    [
      "key 'amount' is used by two properties of deals: property:deals/amount and property:deals/amount_in_home_currency (fix: rename one of the two keys)",
    ]
  `)
})

test('E_TYPE_FIELDTYPE: a fieldType the builder does not allow, with the table as data', () => {
  expect(validate(objectRule('E_TYPE_FIELDTYPE')).issues).toEqual([
    {
      code: 'E_TYPE_FIELDTYPE',
      message: expect.any(String),
      file: FILE,
      line: 8,
      configPath: 'Deal.properties.paymentTerms.fieldType',
      fix: expect.any(String),
    },
    {
      code: 'E_TYPE_FIELDTYPE',
      message: expect.any(String),
      file: FILE,
      line: 14,
      configPath: 'Deal.properties.termDays.fieldType',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(objectRule('E_TYPE_FIELDTYPE')).issues)).toMatchInlineSnapshot(`
    [
      "fieldType 'checkbox' is not allowed for p.enum (type enumeration) (fix: use one of 'select', 'radio', 'booleancheckbox', 'calculation_equation')",
      "fieldType 'text' is not allowed for p.number (type number) (fix: use one of 'number', 'calculation_equation')",
    ]
  `)
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
    phoneNumber: 'phone_number',
    owner: 'enumeration',
  })
  expect(FIELD_TYPES.owner).toEqual(['select', 'radio'])
  expect(FIELD_TYPES.string).toContain('html')
})

test('E_DEFINITION_FIELD: a display field of another builder, a formula without a calculation, a currency name without the symbol or empty, an order below -1, owner options', () => {
  const { issues } = validate(objectRule('E_DEFINITION_FIELD'))
  expect(issues.map((i) => [i.code, i.configPath])).toEqual([
    ['E_DEFINITION_FIELD', 'Deal.properties.dealOwner.options'],
    ['E_DEFINITION_FIELD', 'Deal.properties.discount.calculationFormula'],
    ['E_DEFINITION_FIELD', 'Deal.properties.discount.currencyPropertyName'],
    ['E_DEFINITION_FIELD', 'Deal.properties.discount.displayOrder'],
    ['E_DEFINITION_FIELD', 'Deal.properties.fee.currencyPropertyName'],
    ['E_DEFINITION_FIELD', 'Deal.properties.termNote.numberDisplayHint'],
  ])
  expect(prose(issues)).toMatchInlineSnapshot(`
    [
      "p.owner takes no options: HubSpot fills them with the account's users (fix: remove options)",
      "calculationFormula needs fieldType 'calculation_equation': HubSpot turns the property into a calculation (fix: set fieldType: 'calculation_equation', or remove calculationFormula)",
      "HubSpot takes currencyPropertyName only with showCurrencySymbol: true (fix: add showCurrencySymbol: true, or remove currencyPropertyName)",
      "displayOrder -2 is not an integer from -1 up (fix: use 0 or more for a place in the group, or -1 to come after every numbered property)",
      "currencyPropertyName '' is not nothing: HubSpot stores it and then never turns showCurrencySymbol off (fix: remove currencyPropertyName, or name a currency property)",
      "numberDisplayHint is for p.number, not p.string (fix: remove numberDisplayHint)",
    ]
  `)
})

test('E_LIFECYCLE: removedOptions still in options, ignoreChanges naming no definition field', () => {
  expect(validate(objectRule('E_LIFECYCLE')).issues).toEqual([
    {
      code: 'E_LIFECYCLE',
      message: expect.any(String),
      file: FILE,
      line: 8,
      configPath: 'Deal.properties.paymentTerms.lifecycle.removedOptions',
      fix: expect.any(String),
    },
    {
      code: 'E_LIFECYCLE',
      message: expect.any(String),
      file: FILE,
      line: 8,
      configPath: 'Deal.properties.paymentTerms.lifecycle.ignoreChanges',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(objectRule('E_LIFECYCLE')).issues)).toMatchInlineSnapshot(`
    [
      "removedOptions names 'net60', which is still in options (fix: remove it from options or from removedOptions)",
      "ignoreChanges names 'lable', which is not a definition field (fix: use one of label, group, fieldType, description, options, hasUniqueValue, formField, hidden, displayOrder, numberDisplayHint, showCurrencySymbol, currencyPropertyName, textDisplayHint, calculationFormula, dataSensitivity)",
    ]
  `)
})

test('E_DUPLICATE_OPTION: a value listed twice, in a definition and in an options-only reference', () => {
  expect(validate(objectRule('E_DUPLICATE_OPTION')).issues).toEqual([
    {
      code: 'E_DUPLICATE_OPTION',
      message: expect.any(String),
      file: FILE,
      line: 18,
      configPath: 'Deal.properties.kind.options[2]',
      fix: expect.any(String),
    },
    {
      code: 'E_DUPLICATE_OPTION',
      message: expect.any(String),
      file: FILE,
      line: 8,
      configPath: 'Deal.properties.paymentTerms.options[2]',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(objectRule('E_DUPLICATE_OPTION')).issues)).toMatchInlineSnapshot(`
    [
      "option value '__proto__' is listed twice (fix: remove one of the two options)",
      "option value 'net30' is listed twice (fix: remove one of the two options)",
    ]
  `)
})

test('E_DUPLICATE_ALIAS: two options share as ?? value; swapped aliases are fine', () => {
  expect(validate(objectRule('E_DUPLICATE_ALIAS')).issues).toEqual([
    {
      code: 'E_DUPLICATE_ALIAS',
      message: expect.any(String),
      file: FILE,
      line: 19,
      configPath: 'Deal.properties.kind.options[2]',
      fix: expect.any(String),
    },
    {
      code: 'E_DUPLICATE_ALIAS',
      message: expect.any(String),
      file: FILE,
      line: 8,
      configPath: 'Deal.properties.paymentTerms.options[1]',
      fix: expect.any(String),
    },
    {
      code: 'E_DUPLICATE_ALIAS',
      message: expect.any(String),
      file: FILE,
      line: 8,
      configPath: 'Deal.properties.paymentTerms.options[3]',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(objectRule('E_DUPLICATE_ALIAS')).issues)).toMatchInlineSnapshot(`
    [
      "options 'constructor' and '__proto__' share the alias 'toString' (fix: give one of them another as; an option without as uses its value as the alias)",
      "options 'net30' and 'net60' share the alias 'net' (fix: give one of them another as; an option without as uses its value as the alias)",
      "options 'upfront' and 'cod' share the alias 'cod' (fix: give one of them another as; an option without as uses its value as the alias)",
    ]
  `)
})

test('E_UNKNOWN_GROUP: a group that is not in the groups block', () => {
  expect(validate(objectRule('E_UNKNOWN_GROUP')).issues).toEqual([
    {
      code: 'E_UNKNOWN_GROUP',
      message: expect.any(String),
      file: FILE,
      line: 5,
      configPath: 'Deal.properties.termDays.group',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(objectRule('E_UNKNOWN_GROUP')).issues)).toMatchInlineSnapshot(`
    [
      "group 'deal_terms' is not in the groups of deals (fix: add deal_terms: { label: '...' } to the groups block)",
    ]
  `)
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

test('E_HS_PREFIX: a managed property named hs_* or a<digits>_*; a reference may carry either prefix', () => {
  expect(validate(objectRule('E_HS_PREFIX')).issues).toEqual([
    {
      code: 'E_HS_PREFIX',
      message: expect.any(String),
      file: FILE,
      line: 17,
      configPath: 'Deal.properties.appRank',
      fix: expect.any(String),
    },
    {
      code: 'E_HS_PREFIX',
      message: expect.any(String),
      file: FILE,
      line: 10,
      configPath: 'Deal.properties.forecast',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(objectRule('E_HS_PREFIX')).issues)).toMatchInlineSnapshot(`
    [
      "'a12345_rank' starts with a12345_, a prefix HubSpot reserves (hs_ for its own properties, a<digits>_ for an integration's) (fix: rename the property, or drop label, group and fieldType to reference it)",
      "'hs_forecast_amount' starts with hs_, a prefix HubSpot reserves (hs_ for its own properties, a<digits>_ for an integration's) (fix: rename the property, or drop label, group and fieldType to reference it)",
    ]
  `)
})

test('E_STRICT_WITHOUT_OPTIONS: .strict() on a bare reference or a definition without options', () => {
  const loaded = objectRule('E_STRICT_WITHOUT_OPTIONS')
  expect(loaded.ir.resources['property:deals/payment_terms']).toHaveProperty('binding', {
    key: 'paymentTerms',
    codec: 'enum',
    strict: true,
  })
  const { issues } = validate(loaded)
  expect(issues.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_STRICT_WITHOUT_OPTIONS', 10, 'Deal.properties.stage'],
    ['E_STRICT_WITHOUT_OPTIONS', 11, 'Deal.properties.termKinds'],
  ])
  expect(prose(issues)).toMatchInlineSnapshot(`
    [
      ".strict() on 'dealstage', which lists no options, so its codec would throw on every value (fix: list the options, or drop .strict())",
      ".strict() on 'term_kinds', which lists no options, so its codec would throw on every value (fix: list the options, or drop .strict())",
    ]
  `)
})

test('E_PORTAL_ID: zero, fractional and negative, one located issue each and nothing from the schema', () => {
  expect(validate(configRule('E_PORTAL_ID')).issues).toEqual([
    {
      code: 'E_PORTAL_ID',
      message: expect.any(String),
      file: CONFIG,
      line: 6,
      configPath: 'targets.zero.portalId',
      fix: expect.any(String),
    },
    {
      code: 'E_PORTAL_ID',
      message: expect.any(String),
      file: CONFIG,
      line: 7,
      configPath: 'targets.fraction.portalId',
      fix: expect.any(String),
    },
    {
      code: 'E_PORTAL_ID',
      message: expect.any(String),
      file: CONFIG,
      line: 8,
      configPath: 'targets.negative.portalId',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(configRule('E_PORTAL_ID')).issues)).toMatchInlineSnapshot(`
    [
      "portalId 0 is not a positive integer (fix: set portalId to the portal ID shown in HubSpot, a positive integer)",
      "portalId 12.5 is not a positive integer (fix: set portalId to the portal ID shown in HubSpot, a positive integer)",
      "portalId -3 is not a positive integer (fix: set portalId to the portal ID shown in HubSpot, a positive integer)",
    ]
  `)
})

test("E_TARGET_NAME: a target named 'config'", () => {
  expect(validate(configRule('E_TARGET_NAME')).issues).toEqual([
    {
      code: 'E_TARGET_NAME',
      message: expect.any(String),
      file: CONFIG,
      line: 5,
      configPath: 'targets.config',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(configRule('E_TARGET_NAME')).issues)).toMatchInlineSnapshot(`
    [
      "a target may not be named 'config': compare uses that word for the config side (fix: rename the target)",
    ]
  `)
})

test('E_DUPLICATE_PORTAL: every later target that pins a portal an earlier one pins, at its portalId', () => {
  expect(validate(configRule('E_DUPLICATE_PORTAL')).issues).toEqual([
    {
      code: 'E_DUPLICATE_PORTAL',
      message: expect.any(String),
      file: CONFIG,
      line: 7,
      configPath: 'targets.qa.portalId',
      fix: expect.any(String),
    },
    {
      code: 'E_DUPLICATE_PORTAL',
      message: expect.any(String),
      file: CONFIG,
      line: 8,
      configPath: 'targets.review.portalId',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(configRule('E_DUPLICATE_PORTAL')).issues)).toMatchInlineSnapshot(`
    [
      "target 'qa' pins portal 4141414, which target 'sandbox' pins too (fix: each portal has one target; remove or rename one of sandbox, qa)",
      "target 'review' pins portal 4141414, which target 'sandbox' pins too (fix: each portal has one target; remove or rename one of sandbox, review)",
    ]
  `)
})

test('an invalid portalId is E_PORTAL_ID only, never also a duplicate', () => {
  const config = rule('E_PORTAL_ID.config.ts').replace('negative: { portalId: -3 }', 'negative: { portalId: 0 }')
  const found = validate(loadFiles({ [CONFIG]: config, [FILE]: rule('base.ts') })).issues
  expect(found.map((i) => i.code)).toEqual(['E_PORTAL_ID', 'E_PORTAL_ID', 'E_PORTAL_ID'])
})

test('W_PENDING_TARGET: a target with no portalId is a warning at its line, pins nothing and stays out of the IR', () => {
  const loaded = configRule('E_PORTAL_ID')
  const { warnings } = validate(loaded)
  expect(warnings.filter((w) => w.code === 'W_PENDING_TARGET')).toEqual([
    {
      code: 'W_PENDING_TARGET',
      message: "target 'missing' has no portalId yet, so no command reads or writes its portal",
      file: CONFIG,
      line: 5,
      configPath: 'targets.missing',
      fix: 'set targets.missing.portalId to the Hub ID from the HubSpot account menu',
    },
  ])
  expect(Object.keys(loaded.ir.targets)).not.toContain('missing')
  // The other targets of this fixture are invalid on purpose; the pending one adds nothing the schema rejects.
  expect(validateIR(loaded.ir).filter((issue) => issue.configPath?.startsWith('targets.missing'))).toEqual([])
})

const REMOVED = 'hubspot/removed.ts'

function withRemoved(entries: string[]): Loaded {
  const removed = `import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n${entries.join('\n')}\n})\n`
  return loadFiles({ [CONFIG]: rule('base.config.ts'), [FILE]: rule('base.ts'), [REMOVED]: removed })
}

test('tombstones for properties and groups config no longer names validate clean', () => {
  const loaded = withRemoved([
    "  'property:deals/old_score': { action: 'destroy', reason: 'Replaced by term_days' },",
    "  'group:deals/old_terms': { action: 'release' },",
  ])
  expect(validate(loaded)).toEqual({ issues: [], warnings: [] })
})

test('E_TOMBSTONE_ADDRESS, in key order: a key that is not an address, or names a type this version does not remove', () => {
  const loaded = withRemoved([
    "  oldScore: { action: 'destroy' },",
    "  'object:parcels': { action: 'release' },",
    "  'Property:deals/old_score': { action: 'release' },",
  ])
  expect(validate(loaded).issues).toEqual([
    {
      code: 'E_TOMBSTONE_ADDRESS',
      message: expect.any(String),
      file: REMOVED,
      line: 6,
      configPath: 'Property:deals/old_score',
      fix: expect.any(String),
    },
    {
      code: 'E_TOMBSTONE_ADDRESS',
      message: expect.any(String),
      file: REMOVED,
      line: 5,
      configPath: 'object:parcels',
      fix: expect.any(String),
    },
    {
      code: 'E_TOMBSTONE_ADDRESS',
      message: expect.any(String),
      file: REMOVED,
      line: 4,
      configPath: 'oldScore',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(loaded).issues)).toMatchInlineSnapshot(`
    [
      "'Property:deals/old_score' is not an address (fix: write the address of a property, group, pipeline or stage, such as 'property:companies/legacy_score')",
      "cannot remove object:parcels: this version removes properties, groups, pipelines and stages only (fix: remove object:parcels from hubspot/removed.ts)",
      "'oldScore' is not an address (fix: write the address of a property, group, pipeline or stage, such as 'property:companies/legacy_score')",
    ]
  `)
})

test('E_TOMBSTONE_ADDRESS: a property or group address must name its object and nothing after the name', () => {
  const loaded = withRemoved([
    "  'property:old_score': { action: 'destroy' },",
    "  'group:deals/old_terms/extra': { action: 'release' },",
  ])
  expect(validate(loaded).issues).toEqual([
    {
      code: 'E_TOMBSTONE_ADDRESS',
      message: expect.any(String),
      file: REMOVED,
      line: 5,
      configPath: 'group:deals/old_terms/extra',
      fix: expect.any(String),
    },
    {
      code: 'E_TOMBSTONE_ADDRESS',
      message: expect.any(String),
      file: REMOVED,
      line: 4,
      configPath: 'property:old_score',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(loaded).issues)).toMatchInlineSnapshot(`
    [
      "'group:deals/old_terms/extra' is not of the form group:<object>/<name> (fix: write the address of a property, group, pipeline or stage, such as 'property:companies/legacy_score')",
      "'property:old_score' is not of the form property:<object>/<name> (fix: write the address of a property, group, pipeline or stage, such as 'property:companies/legacy_score')",
    ]
  `)
})

test("E_TOMBSTONE_ADDRESS: a '__proto__' key is an ordinary key, reported, not dropped", () => {
  const loaded = withRemoved([
    "  '__proto__': { action: 'destroy' },",
    "  'property:deals/old_score': { action: 'release' },",
  ])
  expect(Object.keys(loaded.ir.tombstones)).toEqual(['__proto__', 'property:deals/old_score'])
  expect(validate(loaded).issues).toEqual([
    {
      code: 'E_TOMBSTONE_ADDRESS',
      message: expect.any(String),
      file: REMOVED,
      line: 4,
      configPath: '__proto__',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(loaded).issues)).toMatchInlineSnapshot(`
    [
      "'__proto__' is not an address (fix: write the address of a property, group, pipeline or stage, such as 'property:companies/legacy_score')",
    ]
  `)
})

test('E_TOMBSTONE_CONFLICT, in key order: a tombstoned address that config still defines, a reference included', () => {
  const loaded = withRemoved([
    "  'property:deals/term_days': { action: 'destroy' },",
    "  'property:deals/amount': { action: 'release' },",
    "  'group:deals/deal_terms': { action: 'release' },",
  ])
  expect(validate(loaded).issues).toEqual([
    {
      code: 'E_TOMBSTONE_CONFLICT',
      message: expect.any(String),
      file: REMOVED,
      line: 6,
      configPath: 'group:deals/deal_terms',
      fix: expect.any(String),
    },
    {
      code: 'E_TOMBSTONE_CONFLICT',
      message: expect.any(String),
      file: REMOVED,
      line: 5,
      configPath: 'property:deals/amount',
      fix: expect.any(String),
    },
    {
      code: 'E_TOMBSTONE_CONFLICT',
      message: expect.any(String),
      file: REMOVED,
      line: 4,
      configPath: 'property:deals/term_days',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(loaded).issues)).toMatchInlineSnapshot(`
    [
      "group:deals/deal_terms is in hubspot/removed.ts and in config (fix: remove it from config, or run kalup rm, which does both)",
      "property:deals/amount is in hubspot/removed.ts and in config (fix: remove it from config, or run kalup rm, which does both)",
      "property:deals/term_days is in hubspot/removed.ts and in config (fix: remove it from config, or run kalup rm, which does both)",
    ]
  `)
})

test('E_UNKNOWN_OVERRIDE: an override key that is not an address in config', () => {
  expect(validate(configRule('E_UNKNOWN_OVERRIDE')).issues).toEqual([
    {
      code: 'E_UNKNOWN_OVERRIDE',
      message: expect.any(String),
      file: CONFIG,
      line: 9,
      configPath: 'targets.sandbox.overrides.property:deals/discount',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(configRule('E_UNKNOWN_OVERRIDE')).issues)).toMatchInlineSnapshot(`
    [
      "override 'property:deals/discount' is not an address in config (fix: use an address that kalup ir lists, or remove the override)",
    ]
  `)
})

test('E_UNKNOWN_OVERRIDE: an override key named like an Object.prototype member is no address either', () => {
  const config = `import { defineConfig } from '@kalup/core'

export default defineConfig({
  targets: {
    sandbox: {
      portalId: 4141414,
      overrides: {
        toString: { skip: true },
        constructor: { name: 'amount' },
        valueOf: { skip: true },
      },
    },
  },
})
`
  const loaded = loadFiles({ [CONFIG]: config, [FILE]: rule('base.ts') })
  expect(validate(loaded).issues.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_UNKNOWN_OVERRIDE', 8, 'targets.sandbox.overrides.toString'],
    ['E_UNKNOWN_OVERRIDE', 9, 'targets.sandbox.overrides.constructor'],
    ['E_UNKNOWN_OVERRIDE', 10, 'targets.sandbox.overrides.valueOf'],
  ])
})

test("E_OVERRIDE_NAME: a name override that is another address's local name, when that one has no override", () => {
  // production swaps the two names, each with its own override; staging names the address's own name.
  expect(validate(configRule('E_OVERRIDE_NAME')).issues).toEqual([
    {
      code: 'E_OVERRIDE_NAME',
      message: expect.any(String),
      file: CONFIG,
      line: 8,
      configPath: 'targets.sandbox.overrides.property:deals/term_days.name',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(configRule('E_OVERRIDE_NAME')).issues)).toMatchInlineSnapshot(`
    [
      "the name override for property:deals/term_days on target sandbox is 'amount', the name of property:deals/amount, which has no name override there (fix: give property:deals/amount its own name override on sandbox, or rename one of the two in config)",
    ]
  `)
})

test('E_OVERRIDE_NAME: groups and custom objects follow the same rule', () => {
  const config = `import { defineConfig } from '@kalup/core'

export default defineConfig({
  targets: {
    sandbox: {
      portalId: 4141414,
      overrides: {
        'group:harvest/harvest_details': { name: 'harvest_notes' },
        'object:harvest': { name: 'press_run' },
      },
    },
  },
})
`
  const objects = `import { defineCustomObject } from '@kalup/core'

export const Harvest = defineCustomObject('harvest', {
  labels: { singular: 'Harvest', plural: 'Harvests' },
  primaryDisplayProperty: 'hs_object_id',
  groups: {
    harvest_details: { label: 'Harvest details' },
    harvest_notes: { label: 'Harvest notes' },
  },
})

export const PressRun = defineCustomObject('press_run', {
  labels: { singular: 'Press run', plural: 'Press runs' },
  primaryDisplayProperty: 'hs_object_id',
})
`
  const loaded = loadFiles({ [CONFIG]: config, 'hubspot/objects/harvest.ts': objects })
  expect(validate(loaded).issues.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_OVERRIDE_NAME', 8, 'targets.sandbox.overrides.group:harvest/harvest_details.name'],
    ['E_OVERRIDE_NAME', 9, 'targets.sandbox.overrides.object:harvest.name'],
  ])
})

function withOverrides(overrides: string): Loaded {
  const config = `import { defineConfig } from '@kalup/core'

export default defineConfig({
  targets: {
    sandbox: {
      portalId: 4141414,
      overrides: {
${overrides}
      },
    },
  },
})
`
  return loadFiles({ [CONFIG]: config, [FILE]: rule('base.ts') })
}

test('E_OVERRIDE_NAME: two name overrides that read one portal name, whichever comes first in config', () => {
  const both = [
    "        'property:deals/amount': { name: 'deal_value' },",
    "        'property:deals/term_days': { name: 'deal_value' },",
  ]
  expect(validate(withOverrides(both.join('\n'))).issues).toEqual([
    {
      code: 'E_OVERRIDE_NAME',
      message: expect.any(String),
      file: CONFIG,
      line: 9,
      configPath: 'targets.sandbox.overrides.property:deals/term_days.name',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(withOverrides(both.join('\n'))).issues)).toMatchInlineSnapshot(`
    [
      "the name override for property:deals/term_days on target sandbox is 'deal_value', which the name override for property:deals/amount names too (fix: give each of the two its own portal name on sandbox, or remove one of the two overrides)",
    ]
  `)
  const swapped = validate(withOverrides([...both].reverse().join('\n'))).issues
  expect(swapped.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_OVERRIDE_NAME', 9, 'targets.sandbox.overrides.property:deals/amount.name'],
  ])
})

test("E_OVERRIDE_NAME: a name override to another address's own name, when that one overrides to it as well", () => {
  const overrides = [
    "        'property:deals/term_days': { name: 'amount' },",
    "        'property:deals/amount': { name: 'amount' },",
  ]
  expect(validate(withOverrides(overrides.join('\n'))).issues.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_OVERRIDE_NAME', 9, 'targets.sandbox.overrides.property:deals/amount.name'],
  ])
  // A skip wins over a name, so a skipped address reads nothing.
  const skipped = ["        'property:deals/term_days': { name: 'deal_value', skip: true },", overrides[1]]
  expect(validate(withOverrides(skipped.join('\n'))).issues).toEqual([])
})

test('E_OVERRIDE_NAME: two group or custom object name overrides that read one portal name', () => {
  const config = `import { defineConfig } from '@kalup/core'

export default defineConfig({
  targets: {
    sandbox: {
      portalId: 4141414,
      overrides: {
        'group:harvest/harvest_details': { name: 'harvest_info' },
        'group:harvest/harvest_notes': { name: 'harvest_info' },
        'object:harvest': { name: 'harvest_v2' },
        'object:press_run': { name: 'harvest_v2' },
      },
    },
  },
})
`
  const objects = `import { defineCustomObject } from '@kalup/core'

export const Harvest = defineCustomObject('harvest', {
  labels: { singular: 'Harvest', plural: 'Harvests' },
  primaryDisplayProperty: 'hs_object_id',
  groups: {
    harvest_details: { label: 'Harvest details' },
    harvest_notes: { label: 'Harvest notes' },
  },
})

export const PressRun = defineCustomObject('press_run', {
  labels: { singular: 'Press run', plural: 'Press runs' },
  primaryDisplayProperty: 'hs_object_id',
})
`
  const loaded = loadFiles({ [CONFIG]: config, 'hubspot/objects/harvest.ts': objects })
  expect(validate(loaded).issues.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_OVERRIDE_NAME', 9, 'targets.sandbox.overrides.group:harvest/harvest_notes.name'],
    ['E_OVERRIDE_NAME', 11, 'targets.sandbox.overrides.object:press_run.name'],
  ])
})

test('E_UNKNOWN_TARGET: the requested target is not declared', () => {
  expect(validate(configRule('base'), { target: 'staging' }).issues).toEqual([
    {
      code: 'E_UNKNOWN_TARGET',
      message: expect.any(String),
      file: CONFIG,
      line: 4,
      configPath: 'targets',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(configRule('base'), { target: 'staging' }).issues)).toMatchInlineSnapshot(`
    [
      "target 'staging' is not declared (fix: use one of sandbox, or declare targets.staging)",
    ]
  `)
  const none = loadFiles({
    [CONFIG]: "import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({})\n",
  })
  expect(validate(none, { target: 'staging' }).issues).toEqual([
    {
      code: 'E_UNKNOWN_TARGET',
      message: expect.any(String),
      file: CONFIG,
      configPath: 'targets',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(none, { target: 'staging' }).issues)).toMatchInlineSnapshot(`
    [
      "target 'staging' is not declared (fix: declare targets.staging)",
    ]
  `)
})

test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
  'E_UNKNOWN_TARGET: %s, a name every object inherits, is not a declared target',
  (name) => {
    expect(validate(configRule('base'), { target: name }).issues.map((issue) => issue.code)).toEqual([
      'E_UNKNOWN_TARGET',
    ])
  },
)

// The base config with defaultTarget on line 4, before its targets.
function withDefault(defaultTarget: string, targets = '    sandbox: { portalId: 4141414 },'): Loaded {
  const config = `import { defineConfig } from '@kalup/core'

export default defineConfig({
  defaultTarget: '${defaultTarget}',
  targets: {
${targets}
  },
})
`
  return loadFiles({ [CONFIG]: config, [FILE]: rule('base.ts') })
}

test('defaultTarget naming a declared target validates clean, stays in the config and out of the IR', () => {
  const loaded = withDefault('sandbox')
  expect(validate(loaded)).toEqual({ issues: [], warnings: [] })
  expect(loaded.config.defaultTarget).toBe('sandbox')
  expect(loaded.ir).not.toHaveProperty('defaultTarget')
  expect(JSON.stringify(loaded.ir)).not.toContain('defaultTarget')
  // The IR is the same with or without it, so it never changes an IR hash.
  expect(loaded.ir).toEqual(configRule('base').ir)
})

test('E_DEFAULT_TARGET: defaultTarget names no declared target', () => {
  expect(validate(withDefault('staging')).issues).toEqual([
    {
      code: 'E_DEFAULT_TARGET',
      message: expect.any(String),
      file: CONFIG,
      line: 4,
      configPath: 'defaultTarget',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(withDefault('staging')).issues)).toMatchInlineSnapshot(`
    [
      "defaultTarget 'staging' is not a declared target (fix: use one of sandbox, or remove defaultTarget)",
    ]
  `)
  const none = loadFiles({
    [CONFIG]:
      "import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({ defaultTarget: 'sandbox' })\n",
  })
  expect(validate(none).issues).toEqual([
    {
      code: 'E_DEFAULT_TARGET',
      message: expect.any(String),
      file: CONFIG,
      line: 3,
      configPath: 'defaultTarget',
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(none).issues)).toMatchInlineSnapshot(`
    [
      "defaultTarget 'sandbox' is not a declared target (fix: declare a target under targets, or remove defaultTarget)",
    ]
  `)
})

test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
  'E_DEFAULT_TARGET: %s, a name every object inherits, is not a declared target',
  (name) => {
    expect(validate(withDefault(name)).issues.map((issue) => issue.code)).toEqual(['E_DEFAULT_TARGET'])
  },
)

test('E_DEFAULT_TARGET follows the target issues and comes before the requested target', () => {
  const loaded = withDefault('staging', '    sandbox: { portalId: 0 },')
  expect(validate(loaded, { target: 'qa' }).issues.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_PORTAL_ID', 6, 'targets.sandbox.portalId'],
    ['E_DEFAULT_TARGET', 4, 'defaultTarget'],
    ['E_UNKNOWN_TARGET', 5, 'targets'],
  ])
})

test('property issues come first in address order, then target issues, then the requested target', () => {
  const config = `import { defineConfig } from '@kalup/core'

export default defineConfig({
  prefix: 'acme_',
  targets: {
    sandbox: {
      portalId: 4141414,
      overrides: {
        'property:deals/discount': { skip: true },
      },
    },
  },
})
`
  const objects = `import { defineObject, p } from '@kalup/core'

export const DealExtra = defineObject('deals', {
  properties: {
    terms: p.number('term_months', { label: 'Term months', group: 'acme_terms', fieldType: 'number' }),
  },
})

export const Deal = defineObject('deals', {
  groups: {
    acme_terms: { label: 'Terms' },
  },
  properties: {
    terms: p.number('term_days', { label: 'Term days', group: 'acme_terms', fieldType: 'text' }),
  },
})
`
  const { issues, warnings } = validate(loadFiles({ [CONFIG]: config, [FILE]: objects }), { target: 'staging' })
  expect(issues.map((i) => [i.code, i.file, i.line, i.configPath])).toEqual([
    ['E_TYPE_FIELDTYPE', FILE, 14, 'Deal.properties.terms.fieldType'],
    ['E_KEY_COLLISION', FILE, 5, 'DealExtra.properties.terms'],
    ['E_UNKNOWN_OVERRIDE', CONFIG, 9, 'targets.sandbox.overrides.property:deals/discount'],
    ['E_UNKNOWN_TARGET', CONFIG, 5, 'targets'],
  ])
  expect(warnings.map((w) => [w.code, w.line, w.configPath])).toEqual([
    ['W_PREFIX', 14, 'Deal.properties.terms'],
    ['W_PREFIX', 5, 'DealExtra.properties.terms'],
  ])
})

test('warning: a managed property without the project prefix', () => {
  const loaded = loadFiles({ [CONFIG]: rule('W_PREFIX.config.ts'), [FILE]: rule('W_PREFIX.ts') })
  expect(validate(loaded)).toEqual({
    issues: [],
    warnings: [
      {
        code: 'W_PREFIX',
        message: expect.any(String),
        file: FILE,
        line: 15,
        configPath: 'Deal.properties.termDays',
        fix: expect.any(String),
      },
    ],
  })
  expect(prose(validate(loaded))).toMatchInlineSnapshot(`
    [
      "'term_days' does not carry the project prefix 'acme_' (fix: rename it to acme_term_days, or clear prefix in kalup.config.ts)",
    ]
  `)
})

test('warning: a p.json definition whose fieldType is not textarea', () => {
  expect(validate(objectRule('W_JSON_FIELDTYPE'))).toEqual({
    issues: [],
    warnings: [
      {
        code: 'W_JSON_FIELDTYPE',
        message: expect.any(String),
        file: FILE,
        line: 9,
        configPath: 'Deal.properties.meta.fieldType',
        fix: expect.any(String),
      },
    ],
  })
  expect(prose(validate(objectRule('W_JSON_FIELDTYPE')))).toMatchInlineSnapshot(`
    [
      "p.json 'deal_meta' has fieldType 'text'; JSON text belongs in a textarea (fix: set fieldType: 'textarea')",
    ]
  `)
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
    file: 'hubspot/workflows/renewal.ts',
    line: 3,
    configPath: 'RenewalReminder',
  }
  expect(validate(loaded)).toEqual({
    issues: [],
    warnings: [
      {
        code: 'W_UNRESOLVED',
        message: expect.any(String),
        file: 'hubspot/workflows/renewal.ts',
        line: 3,
        configPath: 'RenewalReminder',
        fix: expect.any(String),
      },
    ],
  })
  expect(prose(validate(loaded))).toMatchInlineSnapshot(`
    [
      "workflow:renewal_reminder carries owner ID 1234 from target sandbox, which no address maps to (fix: run kalup bind workflow:renewal_reminder 1234 --target <target> to map it, or replace it with a $ref)",
    ]
  `)
})

// kalup.config.ts with these override entries for target eu, one per line from line 8, and target us with none.
function overrideRule(
  entries: string[],
  us = '    us: { portalId: 5151515 },',
  objects = rule('E_OVERRIDE_DEFINITION.ts'),
): Loaded {
  const config = `import { defineConfig } from '@kalup/core'

export default defineConfig({
  targets: {
    eu: {
      portalId: 4141414,
      overrides: {
${entries.map((entry) => `        ${entry}`).join('\n')}
      },
    },
${us}
  },
})
`
  return loadFiles({ [CONFIG]: config, [FILE]: objects })
}

const at = (line: number, configPath: string) => ({
  file: CONFIG,
  line,
  configPath: `targets.eu.overrides.${configPath}`,
})

test('definition overrides of every overridable field, explicit empty values included, validate clean', () => {
  const loaded = overrideRule([
    "'property:deals/term_days': { definition: { label: 'Days', description: '', group: 'deal_terms_eu', formField: false } },",
    "'property:deals/payment_terms': { definition: { fieldType: 'radio', options: [{ value: 'NET 60', label: 'Sixty', hidden: true }], lifecycle: { options: 'exact', removedOptions: ['net30'], ignoreChanges: ['label'] } } },",
    "'group:deals/deal_terms': { definition: { label: 'Terms' } },",
  ])
  expect(validate(loaded)).toEqual({ issues: [], warnings: [] })
})

test('E_OVERRIDE_DEFINITION: a field that cannot differ per target, at its own line and path', () => {
  const loaded = overrideRule([
    "'property:deals/term_days': { definition: { hasUniqueValue: true, lifecycle: { preventDestroy: true } } },",
    "'group:deals/deal_terms': { definition: { label: 'Terms', fieldType: 'text' } },",
  ])
  expect(validate(loaded).issues).toEqual([
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(8, 'property:deals/term_days.definition.hasUniqueValue'),
      fix: expect.any(String),
    },
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(8, 'property:deals/term_days.definition.lifecycle.preventDestroy'),
      fix: expect.any(String),
    },
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(9, 'group:deals/deal_terms.definition.fieldType'),
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(loaded).issues)).toMatchInlineSnapshot(`
    [
      "property:deals/term_days on target eu: hasUniqueValue is fixed when HubSpot creates the property, so it cannot differ per target (fix: remove hasUniqueValue from the override)",
      "property:deals/term_days on target eu: lifecycle.preventDestroy cannot differ per target (fix: remove preventDestroy from the override's lifecycle)",
      "group:deals/deal_terms on target eu: a group override may set label only, not fieldType (fix: remove fieldType from the override)",
    ]
  `)
})

test('E_OVERRIDE_DEFINITION: the new display fields may differ per target, sensitivity may not, and the effective rules hold', () => {
  const clean = overrideRule([
    "'property:deals/term_days': { definition: { hidden: true, displayOrder: 3, numberDisplayHint: 'duration', showCurrencySymbol: false, fieldType: 'calculation_equation', calculationFormula: 'amount / 30' } },",
  ])
  expect(validate(clean).issues).toEqual([])
  const broken = overrideRule([
    "'property:deals/term_days': { definition: { dataSensitivity: 'sensitive', textDisplayHint: 'email', calculationFormula: 'amount / 30' } },",
  ])
  expect(prose(validate(broken).issues)).toMatchInlineSnapshot(`
    [
      "property:deals/term_days on target eu: dataSensitivity is fixed when HubSpot creates the property, so it cannot differ per target (fix: remove dataSensitivity from the override)",
      "property:deals/term_days on target eu: textDisplayHint is for p.string, p.stringArray, p.json, p.phoneNumber, not p.number (fix: remove textDisplayHint)",
      "property:deals/term_days on target eu: calculationFormula needs fieldType 'calculation_equation': HubSpot turns the property into a calculation (fix: set fieldType: 'calculation_equation', or remove calculationFormula)",
    ]
  `)
})

test('E_OVERRIDE_DEFINITION: a reference, an options-only reference, a .managed(false) property and a custom object schema', () => {
  const loaded = overrideRule([
    "'property:deals/amount': { definition: { label: 'Amount' } },",
    "'property:deals/stage': { definition: { label: 'Stage' } },",
    "'property:deals/sealed': { definition: { label: 'Open' } },",
    "'object:crate': { definition: { label: 'Box' } },",
  ])
  expect(validate(loaded).issues).toEqual([
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(8, 'property:deals/amount.definition'),
      fix: expect.any(String),
    },
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(9, 'property:deals/stage.definition'),
      fix: expect.any(String),
    },
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(10, 'property:deals/sealed.definition'),
      fix: expect.any(String),
    },
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(11, 'object:crate.definition'),
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(loaded).issues)).toMatchInlineSnapshot(`
    [
      "property:deals/amount on target eu: it is a reference (its shared definition has no label, group and fieldType), so nothing on it can differ per target (fix: remove the definition override for property:deals/amount under targets.eu.overrides)",
      "property:deals/stage on target eu: it is a reference (its shared definition has no label, group and fieldType), so nothing on it can differ per target (fix: remove the definition override for property:deals/stage under targets.eu.overrides)",
      "property:deals/sealed on target eu: it is .managed(false), so no target owns its definition (fix: remove the definition override for property:deals/sealed under targets.eu.overrides)",
      "object:crate on target eu: a custom object schema cannot take a definition override in this release (fix: remove the definition override for object:crate under targets.eu.overrides)",
    ]
  `)
})

test('E_OVERRIDE_DEFINITION: the effective definition breaks a shared rule: fieldType, group, options, lifecycle', () => {
  const loaded = overrideRule([
    "'property:deals/term_days': { definition: { fieldType: 'text', group: 'deal_notes' } },",
    "'property:deals/payment_terms': { definition: { options: [{ value: 'net30', label: 'Net 30' }, { value: 'net30', label: 'Thirty' }], lifecycle: { removedOptions: ['net30'], ignoreChanges: ['colour'] } } },",
  ])
  expect(validate(loaded).issues).toEqual([
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(8, 'property:deals/term_days.definition.fieldType'),
      fix: expect.any(String),
    },
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(8, 'property:deals/term_days.definition.group'),
      fix: expect.any(String),
    },
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(9, 'property:deals/payment_terms.definition.options[1]'),
      fix: expect.any(String),
    },
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(9, 'property:deals/payment_terms.definition.lifecycle.removedOptions'),
      fix: expect.any(String),
    },
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(9, 'property:deals/payment_terms.definition.lifecycle.ignoreChanges'),
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(loaded).issues)).toMatchInlineSnapshot(`
    [
      "property:deals/term_days on target eu: fieldType 'text' is not allowed for p.number (type number) (fix: use one of 'number', 'calculation_equation')",
      "property:deals/term_days on target eu: group 'deal_notes' is not in the groups of deals (fix: add deal_notes: { label: '...' } to the groups block of deals)",
      "property:deals/payment_terms on target eu: option value 'net30' is listed twice (fix: remove one of the two options)",
      "property:deals/payment_terms on target eu: removedOptions names 'net30', which the target keeps in options (fix: remove it from options or from removedOptions)",
      "property:deals/payment_terms on target eu: ignoreChanges names 'colour', which is not a definition field (fix: use one of label, group, fieldType, description, options, hasUniqueValue, formField, hidden, displayOrder, numberDisplayHint, showCurrencySymbol, currencyPropertyName, textDisplayHint, calculationFormula, dataSensitivity)",
    ]
  `)
})

test('E_OVERRIDE_DEFINITION: a shared removedOptions that lists an option the override keeps', () => {
  const objects = rule('E_OVERRIDE_DEFINITION.ts').replace(
    "        { value: 'NET 60', label: 'Net 60', as: 'net60' },\n      ],",
    "        { value: 'NET 60', label: 'Net 60', as: 'net60' },\n      ],\n      lifecycle: { removedOptions: ['net90'] },",
  )
  const loaded = overrideRule(
    [
      "'property:deals/payment_terms': { definition: { options: [{ value: 'net30', label: 'Net 30' }, { value: 'net90', label: 'Net 90' }] } },",
    ],
    undefined,
    objects,
  )
  const { issues } = validate(loaded)
  expect(issues.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_OVERRIDE_DEFINITION', 8, 'targets.eu.overrides.property:deals/payment_terms.definition.options'],
  ])
  expect(issues[0]?.message).toContain("removedOptions names 'net90'")
})

test('E_OVERRIDE_DEFINITION: an override option carries as; aliases stay in the shared file', () => {
  const loaded = overrideRule([
    "'property:deals/payment_terms': { definition: { options: [{ value: 'net30', label: 'Net 30', as: 'thirty' }] } },",
  ])
  expect(validate(loaded).issues).toEqual([
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.any(String),
      ...at(8, 'property:deals/payment_terms.definition.options[0].as'),
      fix: expect.any(String),
    },
  ])
  expect(prose(validate(loaded).issues)).toMatchInlineSnapshot(`
    [
      "property:deals/payment_terms on target eu: option 'net30' carries as; aliases belong to the app and stay in the shared file (fix: remove as from the override option)",
    ]
  `)
})

test("W_OVERRIDE_OPTION: an override option a strict enum's shared options lack, which the app's codec throws on", () => {
  const net90 = [
    "'property:deals/payment_terms': { definition: { options: [{ value: 'net30', label: 'Net 30' }, { value: 'net90', label: 'Net 90' }] } },",
  ]
  // Lenient, the codec reads net90 as Unlisted: no warning.
  expect(validate(overrideRule(net90))).toEqual({ issues: [], warnings: [] })
  const strict = rule('E_OVERRIDE_DEFINITION.ts').replace(
    '      ],\n    }),\n    sealed',
    '      ],\n    }).strict(),\n    sealed',
  )
  const loaded = overrideRule(net90, undefined, strict)
  expect(validate(loaded)).toEqual({
    issues: [],
    warnings: [
      {
        code: 'W_OVERRIDE_OPTION',
        message: expect.any(String),
        ...at(8, 'property:deals/payment_terms.definition.options[1]'),
        fix: expect.any(String),
      },
    ],
  })
  expect(prose(validate(loaded))).toMatchInlineSnapshot(`
    [
      "property:deals/payment_terms on target eu: option 'net90' is not in the shared options, so the app's codec for paymentTerms throws on this value (fix: add it to the shared options if the app reads paymentTerms from target eu)",
    ]
  `)
})

test("every target's definition overrides are validated, whichever target a command asked for, a skipped one included", () => {
  const loaded = overrideRule(
    ["'property:deals/term_days': { skip: true, definition: { hasUniqueValue: true } },"],
    "    us: { portalId: 5151515, overrides: { 'property:deals/term_days': { definition: { fieldType: 'text' } } } },",
  )
  expect(validate(loaded, { target: 'eu' }).issues.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_OVERRIDE_DEFINITION', 8, 'targets.eu.overrides.property:deals/term_days.definition.hasUniqueValue'],
    ['E_OVERRIDE_DEFINITION', 11, 'targets.us.overrides.property:deals/term_days.definition.fieldType'],
  ])
})

// A config with these objects and the sandbox target's extra fields, over the base object file.
function settingsRule(objects: string, sandbox = ''): Loaded {
  const text = `import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({\n  objects: ${objects},\n  targets: {\n    sandbox: { portalId: 4141414,${sandbox} },\n  },\n})\n`
  return loadFiles({ [CONFIG]: text, [FILE]: rule('base.ts') })
}

test('E_SETTING_VALUE: a name include and exclude both list, and a target object objects does not declare', () => {
  const both = validate(settingsRule("{ deals: { include: ['amount', 'dealname'], exclude: ['deal*', 'amount'] } }"))
  expect(both.issues).toMatchObject([{ code: 'E_SETTING_VALUE', file: CONFIG, configPath: 'objects.deals.exclude' }])
  expect(prose(both.issues)).toMatchInlineSnapshot(`
    [
      "objects.deals lists 'amount' in both include and exclude (fix: remove each from one of the two lists)",
    ]
  `)
  const unknown = validate(settingsRule('{ deals: {} }', " objects: { tickets: { mode: 'addon' } },"))
  expect(unknown.issues).toMatchObject([{ code: 'E_SETTING_VALUE', configPath: 'targets.sandbox.objects.tickets' }])
  expect(prose(unknown.issues)).toMatchInlineSnapshot(`
    [
      "targets.sandbox.objects names tickets, which objects does not declare (fix: add tickets to objects, or remove it from targets.sandbox.objects)",
    ]
  `)
})

test("W_MODE_SHADOWED: a target's mode overrides an object's, unless the target states that object's mode too", () => {
  const shadowed = validate(settingsRule("{ deals: { mode: 'takeover' } }", " mode: 'addon',"))
  expect(shadowed.issues).toEqual([])
  expect(shadowed.warnings).toMatchObject([{ code: 'W_MODE_SHADOWED', configPath: 'targets.sandbox.mode' }])
  expect(prose(shadowed.warnings)).toMatchInlineSnapshot(`
    [
      "targets.sandbox.mode 'addon' overrides objects.deals.mode 'takeover' on target sandbox (fix: state it under targets.sandbox.objects.deals.mode, or remove one of the two)",
    ]
  `)
  const stated = " mode: 'addon', objects: { deals: { mode: 'addon' } },"
  expect(validate(settingsRule("{ deals: { mode: 'takeover' } }", stated))).toEqual({ issues: [], warnings: [] })
  expect(validate(settingsRule("{ deals: { mode: 'addon' } }", " mode: 'addon',"))).toEqual({
    issues: [],
    warnings: [],
  })
})

test('W_LEGACY_DIR once when the host fell back to a 0.1 kalup/ folder, with the one-line fix', () => {
  const legacy = layout(LEGACY_DIR, true)
  const loaded = loadFiles(
    { [CONFIG]: rule('base.config.ts'), 'kalup/objects/deals.ts': rule('base.ts') },
    { layout: legacy },
  )
  const { issues, warnings } = validate(loaded)
  expect(issues).toEqual([])
  expect(warnings).toEqual([
    { code: 'W_LEGACY_DIR', message: expect.any(String), file: CONFIG, fix: expect.any(String) },
  ])
  expect(prose(warnings)).toMatchInlineSnapshot(`
    [
      "the object files are in kalup/, the old default folder; the default is now hubspot/ (fix: add dir: 'kalup' to kalup.config.ts, or move kalup/ to hubspot/)",
    ]
  `)
  expect(validate(configRule('base')).warnings).toEqual([])
})

interface PipelineText {
  id: string
  label?: string
  name?: string
  order?: number
  stages: string[]
}

// One definePipeline export, each stage literal as given under the keys s0, s1, ...
function pipelineText(object: string, p: PipelineText): string {
  const stages = p.stages.map((s, i) => `    s${i}: ${s},`).join('\n')
  const name = p.name ?? `${p.id.replace(/[^A-Za-z]/g, '')}Pipeline`
  return [
    `export const ${name} = definePipeline('${object}', {`,
    `  id: '${p.id}',`,
    `  label: '${p.label ?? p.id}',`,
    `  displayOrder: ${p.order ?? 0},`,
    `  stages: {\n${stages}\n  },`,
    '})',
  ].join('\n')
}

// A project of base.config.ts and one pipeline file per object, its exports in order.
function pipelineFiles(entries: [string, PipelineText][], config = rule('base.config.ts')): Record<string, string> {
  const files: Record<string, string> = { [CONFIG]: config }
  for (const [object, p] of entries) {
    const file = `hubspot/pipelines/${object}.ts`
    files[file] = `${files[file] ?? "import { definePipeline } from '@kalup/core'\n"}\n${pipelineText(object, p)}\n`
  }
  return files
}

function pipelineIssues(entries: [string, PipelineText][]): Issue[] {
  return validate(loadFiles(pipelineFiles(entries))).issues
}

const DEAL_STAGE = "{ id: 'tasting', label: 'Tasting', probability: 0.2 }"

test('a deal, a ticket and a custom object pipeline validate clean', () => {
  const found = pipelineIssues([
    ['deals', { id: 'orchard_sales', stages: [DEAL_STAGE] }],
    ['tickets', { id: 'orchard_desk', stages: ["{ id: 'raised', label: 'Raised' }", "{ id: 'shut', label: 'Shut', ticketState: 'CLOSED' }"] }],
    ['harvest', { id: 'harvests', stages: ["{ id: 'picked', label: 'Picked', state: 'CLOSED' }"] }],
  ])
  expect(found).toEqual([])
})

test('E_PIPELINE_ID: a pipeline ID two objects share, a stage ID two pipelines of one object share, an ID too long', () => {
  const found = pipelineIssues([
    ['deals', { id: 'orchard', stages: [DEAL_STAGE] }],
    ['tickets', { id: 'orchard', stages: ["{ id: 'tasting', label: 'Tasting', ticketState: 'CLOSED' }"] }],
    ['deals', { id: 'cider', label: 'Cider', stages: [DEAL_STAGE] }],
    ['deals', { id: 'p'.repeat(37), name: 'LongPipeline', label: 'Long', stages: [`{ id: '${'s'.repeat(101)}', label: 'One', probability: 0.5 }`] }],
  ])
  // In address order: cider holds the stage ID first.
  expect(found.map((i) => [i.code, i.configPath])).toEqual([
    ['E_PIPELINE_ID', 'orchardPipeline.stages.s0.id'],
    ['E_PIPELINE_ID', 'LongPipeline.id'],
    ['E_PIPELINE_ID', 'LongPipeline.stages.s0.id'],
    ['E_PIPELINE_ID', 'orchardPipeline.id'],
  ])
  expect(prose(found).map((t) => t.replace(/p{37}/, '<37>').replace(/s{101}/, '<101>'))).toMatchInlineSnapshot(`
    [
      "stage:deals/orchard/tasting has the ID of stage:deals/cider/tasting, and HubSpot keeps stage IDs unique across an object's pipelines (fix: give one of the two another ID, such as the pipeline ID followed by the stage)",
      "the ID of pipeline:deals/<37> is longer than 36 characters, which HubSpot answers with an error and does not store (fix: use an ID of at most 36 characters)",
      "the ID of stage:deals/<37>/<101> is longer than 100 characters, which HubSpot answers with an error and does not store (fix: use an ID of at most 100 characters)",
      "pipeline:tickets/orchard has the ID of pipeline:deals/orchard, and HubSpot keeps pipeline IDs unique across objects (fix: give one of the two another ID)",
    ]
  `)
})

test('E_PIPELINE_STAGES: no stage, and a ticket pipeline with no closed stage', () => {
  const found = pipelineIssues([
    ['deals', { id: 'orchard', stages: [] }],
    ['tickets', { id: 'desk', stages: ["{ id: 'raised', label: 'Raised' }"] }],
  ])
  expect(found.map((i) => [i.code, i.configPath])).toEqual([
    ['E_PIPELINE_STAGES', 'orchardPipeline.stages'],
    ['E_PIPELINE_STAGES', 'deskPipeline.stages'],
  ])
  expect(prose(found)).toMatchInlineSnapshot(`
    [
      "pipeline:deals/orchard has no stage, and HubSpot needs one (fix: add a stage, or run kalup rm on the pipeline)",
      "pipeline:tickets/desk has no stage with ticketState 'CLOSED', and HubSpot needs one (fix: mark the stage tickets end in ticketState: 'CLOSED')",
    ]
  `)
})

test('E_DUPLICATE_LABEL: stage labels ignore case and spaces around them, pipeline labels ignore case', () => {
  const found = pipelineIssues([
    ['deals', { id: 'orchard', label: 'Orchard', stages: [DEAL_STAGE, "{ id: 'b', label: ' tasting ', probability: 0.3 }"] }],
    ['deals', { id: 'cider', label: 'ORCHARD', stages: ["{ id: 'c', label: 'C', probability: 0.5 }"] }],
  ])
  expect(found.map((i) => [i.code, i.configPath])).toEqual([
    ['E_DUPLICATE_LABEL', 'orchardPipeline.label'],
    ['E_DUPLICATE_LABEL', 'orchardPipeline.stages.s1.label'],
  ])
  expect(prose(found)).toMatchInlineSnapshot(`
    [
      "pipeline:deals/cider and pipeline:deals/orchard share the label 'Orchard', ignoring case (fix: give one of the two another label)",
      "stages stage:deals/orchard/tasting and stage:deals/orchard/b share the label 'tasting', ignoring case and spaces around it (fix: give one of the two another label)",
    ]
  `)
})

test('E_PIPELINE_FIELD: another object metadata field, a deal stage with no or a wrong probability, a negative displayOrder', () => {
  const found = pipelineIssues([
    ['deals', { id: 'orchard', order: -1, stages: ["{ id: 'a', label: 'A', ticketState: 'CLOSED' }", "{ id: 'b', label: 'B', probability: 1.5 }"] }],
    ['contacts', { id: 'lifecycle', stages: ["{ id: 'lead', label: 'Lead', state: 'OPEN' }"] }],
  ])
  expect(found.map((i) => [i.code, i.configPath])).toEqual([
    ['E_PIPELINE_FIELD', 'lifecyclePipeline.stages.s0.state'],
    ['E_PIPELINE_FIELD', 'orchardPipeline.displayOrder'],
    ['E_PIPELINE_FIELD', 'orchardPipeline.stages.s0.ticketState'],
    ['E_PIPELINE_FIELD', 'orchardPipeline.stages.s0'],
    ['E_PIPELINE_FIELD', 'orchardPipeline.stages.s1.probability'],
  ])
  expect(prose(found)).toMatchInlineSnapshot(`
    [
      "state is for custom object stages; a stage of contacts takes none: Kalup reads and compares its pipelines and does not write them (fix: remove state)",
      "displayOrder -1 of pipeline:deals/orchard is not an integer from 0 up (fix: use 0 or more: HubSpot lists pipelines lowest first)",
      "ticketState is for ticket stages; a stage of deals takes probability (fix: replace ticketState with probability)",
      "a deal stage needs a probability, and HubSpot refuses one without (fix: add probability, from 0 to 1: 0 and 1 make the stage closed)",
      "probability 1.5 is not from 0 to 1 (fix: use a number from 0 to 1)",
    ]
  `)
})

test('tombstones may name pipelines and stages; a stage override takes its own metadata field only', () => {
  const config = rule('base.config.ts').replace(
    '{ portalId: 4141414 }',
    `{
      portalId: 4141414,
      overrides: {
        'stage:deals/orchard/tasting': { definition: { label: 'Tasted', probability: 0.3, ticketState: 'OPEN' } },
        'pipeline:deals/orchard': { definition: { label: 'Orchard', group: 'x' } },
      },
    }`,
  )
  const files = pipelineFiles([['deals', { id: 'orchard', stages: [DEAL_STAGE] }]], config)
  files['hubspot/removed.ts'] = [
    "import { defineRemoved } from '@kalup/core'",
    '',
    'export default defineRemoved({',
    "  'pipeline:deals/cider': { action: 'destroy' },",
    "  'stage:deals/orchard/gone': { action: 'release' },",
    "  'stage:deals/orchard': { action: 'release' },",
    '})',
    '',
  ].join('\n')
  const found = validate(loadFiles(files)).issues
  expect(found.map((i) => [i.code, i.configPath])).toEqual([
    ['E_OVERRIDE_DEFINITION', 'targets.sandbox.overrides.stage:deals/orchard/tasting.definition.ticketState'],
    ['E_OVERRIDE_DEFINITION', 'targets.sandbox.overrides.pipeline:deals/orchard.definition.group'],
    ['E_TOMBSTONE_ADDRESS', 'stage:deals/orchard'],
  ])
  expect(prose(found)).toMatchInlineSnapshot(`
    [
      "stage:deals/orchard/tasting on target sandbox: ticketState is for ticket stages; a stage of deals takes probability (fix: replace ticketState with probability)",
      "pipeline:deals/orchard on target sandbox: a pipeline override may set label and displayOrder only, not group (fix: remove group from the override)",
      "'stage:deals/orchard' is not of the form stage:<object>/<pipeline>/<stage> (fix: write the address of a property, group, pipeline or stage, such as 'property:companies/legacy_score')",
    ]
  `)
})
