// The simulator's own tests, so scenario tests can trust it: routing by key, the property and group model, the
// documented answers, the answers the first live run observed (run 89b45da9, 2026-09-29), the choices it makes where
// neither says, and every fault action.
import { afterEach, expect, test, vi } from 'vitest'
import { createHttp, createWriteHttp, MILESTONE_3_WRITES } from '../../src/lib/http.js'
import { createPortalSim, fault, type PortalSim, type SimPortalInput } from './portal-sim.js'

const sandboxKey = 'kalup-sim-sandbox-7c1e'
const writeKey = 'kalup-sim-write-2d9a'
const productionKey = 'kalup-sim-production-5f3b'
const base = 'https://api.hubapi.com'
const companies = '/crm/properties/2026-09/companies'
const groups = `${companies}/groups`
const start = Date.parse('2026-09-24T10:00:00.000Z')
const endsWithGroups = /\/groups$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
let clock = start

afterEach(() => {
  clock = start
  vi.useRealTimers()
})

function sim(extra: Partial<SimPortalInput> = {}): PortalSim {
  return createPortalSim(
    [
      {
        portalId: 1_111_111,
        keys: { HUBSPOT_SANDBOX_KEY: sandboxKey, HUBSPOT_SANDBOX_WRITE_KEY: writeKey },
        objects: {
          companies: {
            groups: [
              { name: 'orchard', label: 'Orchard details', displayOrder: 1 },
              { name: 'plots', label: 'Plots' },
              { name: 'old_ledger', label: 'Old ledger', archived: true },
            ],
            properties: [
              { name: 'plot_count', label: 'Plot count', type: 'number', fieldType: 'number', groupName: 'plots' },
              {
                name: 'yield_tier',
                label: 'Yield band',
                type: 'enumeration',
                fieldType: 'select',
                groupName: 'orchard',
                options: [
                  { value: 'low', label: 'Low', displayOrder: 0, hidden: false },
                  { value: 'high', label: 'High', displayOrder: 1, hidden: false },
                ],
              },
              {
                name: 'grower_tax_ref',
                type: 'string',
                fieldType: 'text',
                groupName: 'orchard',
                dataSensitivity: 'sensitive',
              },
              {
                name: 'old_yield',
                type: 'string',
                fieldType: 'text',
                groupName: 'orchard',
                description: 'Yield before the orchard was replanted',
                formField: true,
                hidden: true,
                archived: true,
                archivedAt: '2026-08-01T09:00:00.000Z',
              },
              {
                name: 'name',
                label: 'Company name',
                type: 'string',
                fieldType: 'text',
                groupName: 'plots',
                hubspotDefined: true,
                modificationMetadata: { archivable: false, readOnlyDefinition: true, readOnlyValue: false },
              },
            ],
          },
        },
        schemas: [{ name: 'harvest', objectTypeId: '2-4242001', labels: { singular: 'Harvest', plural: 'Harvests' } }],
        ...extra,
      },
      { portalId: 2_222_222, accountType: 'STANDARD', keys: { HUBSPOT_PROD_READ_KEY: productionKey } },
    ],
    () => new Date(clock),
  )
}

interface Sent {
  body?: unknown
  key?: string
  query?: Record<string, string>
  signal?: AbortSignal
}

async function call(s: PortalSim, method: string, path: string, sent: Sent = {}) {
  const url = new URL(path, base)
  for (const [name, value] of Object.entries(sent.query ?? {})) {
    url.searchParams.set(name, value)
  }
  const init: RequestInit = {
    method,
    headers: { authorization: `Bearer ${sent.key ?? writeKey}`, 'content-type': 'application/json' },
    ...(sent.body === undefined ? {} : { body: JSON.stringify(sent.body) }),
    ...(sent.signal ? { signal: sent.signal } : {}),
  }
  const res = await s.fetch(url.toString(), init)
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text === '' ? undefined : JSON.parse(text) }
}

function names(body: unknown): string[] {
  return (body as { results: { name: string }[] }).results.map((r) => r.name)
}

const newProperty = {
  name: 'soil_ph',
  label: 'Soil pH',
  type: 'number',
  fieldType: 'number',
  groupName: 'orchard',
}

test('requests route by the Bearer key; an unknown key is 401; the log names the variable and never a key', async () => {
  const s = sim()
  const sandbox = await call(s, 'GET', '/account-info/2026-09/details', { key: sandboxKey })
  expect(sandbox.body).toMatchObject({
    portalId: 1_111_111,
    accountType: 'SANDBOX',
    uiDomain: 'app-eu1.hubspot.com',
    timeZone: 'Europe/Ljubljana',
  })
  const production = await call(s, 'GET', '/account-info/2026-09/details', { key: productionKey })
  expect(production.body).toMatchObject({ portalId: 2_222_222, accountType: 'STANDARD' })
  const stranger = await call(s, 'GET', '/account-info/2026-09/details', { key: 'kalup-sim-unknown-0000' })
  expect(stranger.status).toBe(401)
  expect(stranger.body).toMatchObject({ category: 'INVALID_AUTHENTICATION' })
  await call(s, 'POST', companies, { body: newProperty, query: { hint: 'x' } })
  expect(s.log).toEqual([
    {
      method: 'GET',
      path: '/account-info/2026-09/details',
      query: {},
      key: 'HUBSPOT_SANDBOX_KEY',
      body: undefined,
      status: 200,
    },
    {
      method: 'GET',
      path: '/account-info/2026-09/details',
      query: {},
      key: 'HUBSPOT_PROD_READ_KEY',
      body: undefined,
      status: 200,
    },
    { method: 'GET', path: '/account-info/2026-09/details', query: {}, key: null, body: undefined, status: 401 },
    {
      method: 'POST',
      path: companies,
      query: { hint: 'x' },
      key: 'HUBSPOT_SANDBOX_WRITE_KEY',
      body: newProperty,
      status: 201,
    },
  ])
  expect(s.writes().map((w) => w.method)).toEqual(['POST'])
  const logged = JSON.stringify(s.log)
  for (const secret of [sandboxKey, writeKey, productionKey]) {
    expect(logged).not.toContain(secret)
  }
})

test('the portals are separate: a property of one is not in the other', async () => {
  const s = sim()
  const other = await call(s, 'GET', companies, { key: productionKey })
  expect(other.body).toEqual({ results: [] })
})

test('Limits Tracking custom-properties answers 403 to a key with no crm.objects scope, as observed', async () => {
  const s = sim({
    scopes: {
      HUBSPOT_SANDBOX_KEY: ['crm.schemas.companies.read', 'crm.schemas.custom.read'],
      HUBSPOT_SANDBOX_WRITE_KEY: ['crm.schemas.companies.read', 'crm.objects.companies.read'],
    },
  })
  const refused = await call(s, 'GET', '/crm/limits/2026-09/custom-properties', { key: sandboxKey })
  expect(refused).toMatchObject({ status: 403, body: { category: 'MISSING_SCOPES' } })
  expect((await call(s, 'GET', '/crm/limits/2026-09/custom-object-types', { key: sandboxKey })).status).toBe(200)
  const read = await call(s, 'GET', '/crm/limits/2026-09/custom-properties', { key: writeKey })
  expect(read).toMatchObject({ status: 200, body: { overallLimit: 1000 } })
})

test('Limits Tracking answers a default from the model, or the configured bodies', async () => {
  const s = sim()
  const properties = await call(s, 'GET', '/crm/limits/2026-09/custom-properties')
  expect(properties.body).toMatchObject({ overallLimit: 1000, overallUsage: 3, byObjectType: [] })
  const objects = await call(s, 'GET', '/crm/limits/2026-09/custom-object-types')
  expect(objects.body).toEqual({ limit: 10, usage: 1, percentage: 10 })
  const configured = sim({
    limits: { customProperties: { overallLimit: 5 }, customObjectTypes: { limit: 0, usage: 0 } },
  })
  expect((await call(configured, 'GET', '/crm/limits/2026-09/custom-properties')).body).toEqual({ overallLimit: 5 })
  expect((await call(configured, 'GET', '/crm/limits/2026-09/custom-object-types')).body).toEqual({
    limit: 0,
    usage: 0,
  })
})

test('the schemas list holds the custom objects, and one schema reads by type ID or name', async () => {
  const s = sim()
  const listed = await call(s, 'GET', '/crm-object-schemas/2026-09/schemas', {
    query: { includePropertyDefinitions: 'false' },
  })
  // HubSpot's defaults fill what the test leaves out.
  expect(listed.body).toEqual({
    results: [
      {
        name: 'harvest',
        objectTypeId: '2-4242001',
        id: '4242001',
        labels: { singular: 'Harvest', plural: 'Harvests' },
        description: null,
        requiredProperties: [],
        searchableProperties: [],
        secondaryDisplayProperties: [],
        restorable: true,
        allowsSensitiveProperties: true,
        archived: false,
      },
    ],
  })
  expect((await call(s, 'GET', '/crm-object-schemas/2026-09/schemas/2-4242001')).body).toMatchObject({
    name: 'harvest',
  })
  expect((await call(s, 'GET', '/crm-object-schemas/2026-09/schemas/harvest')).status).toBe(200)
  expect((await call(s, 'GET', '/crm-object-schemas/2026-09/schemas/2-9999')).status).toBe(404)
  // Its properties are under the type ID; an unknown object type is 404.
  expect((await call(s, 'GET', '/crm/properties/2026-09/2-4242001')).body).toEqual({ results: [] })
  expect((await call(s, 'GET', '/crm/properties/2026-09/2-9999')).status).toBe(404)
  expect((await call(s, 'GET', '/crm/properties/2026-09/deals')).body).toEqual({ results: [] })
})

test('schema writes as observed: a bare create, the name rules, a PATCH from an older copy, and the archive', async () => {
  const s = sim()
  const path = '/crm-object-schemas/2026-09/schemas'
  const labels = { singular: 'Crate', plural: 'Crates' }
  expect((await call(s, 'POST', path, { body: { name: 'crate', labels } })).status).toBe(400)
  expect(
    (await call(s, 'POST', path, { body: { name: 'crate-x', labels, primaryDisplayProperty: 'hs_object_id' } })).status,
  ).toBe(400)
  const made = await call(s, 'POST', path, { body: { name: 'crate', labels, primaryDisplayProperty: 'hs_object_id' } })
  expect(made.body).toMatchObject({
    name: 'crate',
    objectTypeId: '2-4243001',
    primaryDisplayProperty: 'hs_object_id',
    searchableProperties: ['hs_object_id'],
    requiredProperties: [],
    description: null,
  })
  // HubSpot's own properties, in the group <name>_information.
  expect(names((await call(s, 'GET', '/crm/properties/2026-09/2-4243001')).body)).toContain('hs_object_id')
  // An active schema's name is 409 in any case; `sameNameCreate: 'merge'` answers its exact name 201 with it.
  const again = await call(s, 'POST', path, { body: { name: 'crate', labels, primaryDisplayProperty: 'hs_object_id' } })
  expect(again.status).toBe(409)
  s.portal(1_111_111).sameNameCreate = 'merge'
  const merged = await call(s, 'POST', path, {
    body: { name: 'crate', labels, primaryDisplayProperty: 'hs_object_id' },
  })
  expect(merged).toMatchObject({ status: 201, body: { objectTypeId: '2-4243001' } })
  s.portal(1_111_111).sameNameCreate = 'refuse'
  expect(
    (await call(s, 'POST', path, { body: { name: 'CRATE', labels, primaryDisplayProperty: 'hs_object_id' } })).status,
  ).toBe(409)
  // A partial PATCH takes the fields it leaves out from the schema before the last write.
  await call(s, 'PATCH', `${path}/2-4243001`, { body: { description: 'First' } })
  await call(s, 'PATCH', `${path}/2-4243001`, { body: { description: 'Second' } })
  const partial = await call(s, 'PATCH', `${path}/2-4243001`, { body: { restorable: false } })
  expect(partial.body).toMatchObject({ description: 'First', restorable: false })
  expect((await call(s, 'PATCH', `${path}/2-4243001`, { body: { primaryDisplayProperty: 'nope' } })).status).toBe(400)
  // The archive leaves the list; archived=true lists it, and a create of its name purges it.
  s.portal(1_111_111).recordsIn.add('2-4243001')
  expect((await call(s, 'DELETE', `${path}/2-4243001`)).status).toBe(400)
  s.portal(1_111_111).recordsIn.clear()
  expect((await call(s, 'DELETE', `${path}/2-4243001`)).status).toBe(204)
  const listed = await call(s, 'GET', path, { query: { archived: 'true' } })
  expect(
    (listed.body as { results: { name: string; archived: boolean }[] }).results.map((r) => [r.name, r.archived]),
  ).toEqual([
    ['harvest', false],
    ['crate', true],
  ])
  await call(s, 'POST', path, { body: { name: 'crate', labels, primaryDisplayProperty: 'hs_object_id' } })
  expect(s.portal(1_111_111).archivedSchemas).toEqual([])
})

test('a properties list answers one sensitivity, non_sensitive by default, and active or archived properties', async () => {
  const s = sim()
  expect(names((await call(s, 'GET', companies)).body)).toEqual(['plot_count', 'yield_tier', 'name'])
  const sensitive = await call(s, 'GET', companies, { query: { dataSensitivity: 'sensitive' } })
  expect(names(sensitive.body)).toEqual(['grower_tax_ref'])
  expect(names((await call(s, 'GET', companies, { query: { dataSensitivity: 'highly_sensitive' } })).body)).toEqual([])
  const archived = await call(s, 'GET', companies, { query: { archived: 'true' } })
  expect((archived.body as { results: unknown[] }).results).toEqual([
    expect.objectContaining({ name: 'old_yield', archived: true, archivedAt: '2026-08-01T09:00:00.000Z' }),
  ])
})

test('a property is the documented Property shape, with modificationMetadata and times', async () => {
  const s = sim()
  expect((await call(s, 'GET', `${companies}/plot_count`)).body).toEqual({
    name: 'plot_count',
    label: 'Plot count',
    type: 'number',
    fieldType: 'number',
    groupName: 'plots',
    description: '',
    options: [],
    displayOrder: -1,
    hasUniqueValue: false,
    hidden: false,
    formField: false,
    calculated: false,
    externalOptions: false,
    hubspotDefined: false,
    dataSensitivity: 'non_sensitive',
    archived: false,
    createdAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
    modificationMetadata: { archivable: true, readOnlyDefinition: false, readOnlyValue: false },
  })
})

test('a single read is 404 for an unknown name, and honours dataSensitivity and archived', async () => {
  const s = sim()
  const unknown = await call(s, 'GET', `${companies}/nothing_here`)
  expect(unknown.status).toBe(404)
  expect(unknown.body).toMatchObject({ status: 'error', category: 'OBJECT_NOT_FOUND' })
  expect((await call(s, 'GET', `${companies}/grower_tax_ref`)).status).toBe(404)
  expect(
    (await call(s, 'GET', `${companies}/grower_tax_ref`, { query: { dataSensitivity: 'sensitive' } })).status,
  ).toBe(200)
  expect((await call(s, 'GET', `${companies}/old_yield`)).status).toBe(404)
  expect((await call(s, 'GET', `${companies}/old_yield`, { query: { archived: 'true' } })).status).toBe(200)
  expect((await call(s, 'GET', `${companies}/plot_count`, { query: { archived: 'true' } })).status).toBe(404)
})

test('a create answers 201 with the created property and a Location, and the lists show it', async () => {
  const s = sim()
  clock = Date.parse('2026-09-24T11:00:00.000Z')
  const created = await call(s, 'POST', companies, {
    body: { ...newProperty, description: 'Measured each spring', archived: true, hubspotDefined: true },
  })
  expect(created.status).toBe(201)
  expect(created.headers.get('location')).toBe('/crm/properties/2026-09/companies/soil_ph')
  expect(created.body).toMatchObject({
    ...newProperty,
    description: 'Measured each spring',
    archived: false,
    hubspotDefined: false,
    createdAt: '2026-09-24T11:00:00.000Z',
    updatedAt: '2026-09-24T11:00:00.000Z',
    modificationMetadata: { archivable: true, readOnlyDefinition: false, readOnlyValue: false },
  })
  expect(names((await call(s, 'GET', companies)).body)).toContain('soil_ph')
  expect((await call(s, 'GET', `${companies}/soil_ph`)).body).toEqual(created.body)
})

test('a create is 400 without a required field, in a group the object lacks, or with incomplete options', async () => {
  const s = sim()
  const bad = [
    { ...newProperty, label: undefined },
    { ...newProperty, groupName: 'no_such_group' },
    { ...newProperty, groupName: 'old_ledger' },
    { ...newProperty, type: 'enumeration', fieldType: 'select' },
    {
      ...newProperty,
      type: 'enumeration',
      fieldType: 'select',
      options: [{ value: 'a', label: 'A', displayOrder: 0 }],
    },
  ]
  const answers = await Promise.all(bad.map((body) => call(s, 'POST', companies, { body })))
  for (const answer of answers) {
    expect(answer.status).toBe(400)
    expect(answer.body).toMatchObject({ category: 'VALIDATION_ERROR' })
  }
  expect(names((await call(s, 'GET', companies)).body)).not.toContain('soil_ph')
})

test('a create is refused as observed: a bool without true and false, owner options, a currency name without the symbol, a sensitive create without the scope', async () => {
  const s = sim({ scopes: { HUBSPOT_SANDBOX_WRITE_KEY: ['crm.schemas.companies.write'] } })
  const bad = [
    { ...newProperty, type: 'bool', fieldType: 'booleancheckbox' },
    {
      ...newProperty,
      type: 'enumeration',
      fieldType: 'select',
      externalOptions: true,
      referencedObjectType: 'OWNER',
      options: [{ value: 'a', label: 'A', displayOrder: 0, hidden: false }],
    },
    { ...newProperty, type: 'enumeration', fieldType: 'select', externalOptions: true },
    { ...newProperty, currencyPropertyName: 'grove_currency' },
    { ...newProperty, textDisplayHint: '' },
  ]
  const answers = await Promise.all(bad.map((body) => call(s, 'POST', companies, { body })))
  expect(answers.map((a) => a.status)).toEqual([400, 400, 400, 400, 400])
  const sensitive = await call(s, 'POST', companies, { body: { ...newProperty, dataSensitivity: 'sensitive' } })
  expect(sensitive.status).toBe(403)
  expect(names((await call(s, 'GET', companies)).body)).not.toContain('soil_ph')
})

test('a create keeps the display fields, ignores dateDisplayHint, and a formula makes a calculation', async () => {
  const s = sim()
  const shown = await call(s, 'POST', companies, {
    body: {
      ...newProperty,
      numberDisplayHint: 'currency',
      showCurrencySymbol: true,
      currencyPropertyName: 'grove_currency',
      displayOrder: 2,
      hidden: true,
    },
  })
  expect(shown.body).toMatchObject({
    numberDisplayHint: 'currency',
    showCurrencySymbol: true,
    currencyPropertyName: 'grove_currency',
    displayOrder: 2,
    hidden: true,
  })
  const dated = await call(s, 'POST', companies, {
    body: { ...newProperty, name: 'planted_on', type: 'date', fieldType: 'date', dateDisplayHint: 'time_since' },
  })
  expect(dated.body).not.toHaveProperty('dateDisplayHint')
  const formula = await call(s, 'POST', companies, {
    body: { ...newProperty, name: 'soil_ph_double', calculationFormula: 'soil_ph   *\n 2' },
  })
  expect(formula.body).toMatchObject({
    fieldType: 'calculation_equation',
    calculated: true,
    calculationFormula: 'soil_ph * 2',
  })
  const owner = await call(s, 'POST', companies, {
    body: {
      ...newProperty,
      name: 'grove_manager',
      type: 'enumeration',
      fieldType: 'select',
      externalOptions: true,
      referencedObjectType: 'OWNER',
    },
  })
  expect(owner.status).toBe(201)
  // Observed: a PATCH keeps a hint sent as null, and refuses to turn the symbol off while a currency name is set.
  const kept = await call(s, 'PATCH', `${companies}/soil_ph`, { body: { numberDisplayHint: null } })
  expect(kept.body).toMatchObject({ numberDisplayHint: 'currency' })
  const off = await call(s, 'PATCH', `${companies}/soil_ph`, { body: { showCurrencySymbol: false } })
  expect(off.status).toBe(400)
})

test('a create of an active name is 409 OBJECT_ALREADY_EXISTS as observed, or the configured answer', async () => {
  const s = sim()
  const answer = await call(s, 'POST', companies, { body: { ...newProperty, name: 'plot_count' } })
  expect(answer).toMatchObject({
    status: 409,
    body: {
      status: 'error',
      category: 'OBJECT_ALREADY_EXISTS',
      subCategory: 'Properties.PROPERTY_WITH_NAME_EXISTS',
      message: "A property named 'plot_count' already exists.",
      correlationId: expect.stringMatching(uuid),
    },
  })
  expect(s.object(1_111_111, 'companies').properties.get('plot_count')?.label).toBe('Plot count')
  const configured = sim({ existingCreate: { status: 400, body: { category: 'VALIDATION_ERROR', message: 'exists' } } })
  const other = await call(configured, 'POST', companies, { body: { ...newProperty, name: 'plot_count' } })
  expect(other).toMatchObject({ status: 400, body: { category: 'VALIDATION_ERROR', message: 'exists' } })
})

test('a create of an archived name restores that property as a fresh create would make it, with only its old createdAt kept, as observed, or is refused when configured', async () => {
  const s = sim()
  const { createdAt } = s.object(1_111_111, 'companies').properties.get('old_yield') ?? {}
  clock = Date.parse('2026-09-24T12:00:00.000Z')
  const restored = await call(s, 'POST', companies, { body: { ...newProperty, name: 'old_yield' } })
  expect(restored.status).toBe(201)
  expect(restored.body).toMatchObject({
    name: 'old_yield',
    label: 'Soil pH',
    type: 'number',
    fieldType: 'number',
    description: '',
    formField: false,
    hidden: false,
    archived: false,
    createdAt,
    updatedAt: '2026-09-24T12:00:00.000Z',
  })
  expect(restored.body).not.toHaveProperty('archivedAt')
  expect((await call(s, 'GET', `${companies}/old_yield`)).status).toBe(200)
  expect((await call(s, 'GET', `${companies}/old_yield`, { query: { archived: 'true' } })).status).toBe(404)
  const refusing = sim({ archivedCreate: 'refuse' })
  const refused = await call(refusing, 'POST', companies, { body: { ...newProperty, name: 'old_yield' } })
  expect(refused).toMatchObject({ status: 409, body: { category: 'OBJECT_ALREADY_EXISTS' } })
  expect(refusing.object(1_111_111, 'companies').properties.get('old_yield')?.archived).toBe(true)
})

test('archiving a property an active calculation property uses is refused with the observed 400', async () => {
  const s = sim()
  const calculation = {
    name: 'plot_double',
    label: 'Plot double',
    type: 'number',
    fieldType: 'calculation_equation',
    groupName: 'plots',
    calculationFormula: 'plot_count * 2',
  }
  expect((await call(s, 'POST', companies, { body: calculation })).status).toBe(201)
  const refused = await call(s, 'DELETE', `${companies}/plot_count`)
  expect(refused).toMatchObject({
    status: 400,
    body: {
      category: 'VALIDATION_ERROR',
      subCategory: 'PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE',
      message: 'Property: plot_count of object type 0-2 is currently used in 1 places and cannot be deleted',
      context: { usageCount: ['1'] },
      errors: [
        {
          subCategory: 'PropertyValidationError.PROPERTY_USAGE',
          context: { parentType: ['CALCULATED_PROPERTY'], parentName: ['0-2/plot_double'] },
        },
      ],
    },
  })
  expect(s.object(1_111_111, 'companies').properties.get('plot_count')?.archived).toBe(false)
  // Once the calculation is archived, nothing uses it.
  expect((await call(s, 'DELETE', `${companies}/plot_double`)).status).toBe(204)
  expect((await call(s, 'DELETE', `${companies}/plot_count`)).status).toBe(204)
})

test('a PATCH changes only what it sends; options replace the whole list; updatedAt moves', async () => {
  const s = sim()
  clock = Date.parse('2026-09-24T12:00:00.000Z')
  const label = await call(s, 'PATCH', `${companies}/yield_tier`, { body: { label: 'Yield tier' } })
  expect(label.status).toBe(200)
  expect(label.body).toMatchObject({
    label: 'Yield tier',
    groupName: 'orchard',
    createdAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T12:00:00.000Z',
  })
  expect((label.body as { options: unknown[] }).options).toHaveLength(2)
  const options = [{ value: 'peak', label: 'Peak', displayOrder: 0, hidden: false }]
  const replaced = await call(s, 'PATCH', `${companies}/yield_tier`, { body: { options } })
  expect((replaced.body as { options: unknown[] }).options).toEqual(options)
  const moved = await call(s, 'PATCH', `${companies}/plot_count`, { body: { groupName: 'orchard', type: 'number' } })
  expect(moved.body).toMatchObject({ groupName: 'orchard' })
  // No PropertyUpdate field is required: an enumeration's type without options keeps its options.
  const typed = await call(s, 'PATCH', `${companies}/yield_tier`, {
    body: { label: 'Yield tier 2', type: 'enumeration', fieldType: 'select' },
  })
  expect(typed.status).toBe(200)
  expect(typed.body).toMatchObject({ label: 'Yield tier 2', options })
})

test('a PATCH is 400 for a field outside PropertyUpdate, a missing group or a read-only definition, 404 unknown', async () => {
  const s = sim()
  const cases: [string, unknown, number][] = [
    ['plot_count', { name: 'plot_total' }, 400],
    // Observed: HubSpot answers 200 to these and keeps the values it had.
    ['plot_count', { hasUniqueValue: true }, 200],
    ['plot_count', { dataSensitivity: 'sensitive' }, 200],
    ['plot_count', { numberDisplayHint: '' }, 400],
    ['plot_count', { groupName: 'no_such_group' }, 400],
    ['plot_count', { options: [{ value: 'a', label: 'A' }] }, 400],
    ['name', { label: 'Business name' }, 400],
    ['old_yield', { label: 'Old' }, 404],
    ['nothing_here', { label: 'Nothing' }, 404],
  ]
  const answers = await Promise.all(cases.map(([name, body]) => call(s, 'PATCH', `${companies}/${name}`, { body })))
  expect(answers.map((a) => a.status)).toEqual(cases.map(([, , status]) => status))
  expect((await call(s, 'GET', `${companies}/plot_count`)).body).toMatchObject({
    name: 'plot_count',
    label: 'Plot count',
    hasUniqueValue: false,
    dataSensitivity: 'non_sensitive',
  })
  // A read-only definition still takes options unless they are read-only too, with its type and fieldType sent
  // unchanged; a changed fieldType is refused.
  const options = [{ value: 'x', label: 'X', displayOrder: 0, hidden: false }]
  expect((await call(s, 'PATCH', `${companies}/name`, { body: { options } })).status).toBe(200)
  const unchanged = { options, type: 'string', fieldType: 'text' }
  expect((await call(s, 'PATCH', `${companies}/name`, { body: unchanged })).status).toBe(200)
  const retyped = await call(s, 'PATCH', `${companies}/name`, { body: { ...unchanged, fieldType: 'textarea' } })
  expect(retyped.status).toBe(400)
  Object.assign(s.object(1_111_111, 'companies').properties.get('name')?.modificationMetadata ?? {}, {
    readOnlyOptions: true,
  })
  expect((await call(s, 'PATCH', `${companies}/name`, { body: { options } })).status).toBe(200)
  const more = [...options, { value: 'y', label: 'Y', displayOrder: 1, hidden: false }]
  expect((await call(s, 'PATCH', `${companies}/name`, { body: { options: more } })).status).toBe(400)
})

test('a DELETE archives: 204, then the property is in the archived list with archivedAt and gone from the active one', async () => {
  const s = sim()
  clock = Date.parse('2026-09-24T13:00:00.000Z')
  const deleted = await call(s, 'DELETE', `${companies}/plot_count`)
  expect(deleted.status).toBe(204)
  expect(deleted.body).toBeUndefined()
  expect(names((await call(s, 'GET', companies)).body)).not.toContain('plot_count')
  const archived = await call(s, 'GET', `${companies}/plot_count`, { query: { archived: 'true' } })
  expect(archived.body).toMatchObject({ archived: true, archivedAt: '2026-09-24T13:00:00.000Z' })
  expect((await call(s, 'GET', `${companies}/plot_count`)).status).toBe(404)
  expect((await call(s, 'DELETE', `${companies}/plot_count`)).status).toBe(404)
  expect((await call(s, 'DELETE', `${companies}/name`)).status).toBe(400)
})

test('a method the registry does not name for a path is 404 and changes nothing', async () => {
  const s = sim()
  const before = structuredClone(s.object(1_111_111, 'companies'))
  const answers = await Promise.all([
    call(s, 'POST', `${companies}/plot_count`, { body: newProperty }),
    call(s, 'PUT', `${companies}/plot_count`, { body: { label: 'Plots' } }),
    call(s, 'DELETE', companies),
    call(s, 'PATCH', companies, { body: { label: 'Plots' } }),
    call(s, 'PUT', `${groups}/orchard`, { body: { label: 'Orchard' } }),
  ])
  expect(answers.map((a) => a.status)).toEqual([404, 404, 404, 404, 404])
  expect(s.object(1_111_111, 'companies')).toEqual(before)
})

test('groups: the list leaves archived ones out, a create is 201 (of an archived name too), a PATCH takes label and displayOrder only', async () => {
  const s = sim()
  const listed = await call(s, 'GET', groups)
  // Observed: an archived group is not in the list.
  expect(listed.body).toEqual({
    results: [
      { name: 'orchard', label: 'Orchard details', displayOrder: 1, archived: false },
      { name: 'plots', label: 'Plots', displayOrder: -1, archived: false },
    ],
  })
  const created = await call(s, 'POST', groups, { body: { name: 'harvest_notes', label: 'Harvest notes' } })
  expect(created).toMatchObject({
    status: 201,
    body: { name: 'harvest_notes', label: 'Harvest notes', displayOrder: -1, archived: false },
  })
  expect(created.headers.get('location')).toBe('/crm/properties/2026-09/companies/groups/harvest_notes')
  expect((await call(s, 'POST', groups, { body: { name: 'orchard', label: 'Again' } })).status).toBe(409)
  expect((await call(s, 'POST', groups, { body: { name: 'no_label' } })).status).toBe(400)
  const patched = await call(s, 'PATCH', `${groups}/orchard`, { body: { label: 'Orchard', displayOrder: 3 } })
  expect(patched.body).toEqual({ name: 'orchard', label: 'Orchard', displayOrder: 3, archived: false })
  expect((await call(s, 'PATCH', `${groups}/orchard`, { body: { name: 'orchards' } })).status).toBe(400)
  expect((await call(s, 'PATCH', `${groups}/old_ledger`, { body: { label: 'x' } })).status).toBe(404)
  // Observed: a create of an archived group's name answers 201, and the group reads back with the new label.
  const reused = await call(s, 'POST', groups, { body: { name: 'old_ledger', label: 'Ledger again' } })
  expect(reused).toMatchObject({ status: 201, body: { name: 'old_ledger', label: 'Ledger again', archived: false } })
  expect(names((await call(s, 'GET', groups)).body)).toContain('old_ledger')
  expect((await call(s, 'DELETE', `${groups}/harvest_notes`)).status).toBe(204)
  expect(names((await call(s, 'GET', groups)).body)).not.toContain('harvest_notes')
  expect(s.object(1_111_111, 'companies').groups.get('harvest_notes')?.archived).toBe(true)
})

test('deleting a group that holds an active property is refused with the observed 400, its body nested in message', async () => {
  const s = sim()
  const refused = await call(s, 'DELETE', `${groups}/plots`)
  expect(refused).toMatchObject({ status: 400, body: { status: 'error', correlationId: expect.stringMatching(uuid) } })
  expect(JSON.parse(refused.body.message)).toEqual({
    status: 'error',
    message: "Can't delete or purge a group with active properties",
    correlationId: refused.body.correlationId,
    category: 'VALIDATION_ERROR',
    subCategory: 'PropertyGroupError.GROUP_WITH_ACTIVE_PROPERTIES',
  })
})

test.each([
  ['reject', 400, false, false],
  ['archive-members', 204, true, true],
  ['leave', 204, true, false],
] as const)(
  'deleting a group that holds properties, configured %s',
  async (groupDelete, status, groupArchived, membersArchived) => {
    const s = sim({ groupDelete })
    expect((await call(s, 'DELETE', `${groups}/plots`)).status).toBe(status)
    const model = s.object(1_111_111, 'companies')
    expect(model.groups.get('plots')?.archived).toBe(groupArchived)
    expect(model.properties.get('plot_count')?.archived).toBe(membersArchived)
    expect(model.properties.get('plot_count')?.groupName).toBe('plots')
  },
)

test('every answer carries rate-limit headers; the daily remainder counts down, or is left out', async () => {
  const s = sim({ dailyRemaining: 500 })
  const first = await call(s, 'GET', companies)
  const second = await call(s, 'GET', companies)
  expect(first.headers.get('x-hubspot-ratelimit-max')).toBe('190')
  expect(first.headers.get('x-hubspot-ratelimit-interval-milliseconds')).toBe('10000')
  expect(first.headers.get('x-hubspot-ratelimit-daily-remaining')).toBe('499')
  expect(second.headers.get('x-hubspot-ratelimit-daily-remaining')).toBe('498')
  const silent = sim({ dailyRemaining: null })
  const answer = await call(silent, 'GET', companies)
  expect(answer.headers.get('x-hubspot-ratelimit-daily-remaining')).toBeNull()
  expect(answer.headers.get('x-hubspot-ratelimit-remaining')).toBe('189')
})

test('a status fault answers instead of the model, and with apply the change lands first', async () => {
  const s = sim()
  s.fault({ method: 'POST', path: companies, occurrence: 1, action: fault.status(502) })
  s.fault({
    method: 'POST',
    path: companies,
    occurrence: 2,
    action: fault.status(502, { message: 'Bad gateway' }, { apply: true }),
  })
  const first = await call(s, 'POST', companies, { body: newProperty })
  expect(first.status).toBe(502)
  expect(names((await call(s, 'GET', companies)).body)).not.toContain('soil_ph')
  const second = await call(s, 'POST', companies, { body: newProperty })
  expect(second).toMatchObject({ status: 502, body: { message: 'Bad gateway' } })
  expect(names((await call(s, 'GET', companies)).body)).toContain('soil_ph')
  // The rules are spent: the third create meets the model, which already holds the name.
  expect((await call(s, 'POST', companies, { body: newProperty })).status).toBe(409)
})

test('a rule matches its method, an exact path or a pattern, and its occurrence among matching requests', async () => {
  const s = sim()
  s.fault({
    path: endsWithGroups,
    occurrence: 2,
    action: fault.status(429, { policyName: 'SECONDLY' }, { headers: { 'retry-after': '2' } }),
  })
  s.fault({ method: 'DELETE', path: `${companies}/plot_count`, action: fault.status(423) })
  expect((await call(s, 'GET', groups)).status).toBe(200)
  const limited = await call(s, 'GET', groups)
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBe('2')
  expect((await call(s, 'GET', groups)).status).toBe(200)
  expect((await call(s, 'GET', `${companies}/plot_count`)).status).toBe(200)
  expect((await call(s, 'DELETE', `${companies}/plot_count`)).status).toBe(423)
  expect((await call(s, 'DELETE', `${companies}/plot_count`)).status).toBe(423)
  expect(s.log.map((entry) => entry.status)).toEqual([200, 429, 200, 200, 423, 423])
})

test('a timeout fault never settles, rejects when its signal aborts, and with apply the change lands', async () => {
  const s = sim()
  s.fault({ method: 'POST', path: companies, occurrence: 1, action: fault.timeout() })
  s.fault({ method: 'POST', path: companies, occurrence: 2, action: fault.timeout({ apply: true }) })
  const controller = new AbortController()
  let settled = false
  const pending = call(s, 'POST', companies, { body: newProperty, signal: controller.signal }).finally(() => {
    settled = true
  })
  pending.catch(() => undefined)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(settled).toBe(false)
  controller.abort(new DOMException('timed out', 'TimeoutError'))
  await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
  expect(names((await call(s, 'GET', companies)).body)).not.toContain('soil_ph')
  const second = new AbortController()
  const applied = call(s, 'POST', companies, { body: newProperty, signal: second.signal })
  applied.catch(() => undefined)
  second.abort()
  await expect(applied).rejects.toMatchObject({ name: 'AbortError' })
  expect(names((await call(s, 'GET', companies)).body)).toContain('soil_ph')
  expect(s.log.filter((entry) => entry.method === 'POST').map((entry) => entry.status)).toEqual([null, null])
})

test('a timeout fault whose signal is already aborted rejects at once, as fetch does', async () => {
  const s = sim()
  s.fault({ method: 'POST', path: companies, action: fault.timeout() })
  const controller = new AbortController()
  controller.abort(new DOMException('timed out', 'TimeoutError'))
  await expect(call(s, 'POST', companies, { body: newProperty, signal: controller.signal })).rejects.toMatchObject({
    name: 'TimeoutError',
  })
})

test('a throw fault rejects as a network failure does, with or without the change', async () => {
  const s = sim()
  s.fault({ method: 'PATCH', path: `${companies}/plot_count`, occurrence: 1, action: fault.throw() })
  s.fault({
    method: 'PATCH',
    path: `${companies}/plot_count`,
    occurrence: 2,
    action: fault.throw({ apply: true, message: 'socket hang up' }),
  })
  await expect(call(s, 'PATCH', `${companies}/plot_count`, { body: { label: 'Plots' } })).rejects.toThrow(TypeError)
  expect(s.object(1_111_111, 'companies').properties.get('plot_count')?.label).toBe('Plot count')
  await expect(call(s, 'PATCH', `${companies}/plot_count`, { body: { label: 'Plots' } })).rejects.toThrow(
    'socket hang up',
  )
  expect(s.object(1_111_111, 'companies').properties.get('plot_count')?.label).toBe('Plots')
})

test('a lag fault on a create: the next reads of it are 404 or leave it out, then it shows', async () => {
  const s = sim()
  s.fault({ method: 'POST', path: companies, action: fault.lag(2) })
  expect((await call(s, 'POST', companies, { body: newProperty })).status).toBe(201)
  expect((await call(s, 'GET', `${companies}/soil_ph`)).status).toBe(404)
  expect(names((await call(s, 'GET', companies)).body)).not.toContain('soil_ph')
  expect((await call(s, 'GET', `${companies}/soil_ph`)).status).toBe(200)
  expect(names((await call(s, 'GET', companies)).body)).toContain('soil_ph')
})

test('a lag fault on a change or a delete: the next reads show the old state', async () => {
  const s = sim()
  s.fault({ method: 'PATCH', path: `${groups}/orchard`, action: fault.lag(1) })
  s.fault({ method: 'DELETE', path: `${companies}/plot_count`, action: fault.lag(1) })
  s.fault({ method: 'PATCH', path: `${companies}/yield_tier`, action: fault.lag(1) })
  const orchard = async () => {
    const { results } = (await call(s, 'GET', groups)).body as { results: { name: string; label: string }[] }
    return results.find((g) => g.name === 'orchard')?.label
  }
  await call(s, 'PATCH', `${groups}/orchard`, { body: { label: 'Orchard' } })
  expect(await orchard()).toBe('Orchard details')
  expect(await orchard()).toBe('Orchard')
  await call(s, 'DELETE', `${companies}/plot_count`)
  expect((await call(s, 'GET', `${companies}/plot_count`, { query: { archived: 'true' } })).status).toBe(404)
  expect((await call(s, 'GET', `${companies}/plot_count`, { query: { archived: 'true' } })).status).toBe(200)
  await call(s, 'PATCH', `${companies}/yield_tier`, { body: { label: 'Yield tier' } })
  expect((await call(s, 'GET', `${companies}/yield_tier`)).body).toMatchObject({ label: 'Yield band' })
  expect((await call(s, 'GET', `${companies}/yield_tier`)).body).toMatchObject({ label: 'Yield tier' })
})

test('the read and write clients run against it: a create is ok, and a timeout is uncertain and lands nothing', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const s = sim()
  const write = createWriteHttp({ key: writeKey, fetch: s.fetch, warn: () => undefined, allow: MILESTONE_3_WRITES })
  const outcome = await write.send({
    type: 'property',
    path: 'create',
    params: { objectType: 'companies' },
    body: newProperty,
  })
  expect(outcome).toMatchObject({ kind: 'ok', status: 201, body: { name: 'soil_ph' } })
  expect(write.dailyRemaining).toBe(999_999)
  s.fault({ method: 'POST', path: companies, action: fault.timeout() })
  const pending = write.send({
    type: 'property',
    path: 'create',
    params: { objectType: 'companies' },
    body: { ...newProperty, name: 'soil_type' },
  })
  await vi.advanceTimersByTimeAsync(30_000)
  await expect(pending).resolves.toEqual({ kind: 'uncertain', reason: 'timeout' })
  const read = createHttp({ key: sandboxKey, fetch: s.fetch, warn: () => undefined })
  const listed = await read.request<{ results: { name: string }[] }>({
    type: 'property',
    path: 'list',
    params: { objectType: 'companies' },
  })
  expect(listed.results.map((r) => r.name)).toEqual(['plot_count', 'yield_tier', 'name', 'soil_ph'])
  expect(s.log.map((entry) => `${entry.method} ${entry.key} ${entry.status}`)).toEqual([
    'POST HUBSPOT_SANDBOX_WRITE_KEY 201',
    'POST HUBSPOT_SANDBOX_WRITE_KEY null',
    'GET HUBSPOT_SANDBOX_KEY 200',
  ])
})

test('token introspection: the scopes a key the portal names scopes for holds, with oauth and the .v2 sensitive suffix; 404 for a key without a list; 400 for another key in the body', async () => {
  const s = sim({
    scopes: {
      HUBSPOT_SANDBOX_KEY: ['crm.schemas.companies.read', 'crm.objects.companies.sensitive.write'],
    },
  })
  const path = '/oauth/v2/private-apps/get/access-token-info'
  const known = await call(s, 'POST', path, { key: sandboxKey, body: { tokenKey: sandboxKey } })
  expect(known).toMatchObject({
    status: 200,
    body: {
      hubId: 1_111_111,
      isUserToken: false,
      scopes: ['oauth', 'crm.schemas.companies.read', 'crm.objects.companies.sensitive.write.v2'],
    },
  })
  // The log keeps the variable where the body held the key, and the POST is no write.
  const logged = s.log.at(-1)
  expect(logged?.body).toEqual({ tokenKey: 'HUBSPOT_SANDBOX_KEY' })
  expect(JSON.stringify(s.log)).not.toContain(sandboxKey)
  expect(s.writes()).toEqual([])
  expect((await call(s, 'POST', path, { key: sandboxKey, body: { tokenKey: 'another-key' } })).status).toBe(400)
  expect((await call(s, 'GET', path, { key: sandboxKey })).status).toBe(405)
  const unlisted = sim()
  expect((await call(unlisted, 'POST', path, { body: { tokenKey: sandboxKey } })).status).toBe(404)
})
