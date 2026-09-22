import { expect, test } from 'vitest'
import { IssueError } from '../../src/grammar/types.js'
import type { Issue } from '../../src/ir/types.js'
import { validateIR } from '../../src/ir/validate.js'
import { fixtureText, project } from '../../src/loader/fixture.js'
import { loadFiles } from '../../src/loader/load.js'
import { validate } from '../../src/loader/validate.js'

const spec = project('spec')
const rule = (name: string): string => fixtureText(`rules/${name}`)
const BASE = { 'kalup.config.ts': rule('base.config.ts') }

function issues(files: Record<string, string>): Issue[] {
  try {
    loadFiles(files)
  } catch (error) {
    if (error instanceof IssueError) return error.issues
    throw error
  }
  throw new Error('expected loadFiles to throw')
}

/** 1-based line of the first line holding `snippet` in a fixture file. */
function lineOf(files: Record<string, string>, file: string, snippet: string): number {
  const index = (files[file] ?? '').split('\n').findIndex((line) => line.includes(snippet))
  if (index < 0) throw new Error(`${snippet} is not in ${file}`)
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
  const overrides = loadFiles({ ...BASE, 'kalup/objects/deals.ts': rule('base.ts') }, {}).ir.targets.sandbox?.overrides
  expect(overrides).toBeUndefined()
  const many = {
    'kalup.config.ts': `import { defineConfig } from 'kalup'\n\nexport default defineConfig({\n  targets: {\n    sandbox: {\n      portalId: 4141414,\n      overrides: {\n        'property:deals/term_days': { skip: true },\n        'group:deals/deal_terms': { name: 'terms' },\n      },\n    },\n  },\n})\n`,
    'kalup/objects/deals.ts': rule('base.ts'),
  }
  expect(Object.keys(loadFiles(many).ir.targets.sandbox?.overrides ?? {})).toEqual([
    'group:deals/deal_terms',
    'property:deals/term_days',
  ])
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
  expect(r['object:parcel']?.binding).toEqual({ export: 'Parcel' })
  expect(r['property:parcel/tracking_code']?.binding).toEqual({
    key: 'trackingCode',
    codec: 'string',
    required: true,
    readonly: true,
  })
  expect(r['property:parcel/status']?.binding).toEqual({
    key: 'status',
    codec: 'enum',
    aliases: { 'IN TRANSIT': 'in_transit' },
    required: true,
  })
  expect(r['property:parcel/handling']?.binding).toEqual({
    key: 'handling',
    codec: 'multiEnum',
    aliases: { cold: 'coldChain' },
  })
  expect(r['property:parcel/route_codes']?.binding).toEqual({ key: 'route-codes', codec: 'stringArray' })
  expect(r['property:parcel/meta']?.binding).toEqual({ key: 'meta', codec: 'json' })
  expect(r['property:parcel/volume_score']?.binding).toEqual({ key: 'volumeScore', codec: 'number', readonly: true })
  expect(r['property:parcel/legacy_ref']?.binding).toEqual({ key: 'legacyRef', codec: 'string' })
  expect(r['property:deals/dealstage']?.binding).toEqual({
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
  for (const [name, type] of types) expect(app.resources[`property:parcel/${name}`]?.definition?.type, name).toBe(type)
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
  expect(loadFiles(full).ir.resources['object:invoice']?.definition).toEqual({
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
      message: "missing field 'labels'",
      file,
      line: 3,
      configPath: 'Ticket',
      fix: "add labels: { singular: '...', plural: '...' }",
    },
    {
      code: 'E_NOT_DATA',
      message: "missing field 'primaryDisplayProperty'",
      file,
      line: 3,
      configPath: 'Ticket',
      fix: "add primaryDisplayProperty: '<internal name>'",
    },
  ])
})

test('definition and lookup overrides pass through as written; nothing reads them before apply', () => {
  const files = {
    'kalup.config.ts': `import { defineConfig } from 'kalup'\n\nexport default defineConfig({\n  targets: {\n    sandbox: {\n      portalId: 4141414,\n      overrides: {\n        'property:deals/term_days': {\n          definition: { group: 'other', options: [{ value: 'x', label: 'X', as: 'ex' }], lifecycle: { options: 'exact' } },\n        },\n        'property:deals/amount': { lookup: { name: 'Amount' } },\n      },\n    },\n  },\n})\n`,
    'kalup/objects/deals.ts': rule('base.ts'),
  }
  const loaded = loadFiles(files)
  const { ir } = loaded
  expect(validate(loaded).issues).toEqual([])
  expect(ir.targets.sandbox?.overrides).toEqual({
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
      portalId: 2222222,
      protected: true,
      drift: 'hold',
      overrides: { 'property:subscription/customer_status': { name: 'customerstatus' } },
    },
    sandbox: { portalId: 1111111 },
  })
  expect(JSON.stringify(ir)).not.toContain('HUBSPOT_')
  expect(config.targets.production?.credentials).toEqual({
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
    { code: 'E_NO_CONFIG', message: 'no kalup.config.ts in the project', fix: 'run npx kalup init --portal <id>' },
  ])
})

test('a kalup.config.ts without export default defineConfig is E_NOT_DATA', () => {
  expect(issues({ 'kalup.config.ts': rule('base.ts') })).toEqual([
    {
      code: 'E_NOT_DATA',
      message: 'kalup.config.ts is not a defineConfig file',
      file: 'kalup.config.ts',
      line: 1,
      fix: 'write export default defineConfig({...})',
    },
  ])
})

test('E_UNSUPPORTED_FILE for removed.ts, pipelines/ and a defineConfig under kalup/; index.ts and other files are skipped', () => {
  const ok = {
    ...BASE,
    'kalup/objects/deals.ts': rule('base.ts'),
    'kalup/index.ts': "export { Deal } from './objects/deals'\n",
    'kalup/blueprints.lock.json': '{}\n',
    'src/deals.ts': 'not read\n',
  }
  expect(Object.keys(loadFiles(ok).ir.resources)).toEqual([
    'group:deals/deal_terms',
    'property:deals/amount',
    'property:deals/term_days',
  ])
  const found = issues({
    ...ok,
    'kalup/removed.ts': 'export const removed = []\n',
    'kalup/pipelines/deals.ts': "export const Renewals = definePipeline('deals', {})\n",
    'kalup/objects/config.ts': rule('base.config.ts'),
  })
  const fix = (file: string): string => `move ${file} out of kalup/ until a release reads it`
  expect(found).toEqual([
    {
      code: 'E_UNSUPPORTED_FILE',
      message: 'a defineConfig file under kalup/ is not an object file',
      file: 'kalup/objects/config.ts',
      line: 1,
      fix: fix('kalup/objects/config.ts'),
    },
    {
      code: 'E_UNSUPPORTED_FILE',
      message: 'this version does not read pipelines yet',
      file: 'kalup/pipelines/deals.ts',
      line: 1,
      fix: fix('kalup/pipelines/deals.ts'),
    },
    {
      code: 'E_UNSUPPORTED_FILE',
      message: 'this version does not read tombstones yet',
      file: 'kalup/removed.ts',
      line: 1,
      fix: fix('kalup/removed.ts'),
    },
  ])
})

test('E_DUPLICATE_ADDRESS across files and across exports, with both file:line', () => {
  const found = issues({
    ...BASE,
    'kalup/objects/deals.ts': rule('base.ts'),
    'kalup/objects/extra.ts': rule('E_DUPLICATE_ADDRESS.ts'),
  })
  const fix = 'remove or rename one of the two definitions'
  expect(found).toEqual([
    {
      code: 'E_DUPLICATE_ADDRESS',
      message: 'group:deals/deal_terms is defined twice: kalup/objects/deals.ts:5 and kalup/objects/extra.ts:5',
      file: 'kalup/objects/extra.ts',
      line: 5,
      configPath: 'Deal.groups.deal_terms',
      fix,
    },
    {
      code: 'E_DUPLICATE_ADDRESS',
      message: 'property:deals/amount is defined twice: kalup/objects/deals.ts:8 and kalup/objects/extra.ts:8',
      file: 'kalup/objects/extra.ts',
      line: 8,
      configPath: 'Deal.properties.amount',
      fix,
    },
    {
      code: 'E_DUPLICATE_ADDRESS',
      message: 'group:deals/deal_terms is defined twice: kalup/objects/deals.ts:5 and kalup/objects/extra.ts:16',
      file: 'kalup/objects/extra.ts',
      line: 16,
      configPath: 'DealAgain.groups.deal_terms',
      fix,
    },
  ])
})

test('E_DUPLICATE_KEY when one internal name sits under two keys of one export', () => {
  expect(issues({ ...BASE, 'kalup/objects/deals.ts': rule('E_DUPLICATE_KEY.ts') })).toEqual([
    {
      code: 'E_DUPLICATE_KEY',
      message: "internal name 'amount' is used by two keys of Deal: 'amount' and 'total'",
      file: 'kalup/objects/deals.ts',
      line: 6,
      configPath: 'Deal.properties.total',
      fix: 'remove or rename one of the two entries',
    },
  ])
})

test('E_REFERENCE_DEFINITION: .managed(false) on a reference, options on p.string, a partial definition', () => {
  const found = issues({ ...BASE, 'kalup/objects/deals.ts': rule('E_REFERENCE_DEFINITION.ts') })
  expect(found.map((i) => [i.code, i.line, i.configPath])).toEqual([
    ['E_REFERENCE_DEFINITION', 5, 'Deal.properties.amount'],
    ['E_REFERENCE_DEFINITION', 6, 'Deal.properties.currency'],
    ['E_REFERENCE_DEFINITION', 9, 'Deal.properties.discount'],
  ])
  expect(found.map((i) => i.message)).toEqual([
    '.managed(false) on a reference: a property without label, group and fieldType is never managed',
    'options without label, group and fieldType are only allowed on p.enum and p.multiEnum, not p.string',
    'a definition needs label, group and fieldType',
  ])
  for (const i of found) expect(i.fix).toBeTruthy()
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
