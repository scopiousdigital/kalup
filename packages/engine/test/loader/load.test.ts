import { assert, expect, test } from 'vitest'
import { IssueError } from '../../src/grammar/types.js'
import { stableStringify } from '../../src/ir/serialize.js'
import type { Issue } from '../../src/ir/types.js'
import { validateIR } from '../../src/ir/validate.js'
import { definitionToIR, loadFiles } from '../../src/loader/load.js'
import { validate } from '../../src/loader/validate.js'
import { prose } from '../support/prose.js'
import { fixtureText, project } from './fixture.js'

const spec = project('spec')
const rule = (name: string): string => fixtureText(`rules/${name}`)
const BASE = { 'kalup.config.ts': rule('base.config.ts') }

function issues(files: Record<string, string>): Issue[] {
  try {
    loadFiles(files)
  } catch (error) {
    if (error instanceof IssueError) {
      return error.issues
    }
    throw error
  }
  throw new Error('expected loadFiles to throw')
}

/** 1-based line of the first line holding `snippet` in a fixture file. */
function lineOf(files: Record<string, string>, file: string, snippet: string): number {
  const index = (files[file] ?? '').split('\n').findIndex((line) => line.includes(snippet))
  if (index < 0) {
    throw new Error(`${snippet} is not in ${file}`)
  }
  return index + 1
}

test('golden IR for the spec example, validated against ir-1.schema.json', () => {
  const { ir } = loadFiles(spec, { root: '/work/acme', version: '0.1.0' })
  expect(ir).toEqual(JSON.parse(fixtureText('spec/ir.json')))
  expect(validateIR(ir)).toEqual([])
})

test('resources, targets and overrides come out with sorted keys', () => {
  const { ir } = loadFiles(spec)
  const addresses = Object.keys(ir.resources)
  expect(addresses).toEqual([...addresses].sort())
  expect(addresses[0]).toBe('group:companies/billing')
  expect(Object.keys(ir.targets)).toEqual(['production', 'sandbox'])
  const plain = loadFiles({ ...BASE, 'kalup/objects/deals.ts': rule('base.ts') }, {}).ir.targets.sandbox
  expect(plain).not.toHaveProperty('overrides')
  const many = {
    'kalup.config.ts': `import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({\n  targets: {\n    sandbox: {\n      portalId: 4141414,\n      overrides: {\n        'property:deals/term_days': { skip: true },\n        'group:deals/deal_terms': { name: 'terms' },\n      },\n    },\n  },\n})\n`,
    'kalup/objects/deals.ts': rule('base.ts'),
  }
  const { sandbox } = loadFiles(many).ir.targets
  assert(sandbox)
  expect(Object.keys(sandbox.overrides ?? {})).toEqual(['group:deals/deal_terms', 'property:deals/term_days'])
})

test('sources maps every address to file, line and config path', () => {
  const { ir, sources } = loadFiles(spec)
  expect(Object.keys(sources).sort()).toEqual(Object.keys(ir.resources))
  const companies = 'kalup/objects/companies.ts'
  const subscription = 'kalup/objects/subscription.ts'
  expect(sources['group:companies/billing']).toEqual({
    file: companies,
    line: lineOf(spec, companies, 'billing: {'),
    configPath: 'Company.groups.billing',
  })
  expect(sources['property:companies/billing_status']).toEqual({
    file: companies,
    line: lineOf(spec, companies, 'billingStatus: p'),
    configPath: 'Company.properties.billingStatus',
  })
  expect(sources['property:companies/name']).toEqual({
    file: companies,
    line: lineOf(spec, companies, "name: p.string('name')"),
    configPath: 'Company.properties.name',
  })
  expect(sources['object:subscription']).toEqual({
    file: subscription,
    line: lineOf(spec, subscription, 'export const Subscription'),
    configPath: 'Subscription',
  })
  expect(sources['property:subscription/name']).toEqual({
    file: subscription,
    line: lineOf(spec, subscription, "name: p.string('name', {"),
    configPath: 'Subscription.properties.name',
  })
  expect(loadFiles(spec).configLines['targets.production.overrides.property:subscription/customer_status']).toBe(18)
})

const app = loadFiles(project('app')).ir

test('binding defaults: key as written, codec from the builder, aliases from as, the chain flags, export from the export name', () => {
  const r = app.resources
  expect(r['object:parcel']).toHaveProperty('binding', { export: 'Parcel' })
  expect(r['property:parcel/tracking_code']).toHaveProperty('binding', {
    key: 'trackingCode',
    codec: 'string',
    required: true,
    readonly: true,
  })
  expect(r['property:parcel/status']).toHaveProperty('binding', {
    key: 'status',
    codec: 'enum',
    aliases: { 'IN TRANSIT': 'in_transit' },
    required: true,
  })
  expect(r['property:parcel/handling']).toHaveProperty('binding', {
    key: 'handling',
    codec: 'multiEnum',
    aliases: { cold: 'coldChain' },
  })
  expect(r['property:parcel/route_codes']).toHaveProperty('binding', { key: 'route-codes', codec: 'stringArray' })
  expect(r['property:parcel/meta']).toHaveProperty('binding', { key: 'meta', codec: 'json' })
  expect(r['property:parcel/volume_score']).toHaveProperty('binding', {
    key: 'volumeScore',
    codec: 'number',
    readonly: true,
  })
  expect(r['property:parcel/legacy_ref']).toHaveProperty('binding', { key: 'legacyRef', codec: 'string' })
  expect(r['property:deals/dealstage']).toHaveProperty('binding', {
    key: 'stage',
    codec: 'enum',
    aliases: { appointmentscheduled: 'scheduled' },
  })
  const codecs = Object.entries(r)
    .filter(([address]) => address.startsWith('property:parcel/'))
    .map(([, resource]) => resource.binding?.codec)
    .sort()
  expect(codecs).toEqual(
    [
      'boolean',
      'date',
      'datetime',
      'enum',
      'json',
      'multiEnum',
      'number',
      'number',
      'string',
      'string',
      'stringArray',
    ].sort(),
  )
})

test('aliases keep option values named like Object.prototype members as own keys', () => {
  const deals = `import { defineObject, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  properties: {
    kind: p.enum('deal_kind', {
      options: [
        { value: '__proto__', label: 'Proto', as: 'proto' },
        { value: 'constructor', label: 'Constructor', as: 'builder' },
        { value: 'toString', label: 'To string' },
      ],
    }),
  },
})
`
  const { ir } = loadFiles({ ...BASE, 'kalup/objects/deals.ts': deals })
  const kind = ir.resources['property:deals/deal_kind']
  const aliases = kind?.binding?.aliases
  assert(aliases)
  expect(Object.entries(aliases)).toEqual([
    ['__proto__', 'proto'],
    ['constructor', 'builder'],
  ])
  expect(stableStringify(aliases)).toBe('{\n  "__proto__": "proto",\n  "constructor": "builder"\n}')
})

test('$ref lifting: group becomes a $ref, lifecycle is lifted with defaults, as leaves the options, type comes from the builder', () => {
  const status = app.resources['property:parcel/status']
  expect(status?.definition).toEqual({
    label: 'Status',
    group: { $ref: 'group:parcel/routing' },
    type: 'enumeration',
    fieldType: 'select',
    options: [
      { value: 'packed', label: 'Packed' },
      { value: 'IN TRANSIT', label: 'In transit' },
      { value: 'lost', label: 'Lost', hidden: true, description: 'Claim opened' },
    ],
  })
  expect(status?.lifecycle).toEqual({
    options: 'exact',
    removedOptions: ['returned'],
    ignoreChanges: ['description'],
    preventDestroy: true,
  })
  expect(app.resources['property:parcel/fragile']).toEqual({
    type: 'property',
    managed: true,
    definition: {
      label: 'Fragile',
      group: { $ref: 'group:parcel/parcel_details' },
      type: 'bool',
      fieldType: 'booleancheckbox',
      formField: true,
    },
    binding: { key: 'fragile', codec: 'boolean' },
    lifecycle: { options: 'additive' },
  })
  const types: [string, string][] = [
    ['scanned_at', 'datetime'],
    ['shipped_on', 'date'],
    ['weight_kg', 'number'],
    ['route_codes', 'string'],
    ['meta', 'string'],
    ['handling', 'enumeration'],
  ]
  for (const [name, type] of types) {
    expect(app.resources[`property:parcel/${name}`]?.definition?.type, name).toBe(type)
  }
})

test('references: no definition, an options-only enum, and .managed(false) keeping definition and lifecycle', () => {
  expect(app.resources['property:parcel/volume_score']).toEqual({
    type: 'property',
    managed: false,
    binding: { key: 'volumeScore', codec: 'number', readonly: true },
  })
  expect(app.resources['property:deals/dealstage']).toEqual({
    type: 'property',
    managed: false,
    definition: {
      options: [
        { value: 'appointmentscheduled', label: 'Appointment scheduled' },
        { value: 'closedwon', label: 'Closed won' },
      ],
    },
    binding: { key: 'stage', codec: 'enum', aliases: { appointmentscheduled: 'scheduled' } },
  })
  expect(app.resources['property:parcel/legacy_ref']).toEqual({
    type: 'property',
    managed: false,
    definition: {
      label: 'Legacy reference',
      group: { $ref: 'group:parcel/parcel_details' },
      type: 'string',
      fieldType: 'text',
    },
    binding: { key: 'legacyRef', codec: 'string' },
    lifecycle: { options: 'additive', preventDestroy: true },
  })
})

test('definitionToIR is what the loader writes: stated fields only, explicit defaults kept, as out of the options', () => {
  const full = {
    label: 'Handling',
    group: 'routing',
    fieldType: 'radio',
    description: '',
    options: [
      { value: 'dry', label: 'Dry', as: 'ambient' },
      { value: 'cold', label: 'Cold', hidden: false, description: '' },
    ],
    hasUniqueValue: false,
    formField: false,
    lifecycle: { options: 'exact' as const },
  }
  expect(definitionToIR('parcel', 'enum', full)).toEqual({
    label: 'Handling',
    group: { $ref: 'group:parcel/routing' },
    type: 'enumeration',
    fieldType: 'radio',
    description: '',
    options: [
      { value: 'dry', label: 'Dry' },
      { value: 'cold', label: 'Cold', hidden: false, description: '' },
    ],
    hasUniqueValue: false,
    formField: false,
  })
  // An options-only reference: type goes with fieldType, so it stays out.
  expect(definitionToIR('deals', 'enum', { options: [{ value: 'closedwon', label: 'Closed won' }] })).toEqual({
    options: [{ value: 'closedwon', label: 'Closed won' }],
  })
})

test('a custom object is a resource with its export name; a standard object is not', () => {
  expect(app.resources['object:parcel']).toEqual({
    type: 'object',
    managed: true,
    definition: {
      labels: { singular: 'Parcel', plural: 'Parcels' },
      primaryDisplayProperty: 'tracking_code',
      requiredProperties: ['tracking_code'],
    },
    binding: { export: 'Parcel' },
  })
  expect(app.resources['group:parcel/routing']).toEqual({
    type: 'group',
    managed: true,
    definition: { label: 'Routing' },
  })
  expect(app.resources['object:deals']).toBeUndefined()
  const full = {
    ...BASE,
    'kalup/objects/invoices.ts': `import { defineCustomObject, p } from '@kalup/core'\n\nexport const Invoice = defineCustomObject('invoice', {\n  labels: { singular: 'Invoice', plural: 'Invoices' },\n  primaryDisplayProperty: 'invoice_number',\n  requiredProperties: ['invoice_number'],\n  searchableProperties: ['invoice_number'],\n  secondaryDisplayProperties: ['due_date'],\n  properties: {\n    invoiceNumber: p.string('invoice_number'),\n  },\n})\n`,
  }
  expect(loadFiles(full).ir.resources['object:invoice']).toHaveProperty('definition', {
    labels: { singular: 'Invoice', plural: 'Invoices' },
    primaryDisplayProperty: 'invoice_number',
    requiredProperties: ['invoice_number'],
    searchableProperties: ['invoice_number'],
    secondaryDisplayProperties: ['due_date'],
  })
})

test('a defineCustomObject without labels or primaryDisplayProperty is refused with file and line', () => {
  const file = 'kalup/objects/tickets.ts'
  const found = issues({
    ...BASE,
    [file]: `import { defineCustomObject, p } from '@kalup/core'\n\nexport const Ticket = defineCustomObject('ticketx', { properties: { a: p.string('a') } })\n`,
  })
  expect(found).toEqual([
    {
      code: 'E_NOT_DATA',
      message: expect.any(String),
      file,
      line: 3,
      configPath: 'Ticket',
      fix: expect.any(String),
    },
    {
      code: 'E_NOT_DATA',
      message: expect.any(String),
      file,
      line: 3,
      configPath: 'Ticket',
      fix: expect.any(String),
    },
  ])
  expect(prose(found)).toMatchInlineSnapshot(`
    [
      "missing field 'labels' (fix: add labels: { singular: '...', plural: '...' })",
      "missing field 'primaryDisplayProperty' (fix: add primaryDisplayProperty: '<internal name>')",
    ]
  `)
})

test('definition and lookup overrides pass into the IR as written, in grammar form; validate checks the definition', () => {
  const files = {
    'kalup.config.ts': `import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({\n  targets: {\n    sandbox: {\n      portalId: 4141414,\n      overrides: {\n        'property:deals/term_days': {\n          definition: { group: 'other', options: [{ value: 'x', label: 'X', as: 'ex' }], lifecycle: { options: 'exact' } },\n        },\n        'property:deals/amount': { lookup: { name: 'Amount' } },\n      },\n    },\n  },\n})\n`,
    'kalup/objects/deals.ts': rule('base.ts'),
  }
  const loaded = loadFiles(files)
  const { ir } = loaded
  // effectiveResources converts an override to IR form for a target; the IR keeps what the file says.
  expect(validate(loaded).issues.map((i) => [i.code, i.configPath])).toEqual([
    ['E_OVERRIDE_DEFINITION', 'targets.sandbox.overrides.property:deals/term_days.definition.group'],
    ['E_OVERRIDE_DEFINITION', 'targets.sandbox.overrides.property:deals/term_days.definition.options[0].as'],
  ])
  expect(ir.targets.sandbox).toHaveProperty('overrides', {
    'property:deals/amount': { lookup: { name: 'Amount' } },
    'property:deals/term_days': {
      definition: { group: 'other', options: [{ value: 'x', label: 'X', as: 'ex' }], lifecycle: { options: 'exact' } },
    },
  })
  expect(validateIR(ir)).toEqual([])
})

test('targets are copied without credentials; the config keeps them, with the pull scope', () => {
  const { ir, config } = loadFiles(spec)
  expect(ir.targets).toEqual({
    production: {
      portalId: 2_222_222,
      protected: true,
      drift: 'hold',
      overrides: { 'property:subscription/customer_status': { name: 'customerstatus' } },
    },
    sandbox: { portalId: 1_111_111 },
  })
  expect(JSON.stringify(ir)).not.toContain('HUBSPOT_')
  expect(config.targets.production).toHaveProperty('credentials', {
    read: { env: 'HUBSPOT_PROD_READ_KEY' },
    write: { env: 'HUBSPOT_PROD_WRITE_KEY' },
  })
  expect(config.objects).toEqual({
    companies: { include: ['name', 'domain'] },
    products: { include: ['hs_object_id', 'name', 'hs_sku'], custom: false },
    subscription: {},
  })
  expect(config.name).toBe('acme-crm')
})

test('project name from defineConfig, else the basename of root; generator from options', () => {
  const files = { ...BASE, 'kalup/objects/deals.ts': rule('base.ts') }
  expect(loadFiles(spec, { root: '/work/other' }).ir.project).toBe('acme-crm')
  expect(loadFiles(files, { root: '/work/acme-portal/' }).ir.project).toBe('acme-portal')
  expect(loadFiles(files, { root: 'C:\\work\\acme-portal' }).ir.project).toBe('acme-portal')
  expect(loadFiles(files).ir.project).toBe('')
  expect(loadFiles(files).ir.generator).toEqual({ name: 'kalup', version: '0.0.0', frontend: 'ts' })
  expect(loadFiles(files, { version: '0.3.1' }).ir.generator.version).toBe('0.3.1')
  expect(loadFiles(files).ir.tombstones).toEqual({})
})

test('E_NO_CONFIG when kalup.config.ts is missing', () => {
  expect(issues({ 'kalup/objects/deals.ts': rule('base.ts') })).toEqual([
    { code: 'E_NO_CONFIG', message: expect.any(String), fix: expect.any(String) },
  ])
  expect(prose(issues({ 'kalup/objects/deals.ts': rule('base.ts') }))).toMatchInlineSnapshot(`
    [
      "no kalup.config.ts in the project (fix: run npx kalup init --portal <id>)",
    ]
  `)
})

test('a kalup.config.ts without export default defineConfig is E_NOT_DATA', () => {
  expect(issues({ 'kalup.config.ts': rule('base.ts') })).toEqual([
    {
      code: 'E_NOT_DATA',
      message: expect.any(String),
      file: 'kalup.config.ts',
      line: 1,
      fix: expect.any(String),
    },
  ])
  expect(prose(issues({ 'kalup.config.ts': rule('base.ts') }))).toMatchInlineSnapshot(`
    [
      "kalup.config.ts is not a defineConfig file (fix: write export default defineConfig({...}))",
    ]
  `)
})

test('E_UNSUPPORTED_FILE for pipelines/ and a defineConfig or defineRemoved elsewhere under kalup/; index.ts and other files are skipped', () => {
  const ok = {
    ...BASE,
    'kalup/objects/deals.ts': rule('base.ts'),
    'kalup/index.ts': "export { Deal } from './objects/deals'\n",
    'kalup/blueprints.lock.json': '{ "lockVersion": 1, "blueprints": {}, "sources": {} }\n',
    'kalup/.blueprints/acme--terms@1.0.0.json': 'not read\n',
    'src/deals.ts': 'not read\n',
  }
  expect(Object.keys(loadFiles(ok).ir.resources)).toEqual([
    'group:deals/deal_terms',
    'property:deals/amount',
    'property:deals/term_days',
  ])
  const found = issues({
    ...ok,
    'kalup/pipelines/deals.ts': "export const Renewals = definePipeline('deals', {})\n",
    'kalup/objects/config.ts': rule('base.config.ts'),
    'kalup/objects/removed.ts': "import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({})\n",
  })
  expect(found).toEqual([
    {
      code: 'E_UNSUPPORTED_FILE',
      message: expect.any(String),
      file: 'kalup/objects/config.ts',
      line: 1,
      fix: expect.any(String),
    },
    {
      code: 'E_UNSUPPORTED_FILE',
      message: expect.any(String),
      file: 'kalup/objects/removed.ts',
      line: 1,
      fix: expect.any(String),
    },
    {
      code: 'E_UNSUPPORTED_FILE',
      message: expect.any(String),
      file: 'kalup/pipelines/deals.ts',
      line: 1,
      fix: expect.any(String),
    },
  ])
  expect(prose(found)).toMatchInlineSnapshot(`
    [
      "a defineConfig file under kalup/ is not an object file (fix: move kalup/objects/config.ts out of kalup/ until a release reads it)",
      "a defineRemoved file belongs at kalup/removed.ts (fix: move its entries to kalup/removed.ts)",
      "this version does not read pipelines yet (fix: move kalup/pipelines/deals.ts out of kalup/ until a release reads it)",
    ]
  `)
})

test('kalup/removed.ts fills the tombstones, sorted by key, with a line per key', () => {
  const removed = [
    "import { defineRemoved } from '@kalup/core'",
    '',
    'export default defineRemoved({',
    "  'property:deals/old_score': { action: 'destroy', reason: 'Replaced by term_days' },",
    "  'group:deals/old_terms': { action: 'release' },",
    '})',
    '',
  ].join('\n')
  const loaded = loadFiles({ ...BASE, 'kalup/objects/deals.ts': rule('base.ts'), 'kalup/removed.ts': removed })
  expect(loaded.ir.tombstones).toStrictEqual({
    'group:deals/old_terms': { action: 'release' },
    'property:deals/old_score': { action: 'destroy', reason: 'Replaced by term_days' },
  })
  expect(Object.keys(loaded.ir.tombstones)).toEqual(['group:deals/old_terms', 'property:deals/old_score'])
  expect(loaded.removedLines).toMatchObject({ 'property:deals/old_score': 4, 'group:deals/old_terms': 5 })
  expect(validateIR(loaded.ir)).toEqual([])
  expect(loadFiles({ ...BASE }).removedLines).toEqual({})
})

test('a kalup/removed.ts that is not a defineRemoved file is E_NOT_DATA, and its grammar issues come through', () => {
  const removed = (text: string) => issues({ ...BASE, 'kalup/removed.ts': text })
  expect(removed(rule('base.config.ts'))).toEqual([
    {
      code: 'E_NOT_DATA',
      message: expect.any(String),
      file: 'kalup/removed.ts',
      line: 3,
      fix: expect.any(String),
    },
  ])
  expect(prose(removed(rule('base.config.ts')))).toMatchInlineSnapshot(`
    [
      "expected 'defineRemoved' but found 'defineConfig' (fix: write export default defineRemoved({...}))",
    ]
  `)
  // Read by its path, not its content: a misspelt builder or an empty file gets the removed.ts fix.
  expect(removed("import { defineRemoved } from '@kalup/core'\n\nexport default defineRemove({})\n")).toEqual([
    {
      code: 'E_NOT_DATA',
      message: expect.any(String),
      file: 'kalup/removed.ts',
      line: 3,
      fix: expect.any(String),
    },
  ])
  expect(
    prose(removed("import { defineRemoved } from '@kalup/core'\n\nexport default defineRemove({})\n")),
  ).toMatchInlineSnapshot(`
    [
      "expected 'defineRemoved' but found 'defineRemove' (fix: write export default defineRemoved({...}))",
    ]
  `)
  expect(removed('')).toEqual([
    { code: 'E_NOT_DATA', message: expect.any(String), file: 'kalup/removed.ts', line: 1, fix: expect.any(String) },
  ])
  expect(prose(removed(''))).toMatchInlineSnapshot(`
    [
      "expected 'export' but found end of file (fix: write export default defineRemoved({...}))",
    ]
  `)
  const bad = "import { defineRemoved } from '@kalup/core'\nexport default defineRemoved({ 'group:deals/a': {} })\n"
  expect(issues({ ...BASE, 'kalup/removed.ts': bad })).toEqual([
    expect.objectContaining({
      code: 'E_NOT_DATA',
      file: 'kalup/removed.ts',
      line: 2,
      message: expect.any(String),
    }),
  ])
  expect(prose(issues({ ...BASE, 'kalup/removed.ts': bad }))).toMatchInlineSnapshot(`
    [
      "missing field 'action' (fix: add action)",
    ]
  `)
})

test('allowDestroy enters the IR target', () => {
  const config = rule('base.config.ts').replace('{ portalId: 4141414 }', '{ portalId: 4141414, allowDestroy: false }')
  expect(loadFiles({ 'kalup.config.ts': config }).ir.targets).toStrictEqual({
    sandbox: { portalId: 4_141_414, allowDestroy: false },
  })
})

test('E_DUPLICATE_ADDRESS across files and across exports, with both file:line', () => {
  const found = issues({
    ...BASE,
    'kalup/objects/deals.ts': rule('base.ts'),
    'kalup/objects/extra.ts': rule('E_DUPLICATE_ADDRESS.ts'),
  })
  expect(found).toEqual([
    {
      code: 'E_DUPLICATE_ADDRESS',
      message: expect.any(String),
      file: 'kalup/objects/extra.ts',
      line: 5,
      configPath: 'Deal.groups.deal_terms',
      fix: expect.any(String),
    },
    {
      code: 'E_DUPLICATE_ADDRESS',
      message: expect.any(String),
      file: 'kalup/objects/extra.ts',
      line: 8,
      configPath: 'Deal.properties.amount',
      fix: expect.any(String),
    },
    {
      code: 'E_DUPLICATE_ADDRESS',
      message: expect.any(String),
      file: 'kalup/objects/extra.ts',
      line: 16,
      configPath: 'DealAgain.groups.deal_terms',
      fix: expect.any(String),
    },
  ])
  expect(prose(found)).toMatchInlineSnapshot(`
    [
      "group:deals/deal_terms is defined twice: kalup/objects/deals.ts:5 and kalup/objects/extra.ts:5 (fix: remove or rename one of the two definitions)",
      "property:deals/amount is defined twice: kalup/objects/deals.ts:8 and kalup/objects/extra.ts:8 (fix: remove or rename one of the two definitions)",
      "group:deals/deal_terms is defined twice: kalup/objects/deals.ts:5 and kalup/objects/extra.ts:16 (fix: remove or rename one of the two definitions)",
    ]
  `)
})

test('E_DUPLICATE_KEY when one internal name sits under two keys of one export', () => {
  expect(issues({ ...BASE, 'kalup/objects/deals.ts': rule('E_DUPLICATE_KEY.ts') })).toEqual([
    {
      code: 'E_DUPLICATE_KEY',
      message: expect.any(String),
      file: 'kalup/objects/deals.ts',
      line: 6,
      configPath: 'Deal.properties.total',
      fix: expect.any(String),
    },
  ])
  expect(prose(issues({ ...BASE, 'kalup/objects/deals.ts': rule('E_DUPLICATE_KEY.ts') }))).toMatchInlineSnapshot(`
    [
      "internal name 'amount' is used by two keys of Deal: 'amount' and 'total' (fix: remove or rename one of the two entries)",
    ]
  `)
})

test('E_REFERENCE_DEFINITION: .managed(false) on a reference, options on p.string, a partial definition', () => {
  const found = issues({ ...BASE, 'kalup/objects/deals.ts': rule('E_REFERENCE_DEFINITION.ts') })
  expect(found.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_REFERENCE_DEFINITION', 5, 'Deal.properties.amount'],
    ['E_REFERENCE_DEFINITION', 6, 'Deal.properties.currency'],
    ['E_REFERENCE_DEFINITION', 9, 'Deal.properties.discount'],
  ])
  expect(prose(found)).toMatchInlineSnapshot(`
    [
      ".managed(false) on a reference: a property without label, group and fieldType is never managed (fix: drop .managed(false), or add label, group and fieldType)",
      "options without label, group and fieldType are only allowed on p.enum and p.multiEnum, not p.string (fix: add label, group and fieldType, or drop the options)",
      "a definition needs label, group and fieldType (fix: add the missing fields, or drop the definition)",
    ]
  `)
  for (const i of found) {
    expect(i.fix).toBeTruthy()
  }
})

test('issues are collected across every file before the loader throws', () => {
  const found = issues({
    'kalup.config.ts': rule('base.ts'),
    'kalup/objects/deals.ts': rule('E_DUPLICATE_KEY.ts'),
    'kalup/objects/broken.ts': `import { defineObject, p } from '@kalup/core'\n\nexport const Deal = defineObject('deals', { properties: { a: p.text('a') } })\n`,
  })
  expect(found.map((i) => [i.code, i.file])).toEqual([
    ['E_NOT_DATA', 'kalup.config.ts'],
    ['E_UNKNOWN_BUILDER', 'kalup/objects/broken.ts'],
    ['E_DUPLICATE_KEY', 'kalup/objects/deals.ts'],
  ])
})

// A lock that lists term_days and deal_terms under acme/terms, and a property the client has since removed.
const LOCK = JSON.stringify({
  lockVersion: 1,
  blueprints: {
    'acme/terms': {
      version: '1.2.0',
      source: 'blueprints/terms.json',
      hash: `sha256:${'ab'.repeat(32)}`,
      prefix: '',
      original: 'kalup/.blueprints/acme--terms@1.2.0.json',
      resources: {
        'group:deals/deal_terms': 'group:deals/deal_terms',
        'property:deals/term_days': 'property:deals/term_days',
        'property:deals/term_notes': 'property:deals/term_notes',
      },
      held: [],
    },
  },
  sources: { 'blueprints/terms.json@1.2.0': `sha256:${'ab'.repeat(32)}` },
})

test('the lock merges provenance into each config resource it lists; one config no longer has is fine', () => {
  const { ir } = loadFiles({ ...BASE, 'kalup/objects/deals.ts': rule('base.ts'), 'kalup/blueprints.lock.json': LOCK })
  const provenance = {
    blueprint: 'acme/terms',
    version: '1.2.0',
    prefix: '',
    hash: `sha256:${'ab'.repeat(32)}`,
  }
  expect(ir.resources).toMatchObject({
    'property:deals/term_days': { provenance: { ...provenance, sourceAddress: 'property:deals/term_days' } },
    'group:deals/deal_terms': { provenance: { ...provenance, sourceAddress: 'group:deals/deal_terms' } },
  })
  expect(ir.resources['property:deals/amount']).not.toHaveProperty('provenance')
  expect(ir.resources).not.toHaveProperty(['property:deals/term_notes'])
  expect(validateIR(ir)).toEqual([])
})

test('an invalid lock is E_BLUEPRINT_LOCK and the loader throws; the stored originals are never read as config', () => {
  const broken = issues({ ...BASE, 'kalup/objects/deals.ts': rule('base.ts'), 'kalup/blueprints.lock.json': '{' })
  expect(broken.map((i) => [i.code, i.file])).toEqual([['E_BLUEPRINT_LOCK', 'kalup/blueprints.lock.json']])
  const invalid = issues({
    ...BASE,
    'kalup/objects/deals.ts': rule('base.ts'),
    'kalup/blueprints.lock.json': LOCK.replace('"prefix":""', '"prefix":"Acme"'),
  })
  expect(invalid.map((i) => [i.code, i.configPath])).toEqual([['E_BLUEPRINT_LOCK', 'blueprints.acme/terms.prefix']])
  const withOriginal = loadFiles({
    ...BASE,
    'kalup/objects/deals.ts': rule('base.ts'),
    'kalup/.blueprints/acme--terms@1.2.0.json': 'not config at all',
  })
  expect(Object.keys(withOriginal.ir.resources)).toEqual([
    'group:deals/deal_terms',
    'property:deals/amount',
    'property:deals/term_days',
  ])
})
