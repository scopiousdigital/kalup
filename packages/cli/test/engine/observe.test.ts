import type { Coverage, Loaded, ObjectCoverage, Override } from '@kalup/core'
import { expect, test } from 'vitest'
import { project } from '../../src/commands/testing.js'
import { compare } from '../../src/engine/compare.js'
import {
  configObservation,
  NOT_CAPTURED,
  type Observation,
  objectTypeIds,
  observeTarget,
  type Status,
  statusOf,
} from '../../src/engine/observe.js'
import { createHttp, type Fetch } from '../../src/lib/http.js'
import { load } from '../../src/lib/load.js'
import { fakeFetch, fixture, jsonResponse, portalBody, route } from '../../src/lib/testing.js'

const rate = {
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}

const routes = {
  schemas: '/crm-object-schemas/2026-09/schemas',
  companies: '/crm/properties/2026-09/companies',
  companyGroups: '/crm/properties/2026-09/companies/groups',
  harvest: '/crm/properties/2026-09/2-4242001',
  harvestGroups: '/crm/properties/2026-09/2-4242001/groups',
}
const sensitive = '?dataSensitivity=sensitive'
const highlySensitive = '?dataSensitivity=highly_sensitive'

type Bodies = Record<string, unknown>
type Item = Record<string, unknown>

// The pull fixture project: companies (standard, include name and lifecyclestage) and harvest (a defineCustomObject),
// read against the orchard portal.
const pulled = load(project('pull'))

function orchard(): Bodies {
  return {
    [routes.schemas]: fixture('api/orchard/schemas.json'),
    [routes.companies]: fixture('api/orchard/companies.properties.json'),
    [routes.companyGroups]: fixture('api/orchard/companies.groups.json'),
    [routes.harvest]: fixture('api/orchard/harvest.properties.json'),
    [routes.harvestGroups]: fixture('api/orchard/harvest.groups.json'),
  }
}

function edit(bodies: Bodies, at: string, change: (item: Item) => Item | Item[]): Bodies {
  const list = bodies[at] as { results: Item[] }
  bodies[at] = { results: list.results.flatMap(change) }
  return bodies
}

interface Observe {
  bodies?: Bodies
  loaded?: Loaded
  overrides?: Record<string, Override>
  refused?: string[]
}

// Observes target sandbox of the pull project on the orchard portal, some routes refused (403).
function observe({ bodies = orchard(), loaded = pulled, overrides, refused = [] }: Observe = {}) {
  const fetch: Fetch = (url, init) => {
    const body = refused.includes(route(url))
      ? jsonResponse(403, fixture('errors/missing-scope.json'))
      : jsonResponse(200, portalBody(bodies, url), rate)
    return fakeFetch(body).fetch(url, init)
  }
  const http = createHttp({ key: 'kalup-test-secret-9f2c', fetch, warn: () => undefined })
  const { sandbox } = loaded.config.targets
  const overridden = overrides
    ? { ...loaded, config: { ...loaded.config, targets: { sandbox: { ...sandbox, overrides } } } }
    : loaded
  return observeTarget(http, overridden, 'sandbox')
}

function withObjects(objects: Loaded['config']['objects']): Loaded {
  return { ...pulled, config: { ...pulled.config, objects } }
}

function coverageOf(observation: Observation): Coverage {
  if (!observation.coverage) {
    throw new Error('a target observation carries coverage')
  }
  return observation.coverage
}

function covered(observation: Observation, key: string): ObjectCoverage {
  const found = coverageOf(observation).objects[key]
  if (!found) {
    throw new Error(`${key} has no coverage`)
  }
  return found
}

const plotShape = {
  name: 'plot_shape',
  type: 'object_coordinates',
  fieldType: 'text',
  label: 'Plot shape',
  group: { $ref: 'group:companies/orchard' },
  hubspotDefined: false,
}

test('a complete read: every captured resource under its address, and the coverage that proves it', async () => {
  const { observation, archivedGroups, issues } = await observe()
  expect(observation.side).toEqual({ kind: 'target', name: 'sandbox', portalId: 1_111_111 })
  expect(Object.keys(observation.resources)).toEqual([
    'group:companies/companyinformation',
    'group:companies/orchard',
    'group:companies/plots',
    'group:harvest/harvest_details',
    'group:harvest/harvestinformation',
    'object:harvest',
    'property:companies/irrigation_notes',
    'property:companies/lifecyclestage',
    'property:companies/name',
    'property:companies/plot_count',
    'property:companies/plot_tags',
    'property:companies/plot_total',
    'property:companies/pruned',
    'property:companies/row_meta',
    'property:companies/soil_ph',
    'property:companies/yield_tier',
    'property:harvest/batch_code',
    'property:harvest/orchard_ref',
    'property:harvest/picked_on',
    'property:harvest/weight_kg',
  ])
  expect(observation.coverage).toEqual({
    complete: true,
    notCaptured: NOT_CAPTURED,
    objects: {
      companies: { status: 'read', outOfScope: ['domain', 'hs_lastmodifieddate'], unsupported: [plotShape] },
      harvest: { status: 'read', objectTypeId: '2-4242001', outOfScope: ['hs_object_id'] },
    },
    otherObjects: ['press_run'],
  })
  expect(archivedGroups).toEqual({ companies: ['old_ledger'], harvest: [] })
  expect(issues.map((i) => i.code)).toEqual(['W_UNSUPPORTED_TYPE'])
})

test('captured resources carry the IR shape: managed definitions, references with options only, the schema', async () => {
  const { resources } = (await observe()).observation
  expect(resources['group:companies/orchard']).toEqual({
    type: 'group',
    managed: true,
    definition: { label: 'Orchard details' },
  })
  expect(resources['property:companies/yield_tier']).toEqual({
    type: 'property',
    managed: true,
    definition: {
      label: 'Yield band',
      group: { $ref: 'group:companies/orchard' },
      type: 'enumeration',
      fieldType: 'select',
      description: 'Set by the yield sync',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'HIGH', label: 'High' },
        { value: 'peak', label: 'Peak', hidden: true },
      ],
    },
  })
  expect(resources['property:companies/irrigation_notes']?.definition).toEqual({
    label: 'Irrigation notes',
    group: { $ref: 'group:companies/orchard' },
    type: 'string',
    fieldType: 'textarea',
    formField: true,
  })
  expect(resources['property:harvest/batch_code']?.definition).toMatchObject({ type: 'string', hasUniqueValue: true })
  expect(resources['property:companies/pruned']?.definition).toMatchObject({ type: 'bool' })
  // HubSpot-defined, and a calculated custom property: references, the enumeration keeping its options.
  expect(resources['property:companies/name']).toEqual({ type: 'property', managed: false })
  expect(resources['property:companies/soil_ph']).toEqual({ type: 'property', managed: false })
  expect(resources['property:companies/lifecyclestage']).toEqual({
    type: 'property',
    managed: false,
    definition: {
      options: [
        { value: 'subscriber', label: 'Subscriber' },
        { value: 'lead', label: 'Lead' },
        { value: 'customer', label: 'Customer' },
      ],
    },
  })
  expect(resources['object:harvest']).toEqual({
    type: 'object',
    managed: true,
    definition: {
      labels: { singular: 'Harvest', plural: 'Harvests' },
      primaryDisplayProperty: 'batch_code',
      requiredProperties: ['batch_code'],
      searchableProperties: ['batch_code', 'orchard_ref'],
      secondaryDisplayProperties: ['picked_on'],
    },
  })
})

test('a reference keeps each option hidden flag and description', async () => {
  const bodies = edit(orchard(), routes.companies, (p) =>
    p.name === 'lifecyclestage'
      ? {
          ...p,
          options: [
            { label: 'Lead', value: 'lead', displayOrder: 0, hidden: false, description: 'Asked for a quote' },
            { label: 'Customer', value: 'customer', displayOrder: 1, hidden: true, description: '' },
          ],
        }
      : p,
  )
  const { resources } = (await observe({ bodies })).observation
  expect(resources['property:companies/lifecyclestage']?.definition).toEqual({
    options: [
      { value: 'lead', label: 'Lead', description: 'Asked for a quote' },
      { value: 'customer', label: 'Customer', hidden: true },
    ],
  })
})

test('an object schema with no empty display lists keeps them empty, as HubSpot returned them', async () => {
  const bodies = edit(orchard(), routes.schemas, (s) =>
    s.name === 'harvest' ? { ...s, searchableProperties: [], secondaryDisplayProperties: [] } : s,
  )
  const { resources } = (await observe({ bodies })).observation
  expect(resources['object:harvest']?.definition).toMatchObject({
    searchableProperties: [],
    secondaryDisplayProperties: [],
  })
})

test('portal strings stay exact: a label with control characters is not sanitized', async () => {
  const label = `Orchard ${String.fromCodePoint(0x9b)}31m details${String.fromCodePoint(0x20_28)}`
  const bodies = edit(orchard(), routes.companyGroups, (g) => (g.name === 'orchard' ? { ...g, label } : g))
  const { resources } = (await observe({ bodies })).observation
  expect(resources['group:companies/orchard']?.definition).toEqual({ label })
})

test('the three sensitivity lists are merged: sensitive and highly sensitive properties are captured', async () => {
  const bodies = orchard()
  bodies[`${routes.companies}${sensitive}`] = fixture('api/orchard/companies.sensitive.json')
  bodies[`${routes.harvest}${highlySensitive}`] = {
    results: [
      {
        name: 'buyer_iban',
        label: 'Buyer IBAN',
        type: 'string',
        fieldType: 'text',
        groupName: 'harvest_details',
        dataSensitivity: 'highly_sensitive',
      },
    ],
  }
  const { observation } = await observe({ bodies })
  expect(observation.resources['property:companies/grower_tax_ref']?.definition).toEqual({
    label: 'Grower tax reference',
    group: { $ref: 'group:companies/orchard' },
    type: 'string',
    fieldType: 'text',
  })
  expect(statusOf(observation, 'property:harvest/buyer_iban')).toBe('present')
})

test('meta holds, per property read under an address, its list, HubSpot flags and times, and raw option order', async () => {
  const bodies = orchard()
  bodies[`${routes.companies}${sensitive}`] = fixture('api/orchard/companies.sensitive.json')
  bodies[`${routes.harvest}${highlySensitive}`] = {
    results: [
      {
        name: 'buyer_iban',
        label: 'Buyer IBAN',
        type: 'string',
        fieldType: 'text',
        groupName: 'harvest_details',
        dataSensitivity: 'highly_sensitive',
        modificationMetadata: {
          archivable: false,
          readOnlyDefinition: false,
          readOnlyValue: false,
          readOnlyOptions: true,
        },
      },
    ],
  }
  const { meta, resources, coverage } = (await observe({ bodies })).observation
  // Every property of both objects, captured or not (domain is out of scope, plot_shape unsupported), sorted.
  expect(Object.keys(meta ?? {})).toEqual([
    'property:companies/domain',
    'property:companies/grower_tax_ref',
    'property:companies/hs_lastmodifieddate',
    'property:companies/irrigation_notes',
    'property:companies/lifecyclestage',
    'property:companies/name',
    'property:companies/plot_count',
    'property:companies/plot_shape',
    'property:companies/plot_tags',
    'property:companies/plot_total',
    'property:companies/pruned',
    'property:companies/row_meta',
    'property:companies/soil_ph',
    'property:companies/yield_tier',
    'property:harvest/batch_code',
    'property:harvest/buyer_iban',
    'property:harvest/hs_object_id',
    'property:harvest/orchard_ref',
    'property:harvest/picked_on',
    'property:harvest/weight_kg',
  ])
  expect(meta?.['property:companies/yield_tier']).toEqual({
    sensitivity: 'non_sensitive',
    hubspotDefined: false,
    modificationMetadata: { archivable: true, readOnlyDefinition: false },
    createdAt: '2026-03-02T10:00:00.000Z',
    updatedAt: '2026-09-14T09:12:41.118Z',
    options: [
      { value: 'peak', displayOrder: -1 },
      { value: 'low', displayOrder: 0 },
      { value: 'HIGH', displayOrder: 1 },
    ],
  })
  expect(meta?.['property:companies/grower_tax_ref']).toMatchObject({ sensitivity: 'sensitive' })
  expect(meta?.['property:companies/name']?.modificationMetadata).toEqual({
    archivable: true,
    readOnlyDefinition: true,
  })
  // A reference is HubSpot-defined or calculated; which one decides whether include is needed to pull it.
  expect(meta?.['property:companies/name']?.hubspotDefined).toBe(true)
  expect(meta?.['property:companies/soil_ph']?.hubspotDefined).toBe(false)
  expect(meta?.['property:harvest/buyer_iban']).toEqual({
    sensitivity: 'highly_sensitive',
    modificationMetadata: { archivable: false, readOnlyDefinition: false, readOnlyOptions: true },
  })
  // None of it reaches the resources or the coverage a snapshot records, where notCaptured still names the fields.
  const recorded = JSON.stringify({ resources, coverage })
  for (const word of ['modificationMetadata', 'sensitivity', 'createdAt', 'displayOrder']) {
    expect(recorded).not.toContain(`"${word}":`)
  }
})

test('meta is keyed by address after name overrides, and leaves out what an override skips or shadows', async () => {
  const bodies = edit(orchard(), routes.companies, (p) => (p.name === 'plot_tags' ? { ...p, name: 'tags' } : p))
  const overrides: Record<string, Override> = {
    'property:companies/plot_tags': { name: 'tags' },
    'property:companies/row_meta': { skip: true },
    'property:harvest/batch_code': { name: 'batch_code_v2' },
  }
  const { meta } = (await observe({ bodies, overrides })).observation
  expect(meta?.['property:companies/plot_tags']).toMatchObject({ sensitivity: 'non_sensitive' })
  expect(meta?.['property:companies/tags']).toBeUndefined()
  expect(meta?.['property:companies/row_meta']).toBeUndefined()
  expect(meta?.['property:harvest/batch_code']).toBeUndefined()
})

test('the config side has no meta', () => {
  expect(configObservation(pulled).meta).toBeUndefined()
})

test.each([
  ['the sensitive list', `${routes.companies}${sensitive}`],
  ['the highly sensitive list', `${routes.companies}${highlySensitive}`],
  ['the properties list', routes.companies],
  ['the groups list', routes.companyGroups],
])('a 403 on %s leaves the object unreadable, and the read incomplete', async (_, refused) => {
  const { observation, issues } = await observe({ refused: [refused] })
  const coverage = coverageOf(observation)
  expect(coverage.complete).toBe(false)
  expect(coverage.objects.companies).toEqual({
    status: 'unreadable',
    missingScope: 'crm.schemas.companies.read',
    issue: 'E_SCOPE',
  })
  expect(covered(observation, 'harvest').status).toBe('read')
  expect(Object.keys(observation.resources).filter((a) => a.includes(':companies/'))).toEqual([])
  expect(statusOf(observation, 'property:companies/yield_tier')).toBe('unreadable')
  expect(statusOf(observation, 'group:companies/orchard')).toBe('unreadable')
  expect(issues.map((i) => i.code)).toContain('E_SCOPE')
})

test('a 403 on a custom object properties list names the custom scope', async () => {
  const coverage = coverageOf((await observe({ refused: [routes.harvest] })).observation)
  expect(coverage.objects.harvest).toEqual({
    status: 'unreadable',
    missingScope: 'crm.schemas.custom.read',
    issue: 'E_SCOPE',
  })
  expect(coverage.otherObjects).toEqual(['press_run'])
})

test('a 403 on the schemas list: every custom object is unreadable and other objects are unknown', async () => {
  const { observation } = await observe({ refused: [routes.schemas] })
  expect(coverageOf(observation)).toMatchObject({
    complete: false,
    objects: {
      companies: { status: 'read' },
      harvest: { status: 'unreadable', missingScope: 'crm.schemas.custom.read', issue: 'E_SCOPE' },
    },
    otherObjects: 'unknown',
  })
  expect(statusOf(observation, 'object:harvest')).toBe('unreadable')
  expect(statusOf(observation, 'property:harvest/batch_code')).toBe('unreadable')
})

test('a custom object config defines and the portal lacks is absent, with its groups and properties', async () => {
  const bodies = edit(orchard(), routes.schemas, (s) => (s.name === 'harvest' ? [] : s))
  const { observation } = await observe({ bodies })
  expect(coverageOf(observation)).toMatchObject({
    complete: true,
    objects: { harvest: { status: 'absent' } },
    otherObjects: ['press_run'],
  })
  expect(coverageOf(observation).objects.harvest).toEqual({ status: 'absent' })
  expect(statusOf(observation, 'object:harvest')).toBe('absent')
  expect(statusOf(observation, 'group:harvest/harvest_details')).toBe('absent')
  expect(statusOf(observation, 'property:harvest/batch_code')).toBe('absent')
})

test('an include name the portal lacks is absent, not an error', async () => {
  const loaded = withObjects({ companies: { include: ['name', 'lifecyclestage', 'nope'] }, harvest: {} })
  const { observation } = await observe({ loaded })
  expect(statusOf(observation, 'property:companies/nope')).toBe('absent')
  expect(coverageOf(observation).complete).toBe(true)
})

test('scope: a property is captured when the pull scope asks for it or config names it, else out of scope', async () => {
  const loaded = withObjects({ companies: { custom: false }, harvest: { include: ['hs_object_id'] } })
  const { observation } = await observe({ loaded })
  const companies = covered(observation, 'companies')
  // Config names lifecyclestage, name, plot_tags, plot_total, row_meta and yield_tier on companies.
  expect(companies.outOfScope).toEqual([
    'domain',
    'hs_lastmodifieddate',
    'irrigation_notes',
    'plot_count',
    'plot_shape',
    'pruned',
    'soil_ph',
  ])
  expect(companies.unsupported).toBeUndefined()
  expect(covered(observation, 'harvest').outOfScope).toBeUndefined()
  expect(statusOf(observation, 'property:companies/yield_tier')).toBe('present')
  expect(statusOf(observation, 'property:companies/pruned')).toBe('excluded')
  expect(statusOf(observation, 'property:companies/plot_shape')).toBe('excluded')
  expect(statusOf(observation, 'property:harvest/hs_object_id')).toBe('present')
})

test('an unsupported property is present in coverage only, its options normalized', async () => {
  const bodies = edit(orchard(), routes.companies, (p) =>
    p.name === 'plot_shape'
      ? {
          ...p,
          name: 'grade_mix',
          label: 'Grade mix',
          type: 'enumeration',
          fieldType: 'tags',
          description: 'Share of each grade',
          groupName: 'plots',
          hubspotDefined: false,
          options: [
            { label: 'Second', value: 'b', displayOrder: 1, hidden: false },
            { label: 'First', value: 'a', displayOrder: 0, hidden: true, description: 'Best fruit' },
          ],
        }
      : p,
  )
  const { observation, issues } = await observe({ bodies })
  expect(covered(observation, 'companies').unsupported).toEqual([
    {
      name: 'grade_mix',
      type: 'enumeration',
      fieldType: 'tags',
      label: 'Grade mix',
      group: { $ref: 'group:companies/plots' },
      description: 'Share of each grade',
      options: [
        { value: 'a', label: 'First', hidden: true, description: 'Best fruit' },
        { value: 'b', label: 'Second' },
      ],
      hubspotDefined: false,
    },
  ])
  expect(observation.resources['property:companies/grade_mix']).toBeUndefined()
  expect(statusOf(observation, 'property:companies/grade_mix')).toBe('unsupported')
  expect(issues.map((i) => i.code)).toEqual(['W_UNSUPPORTED_TYPE'])
})

test('unsupported properties are listed sorted by name', async () => {
  const bodies = edit(orchard(), routes.companies, (p) =>
    p.name === 'plot_shape' ? [{ ...p, name: 'zone_shape' }, p, { ...p, name: 'bed_shape' }] : p,
  )
  const { unsupported } = covered((await observe({ bodies })).observation, 'companies')
  expect(unsupported?.map((u) => u.name)).toEqual(['bed_shape', 'plot_shape', 'zone_shape'])
})

test('archived groups are not resources; they come back apart from the observation', async () => {
  const { observation, archivedGroups } = await observe()
  expect(statusOf(observation, 'group:companies/old_ledger')).toBe('absent')
  expect(archivedGroups.companies).toEqual(['old_ledger'])
})

test('a schema without a singular or plural label is recorded as unsupported, not written as a resource', async () => {
  const bodies = edit(orchard(), routes.schemas, (s) =>
    s.name === 'harvest' ? { ...s, labels: { plural: 'Harvests' } } : s,
  )
  const { observation } = await observe({ bodies })
  expect(observation.resources['object:harvest']).toBeUndefined()
  expect(coverageOf(observation).objects.harvest).toEqual({
    status: 'read',
    objectTypeId: '2-4242001',
    outOfScope: ['hs_object_id'],
    unsupportedSchema: {
      labels: { plural: 'Harvests' },
      primaryDisplayProperty: 'batch_code',
      requiredProperties: ['batch_code'],
      searchableProperties: ['batch_code', 'orchard_ref'],
      secondaryDisplayProperties: ['picked_on'],
    },
  })
  expect(coverageOf(observation).complete).toBe(true)
  expect(statusOf(observation, 'object:harvest')).toBe('unsupported')
  expect(statusOf(observation, 'property:harvest/batch_code')).toBe('present')

  const none = edit(orchard(), routes.schemas, (s) => {
    const { labels: _labels, ...rest } = s
    return s.name === 'harvest' ? rest : s
  })
  const bare = (await observe({ bodies: none })).observation
  expect(covered(bare, 'harvest').unsupportedSchema?.labels).toEqual({})
  expect(statusOf(bare, 'object:harvest')).toBe('unsupported')
})

test('skip overrides: excluded addresses are listed per object and never read or captured', async () => {
  const { observation } = await observe({
    overrides: {
      'object:harvest': { skip: true },
      'group:companies/orchard': { skip: true },
      'property:companies/name': { skip: true },
    },
  })
  const coverage = coverageOf(observation)
  expect(coverage).toMatchObject({ complete: true, otherObjects: 'unknown' })
  expect(coverage.objects.harvest).toEqual({ status: 'excluded', excluded: ['object:harvest'] })
  expect(covered(observation, 'companies').excluded).toEqual([
    'group:companies/orchard',
    'property:companies/harvest_window',
    'property:companies/name',
    'property:companies/plot_tags',
    'property:companies/plot_total',
    'property:companies/row_meta',
    'property:companies/yield_tier',
  ])
  expect(observation.resources['group:companies/orchard']).toBeUndefined()
  expect(observation.resources['property:companies/yield_tier']).toBeUndefined()
  // A portal property in the skipped group that config does not name is still read.
  expect(statusOf(observation, 'property:companies/irrigation_notes')).toBe('present')
  const statuses = Object.fromEntries(
    ['object:harvest', 'property:harvest/batch_code', 'group:companies/orchard', 'property:companies/name'].map(
      (address) => [address, statusOf(observation, address)],
    ),
  )
  expect(statuses).toEqual({
    'object:harvest': 'excluded',
    'property:harvest/batch_code': 'excluded',
    'group:companies/orchard': 'excluded',
    'property:companies/name': 'excluded',
  })
})

test('a name override reports the portal resource N at the address and records the rename', async () => {
  const bodies = edit(orchard(), routes.harvest, (p) => (p.name === 'picked_on' ? { ...p, name: 'pickedon' } : p))
  const { observation } = await observe({ bodies, overrides: { 'property:harvest/picked_on': { name: 'pickedon' } } })
  expect(observation.resources['property:harvest/picked_on']?.definition).toMatchObject({ label: 'Picked on' })
  expect(observation.resources['property:harvest/pickedon']).toBeUndefined()
  expect(coverageOf(observation).objects.harvest).toEqual({
    status: 'read',
    objectTypeId: '2-4242001',
    outOfScope: ['hs_object_id'],
    renamed: { 'property:harvest/picked_on': 'pickedon' },
  })
  expect(statusOf(observation, 'property:harvest/picked_on')).toBe('present')
})

test('a skip wins over a name override on the same address: excluded, not renamed', async () => {
  const { observation } = await observe({
    overrides: { 'property:harvest/picked_on': { skip: true, name: 'pickedon' } },
  })
  expect(covered(observation, 'harvest')).toEqual({
    status: 'read',
    objectTypeId: '2-4242001',
    outOfScope: ['hs_object_id'],
    excluded: ['property:harvest/picked_on'],
  })
  expect(statusOf(observation, 'property:harvest/picked_on')).toBe('excluded')
})

test('a name override whose portal name is missing: the address is absent and its own name shadowed', async () => {
  const { observation } = await observe({
    overrides: {
      'property:harvest/picked_on': { name: 'pickedon' },
      'group:harvest/harvest_details': { name: 'details' },
    },
  })
  expect(coverageOf(observation).objects.harvest).toEqual({
    status: 'read',
    objectTypeId: '2-4242001',
    outOfScope: ['hs_object_id'],
    shadowed: ['harvest_details', 'picked_on'],
    renamed: { 'group:harvest/harvest_details': 'details', 'property:harvest/picked_on': 'pickedon' },
  })
  expect(observation.resources['property:harvest/picked_on']).toBeUndefined()
  expect(statusOf(observation, 'property:harvest/picked_on')).toBe('absent')
  expect(statusOf(observation, 'group:harvest/harvest_details')).toBe('absent')
})

test('a shadowed portal name another resource refers to is recorded as shadowed:<name>, never as the config name', async () => {
  const group = (await observe({ overrides: { 'group:companies/orchard': { name: 'orchard_v2' } } })).observation
  const shadowedGroup = { $ref: 'group:companies/shadowed:orchard' }
  expect(group.resources['group:companies/orchard']).toBeUndefined()
  expect(group.resources['property:companies/plot_total']?.definition?.group).toEqual(shadowedGroup)
  expect(covered(group, 'companies').unsupported?.map((u) => u.group)).toEqual([shadowedGroup])
  // A group another override renames is that address, not a shadow.
  const renamed = (await observe({ overrides: { 'group:companies/legacy': { name: 'plots' } } })).observation
  expect(renamed.resources['property:companies/plot_count']?.definition?.group).toEqual({
    $ref: 'group:companies/legacy',
  })

  const property = (await observe({ overrides: { 'property:harvest/batch_code': { name: 'batch_code_v2' } } }))
    .observation
  expect(property.resources['property:harvest/batch_code']).toBeUndefined()
  expect(property.resources['object:harvest']?.definition).toEqual({
    labels: { singular: 'Harvest', plural: 'Harvests' },
    primaryDisplayProperty: 'shadowed:batch_code',
    requiredProperties: ['shadowed:batch_code'],
    searchableProperties: ['shadowed:batch_code', 'orchard_ref'],
    secondaryDisplayProperties: ['picked_on'],
  })
})

// The orchard portal with names that hold whitespace: two properties by their own name, a group, and a property in it.
function spaced(): Bodies {
  const bodies = orchard()
  bodies[`${routes.companies}${highlySensitive}`] = fixture('api/orchard/companies.spaced.json')
  return edit(bodies, routes.companyGroups, (g) => (g.name === 'plots' ? [g, { name: 'odd group', label: 'Odd' }] : g))
}

test('a portal name that cannot form an address is not captured: out of scope, with W_UNADDRESSABLE_NAME', async () => {
  const { observation, issues } = await observe({ bodies: spaced() })
  expect(Object.keys(observation.resources).filter((address) => address.includes(' '))).toEqual([])
  expect(observation.resources['property:companies/frost_risk']).toBeUndefined()
  const companies = covered(observation, 'companies')
  expect(companies.outOfScope).toEqual(expect.arrayContaining(['a b', 'frost_risk', 'x y']))
  expect(companies.unsupported?.map((u) => u.name)).toEqual(['plot_shape'])
  expect(issues.filter((issue) => issue.code === 'W_UNADDRESSABLE_NAME')).toEqual([
    {
      code: 'W_UNADDRESSABLE_NAME',
      message: "group 'odd group' on companies has a name no address can hold, so it is not captured",
      fix: 'rename it in HubSpot to a name without spaces',
    },
    {
      code: 'W_UNADDRESSABLE_NAME',
      message: "property 'x y' on companies has a name no address can hold, so it is not captured",
      fix: 'rename it in HubSpot to a name without spaces',
    },
    {
      code: 'W_UNADDRESSABLE_NAME',
      message: "property 'a b' on companies has a name no address can hold, so it is not captured",
      fix: 'rename it in HubSpot to a name without spaces',
    },
    {
      code: 'W_UNADDRESSABLE_NAME',
      message:
        "property 'frost_risk' on companies is in group 'odd group', whose name no address can hold, so it is not captured",
      fix: 'rename the group in HubSpot to a name without spaces',
    },
  ])
  // Nothing left in the observation breaks an address: every status and the comparison with config work.
  expect(coverageOf(observation).complete).toBe(true)
  expect(compare(configObservation(pulled), observation).complete).toBe(true)
})

test('a config property the portal moved into a group no address can hold is unaddressable and unread, never out of scope', async () => {
  const bodies = edit(spaced(), routes.companies, (p) =>
    p.name === 'plot_total' ? { ...p, groupName: 'odd group' } : p,
  )
  const { observation } = await observe({ bodies })
  expect(observation.resources['property:companies/plot_total']).toBeUndefined()
  const companies = covered(observation, 'companies')
  expect(companies.unaddressable).toEqual(['plot_total'])
  expect(companies.outOfScope).toEqual(expect.arrayContaining(['frost_risk']))
  expect(companies.outOfScope).not.toContain('plot_total')
  expect(statusOf(observation, 'property:companies/plot_total')).toBe('unreadable')
  // Config names it and the read could not capture it: the read is incomplete, and so is the comparison.
  expect(coverageOf(observation).complete).toBe(false)
  expect(compare(configObservation(pulled), observation).complete).toBe(false)
})

test('a custom object renamed to a schema the portal lacks is absent, shadowed and an other object', async () => {
  const { observation } = await observe({ overrides: { 'object:harvest': { name: 'harvests' } } })
  const coverage = coverageOf(observation)
  expect(coverage.objects.harvest).toEqual({
    status: 'absent',
    shadowed: ['harvest'],
    renamed: { 'object:harvest': 'harvests' },
  })
  expect(coverage.otherObjects).toEqual(['harvest', 'press_run'])
  expect(statusOf(observation, 'object:harvest')).toBe('absent')
})

test('the read errors of every command propagate: an undefined object key and an ambiguous name', async () => {
  await expect(observe({ loaded: withObjects({ ...pulled.config.objects, presses: {} }) })).rejects.toMatchObject({
    exitCode: 3,
    issues: [{ code: 'E_UNKNOWN_OBJECT' }],
  })
  await expect(observe({ overrides: { 'object:harvest': { name: 'press_run' } } })).rejects.toMatchObject({
    exitCode: 1,
    issues: [{ code: 'E_OVERRIDE_AMBIGUOUS' }],
  })
})

test('configObservation is the config IR, with no coverage; its statuses are present and absent', () => {
  const observation = configObservation(pulled)
  expect(observation).toEqual({ side: { kind: 'config' }, resources: pulled.ir.resources })
  expect(statusOf(observation, 'property:companies/yield_tier')).toBe('present')
  expect(statusOf(observation, 'property:companies/plot_count')).toBe('absent')
  expect(statusOf(observation, 'object:companies')).toBe('absent')
})

test('objectTypeIds maps each custom object that exists to its type ID', async () => {
  expect(objectTypeIds((await observe()).observation)).toEqual({ harvest: '2-4242001' })
  expect(objectTypeIds(configObservation(pulled))).toEqual({})
})

test('NOT_CAPTURED lists are sorted by code unit', () => {
  for (const list of Object.values(NOT_CAPTURED)) {
    expect(list).toEqual([...list].sort())
  }
})

// Every branch of statusOf, on a hand-built observation.
const table: Observation = {
  side: { kind: 'target', name: 'sandbox', portalId: 1_111_111 },
  resources: {
    'group:ledgers/main': { type: 'group', managed: true, definition: { label: 'Main' } },
    'object:ledgers': {
      type: 'object',
      managed: true,
      definition: { labels: { singular: 'Ledger', plural: 'Ledgers' } },
    },
    'property:ledgers/kept': { type: 'property', managed: false },
  },
  coverage: {
    complete: false,
    notCaptured: NOT_CAPTURED,
    otherObjects: 'unknown',
    objects: {
      ledgers: {
        status: 'read',
        excluded: ['property:ledgers/skipped'],
        renamed: { 'property:ledgers/moved': 'moved_n' },
        outOfScope: ['elsewhere', 'moved'],
        unaddressable: ['strayed'],
        unsupported: [{ ...plotShape, name: 'odd', group: { $ref: 'group:ledgers/main' } }],
      },
      locked: { status: 'unreadable', missingScope: 'crm.schemas.custom.read', issue: 'E_SCOPE' },
      missing: { status: 'absent' },
      // Read as a standard object: its lists, and no custom object schema.
      plain: { status: 'read' },
      skipped: { status: 'excluded', excluded: ['object:skipped'] },
      strange: { status: 'read', objectTypeId: '2-9', unsupportedSchema: { labels: {} } },
    },
  },
}

test.each<[string, Status]>([
  ['object:ledgers', 'present'],
  ['object:locked', 'unreadable'],
  ['object:missing', 'absent'],
  ['object:plain', 'absent'],
  ['object:skipped', 'excluded'],
  ['object:strange', 'unsupported'],
  ['object:unknown', 'not-observed'],
  ['property:locked/x', 'unreadable'],
  ['group:missing/x', 'absent'],
  ['property:skipped/x', 'excluded'],
  ['group:unknown/x', 'not-observed'],
  ['property:ledgers/skipped', 'excluded'],
  ['property:ledgers/moved', 'absent'],
  ['property:ledgers/kept', 'present'],
  ['group:ledgers/main', 'present'],
  ['property:ledgers/odd', 'unsupported'],
  ['group:ledgers/odd', 'absent'],
  ['property:ledgers/elsewhere', 'excluded'],
  ['property:ledgers/strayed', 'unreadable'],
  ['group:ledgers/elsewhere', 'absent'],
  ['property:ledgers/nothing', 'absent'],
  ['pipeline:ledgers/x', 'not-observed'],
])('statusOf %s is %s', (address, status) => {
  expect(statusOf(table, address)).toBe(status)
})
