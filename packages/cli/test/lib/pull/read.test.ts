import type { IRResource, Issue, Loaded, Override } from '@kalup/core'
import { expect, test } from 'vitest'
import { project } from '../../../src/commands/testing.js'
import { createHttp, type Fetch } from '../../../src/lib/http.js'
import { load } from '../../../src/lib/load.js'
import type { LiveObject } from '../../../src/lib/pull/normalize.js'
import { archivedProperties, archivedPropertyNames, type Portal, readPortal } from '../../../src/lib/pull/read.js'
import { fakeFetch, fixture, jsonResponse, portalBody, route } from '../../../src/lib/testing.js'

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

// The pull fixture project: companies (standard, include name and lifecyclestage) and harvest (a defineCustomObject).
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

function edit(bodies: Bodies, at: string, change: (item: Record<string, unknown>) => Record<string, unknown> | []) {
  const list = bodies[at] as { results: Record<string, unknown>[] }
  bodies[at] = { results: list.results.flatMap(change) }
  return bodies
}

interface Read {
  bodies?: Bodies
  loaded?: Loaded
  overrides?: Record<string, Override>
  refused?: string[]
}

// The orchard portal with some routes refused (403), read through the read-only client.
async function read({ bodies = orchard(), loaded = pulled, overrides, refused = [] }: Read = {}) {
  const calls: string[] = []
  const fetch: Fetch = (url, init) => {
    calls.push(route(url))
    const body = refused.includes(route(url))
      ? jsonResponse(403, fixture('errors/missing-scope.json'))
      : jsonResponse(200, portalBody(bodies, url), rate)
    return fakeFetch(body).fetch(url, init)
  }
  const http = createHttp({ key: 'kalup-test-secret-9f2c', fetch, warn: () => undefined })
  const issues: Issue[] = []
  const target = { portalId: 1_111_111, ...(overrides ? { overrides } : {}) }
  const portal = await readPortal(http, loaded, target, issues)
  return { portal, issues, calls }
}

function live(portal: Portal, object: string): LiveObject {
  const found = portal.objects.find((o) => o.object === object)
  if (!found) {
    throw new Error(`${object} was not read`)
  }
  return found
}

function names(portal: Portal, object: string): string[] {
  const { properties, unsupported } = live(portal, object)
  return [...properties, ...unsupported].map((p) => p.name).sort()
}

function withObjects(objects: Loaded['config']['objects']): Loaded {
  return { ...pulled, config: { ...pulled.config, objects } }
}

test('a complete read has no gaps, and each object lists the properties no builder carries', async () => {
  const { portal } = await read()
  expect(portal.gaps).toEqual([])
  expect(portal.objects.map((o) => o.object)).toEqual(['companies', 'harvest'])
  expect(live(portal, 'companies').unsupported).toEqual([
    {
      name: 'plot_shape',
      label: 'Plot shape',
      group: 'orchard',
      type: 'object_coordinates',
      fieldType: 'text',
      hubspotDefined: false,
    },
  ])
  expect(live(portal, 'harvest').unsupported).toEqual([])
  expect(portal).toMatchObject({
    absent: [],
    customObjects: ['harvest', 'press_run'],
    excluded: [],
    otherObjects: ['press_run'],
    shadowed: [],
    unknownIncludes: [],
  })
})

test('an object carries its archived group names, and a custom object its objectTypeId', async () => {
  const { portal } = await read()
  expect(live(portal, 'companies')).toMatchObject({ archivedGroups: ['old_ledger'], objectTypeId: undefined })
  expect(live(portal, 'companies').groups.has('old_ledger')).toBe(false)
  expect(live(portal, 'harvest')).toMatchObject({ archivedGroups: [], objectTypeId: '2-4242001' })
})

test('each object lists its properties three times, one per data sensitivity, then its groups', async () => {
  const { calls } = await read()
  expect(calls).toEqual([
    routes.schemas,
    routes.companies,
    `${routes.companies}${sensitive}`,
    `${routes.companies}${highlySensitive}`,
    routes.companyGroups,
    routes.harvest,
    `${routes.harvest}${sensitive}`,
    `${routes.harvest}${highlySensitive}`,
    routes.harvestGroups,
  ])
})

test('the sensitive lists are merged into the object, the first list wins a name listed twice', async () => {
  const bodies = orchard()
  bodies[`${routes.companies}${sensitive}`] = fixture('api/orchard/companies.sensitive.json')
  bodies[`${routes.companies}${highlySensitive}`] = {
    results: [
      {
        name: 'plot_total',
        label: 'Plot total, again',
        type: 'number',
        fieldType: 'number',
        groupName: 'orchard',
        dataSensitivity: 'highly_sensitive',
      },
    ],
  }
  const { portal } = await read({ bodies })
  const { properties } = live(portal, 'companies')
  expect(properties.find((p) => p.name === 'grower_tax_ref')?.definition).toEqual({
    label: 'Grower tax reference',
    group: 'orchard',
    fieldType: 'text',
  })
  expect(properties.filter((p) => p.name === 'plot_total').map((p) => p.definition?.label)).toEqual(['Plot total'])
})

test('each refused list is a gap naming the list, the object and the scope, beside its E_SCOPE issue', async () => {
  const schemas = await read({ refused: [routes.schemas] })
  expect(schemas.portal.gaps).toEqual([{ list: 'schemas', scope: 'crm.schemas.custom.read' }])
  expect(schemas.portal.objects.map((o) => o.object)).toEqual(['companies'])
  expect(schemas.portal.customObjects).toBeUndefined()
  expect(schemas.issues.map((i) => i.code)).toEqual(['E_SCOPE', 'W_UNSUPPORTED_TYPE'])

  const lists = await read({ refused: [routes.companyGroups, routes.harvest] })
  expect(lists.portal.gaps).toEqual([
    { list: 'groups', object: 'companies', scope: 'crm.schemas.companies.read' },
    { list: 'properties', object: 'harvest', scope: 'crm.schemas.custom.read' },
  ])
  expect(lists.portal.objects).toEqual([])
  expect(lists.issues.map((i) => i.code)).toEqual(['E_SCOPE', 'E_SCOPE'])
})

test.each([sensitive, highlySensitive])('a 403 on the %s properties list is a gap for the object', async (query) => {
  const { portal, issues, calls } = await read({ refused: [`${routes.harvest}${query}`] })
  expect(portal.gaps).toEqual([{ list: 'properties', object: 'harvest', scope: 'crm.schemas.custom.read' }])
  expect(portal.objects.map((o) => o.object)).toEqual(['companies'])
  expect(issues.map((i) => i.code)).toEqual(['W_UNSUPPORTED_TYPE', 'E_SCOPE'])
  expect(calls.at(-1)).toBe(`${routes.harvest}${query}`)
})

test('a custom object config defines and the portal lacks is reported absent, not thrown', async () => {
  const bodies = edit(orchard(), routes.schemas, (s) => (s.name === 'harvest' ? [] : s))
  const { portal, calls } = await read({ bodies })
  expect(portal.absent).toEqual(['harvest'])
  expect(portal.customObjects).toEqual(['press_run'])
  expect(portal.objects.map((o) => o.object)).toEqual(['companies'])
  expect(calls).not.toContain(routes.harvest)
})

test('a config key that is neither a standard object nor defined in config is E_UNKNOWN_OBJECT, exit 3', async () => {
  const loaded = withObjects({ ...pulled.config.objects, presses: {} })
  await expect(read({ loaded })).rejects.toMatchObject({
    exitCode: 3,
    issues: [
      {
        code: 'E_UNKNOWN_OBJECT',
        message:
          "'presses' is not a standard object or a custom object in the portal (custom objects: harvest, press_run)",
        configPath: 'objects.presses',
      },
    ],
  })
})

test('include names the portal lacks are reported per object, not thrown', async () => {
  const loaded = withObjects({ companies: { include: ['name', 'nope', 'never'] }, harvest: { include: ['gone'] } })
  const { portal } = await read({ loaded })
  expect(portal.unknownIncludes).toEqual([
    { object: 'companies', names: ['nope', 'never'] },
    { object: 'harvest', names: ['gone'] },
  ])
})

test('skip overrides: a skipped object is not read, a skipped group takes its config properties with it', async () => {
  const { portal, calls, issues } = await read({
    overrides: {
      'object:harvest': { skip: true },
      'group:companies/orchard': { skip: true },
      'property:companies/name': { skip: true },
    },
  })
  // harvest was the one custom object, so the schemas list is not needed either.
  expect(calls).toEqual([
    routes.companies,
    `${routes.companies}${sensitive}`,
    `${routes.companies}${highlySensitive}`,
    routes.companyGroups,
  ])
  expect(portal.excluded).toEqual([
    'group:companies/orchard',
    'object:harvest',
    'property:companies/harvest_window',
    'property:companies/name',
    'property:companies/plot_tags',
    'property:companies/plot_total',
    'property:companies/row_meta',
    'property:companies/yield_tier',
  ])
  expect(portal.objects.map((o) => o.object)).toEqual(['companies'])
  expect(portal.absent).toEqual([])
  expect([...live(portal, 'companies').groups.keys()]).toEqual(['companyinformation', 'plots'])
  // Portal properties in the group that config does not name are still read.
  expect(names(portal, 'companies')).toEqual([
    'domain',
    'hs_lastmodifieddate',
    'irrigation_notes',
    'lifecyclestage',
    'plot_count',
    'plot_shape',
    'pruned',
    'soil_ph',
  ])
  expect(issues.map((i) => i.code)).toEqual(['W_UNSUPPORTED_TYPE'])
})

test("a skipped group takes a config property by the group it has on the target: its definition override's", async () => {
  const { portal } = await read({
    overrides: {
      'group:companies/legacy': { skip: true },
      'property:companies/plot_total': { definition: { group: 'legacy' } },
    },
  })
  expect(portal.excluded).toEqual(['group:companies/legacy', 'property:companies/plot_total'])
  const moved = await read({
    overrides: {
      'group:companies/orchard': { skip: true },
      'property:companies/yield_tier': { definition: { group: 'legacy' } },
    },
  })
  expect(moved.portal.excluded).not.toContain('property:companies/yield_tier')
  expect(moved.portal.excluded).toContain('property:companies/plot_total')
})

test('an include name whose property is skipped is not reported, even when the portal lacks it', async () => {
  const loaded = withObjects({ companies: { include: ['name', 'lifecyclestage'] }, harvest: {} })
  const bodies = edit(orchard(), routes.companies, (p) => (p.name === 'name' ? [] : p))
  const { portal } = await read({ loaded, bodies, overrides: { 'property:companies/name': { skip: true } } })
  expect(portal.unknownIncludes).toEqual([])
})

test('a name override reports the portal resource N at the address', async () => {
  const bodies = edit(orchard(), routes.harvest, (p) => (p.name === 'picked_on' ? { ...p, name: 'pickedon' } : p))
  const { portal } = await read({ bodies, overrides: { 'property:harvest/picked_on': { name: 'pickedon' } } })
  expect(names(portal, 'harvest')).toContain('picked_on')
  expect(names(portal, 'harvest')).not.toContain('pickedon')
  expect(portal.shadowed).toEqual([])
})

test('a name override whose portal name is missing leaves the address absent and shadows its local name', async () => {
  const { portal } = await read({
    overrides: {
      'property:harvest/picked_on': { name: 'pickedon' },
      'group:harvest/harvest_details': { name: 'details' },
    },
  })
  expect(names(portal, 'harvest')).toEqual(['batch_code', 'hs_object_id', 'orchard_ref', 'weight_kg'])
  expect([...live(portal, 'harvest').groups.keys()]).toEqual(['harvestinformation'])
  expect(portal.shadowed).toEqual(['group:harvest/harvest_details', 'property:harvest/picked_on'])
})

test('a reference to a shadowed portal name reads as shadowed:<name>, in a property group and in a schema', async () => {
  const { portal } = await read({
    overrides: {
      'group:companies/orchard': { name: 'orchard_v2' },
      'property:harvest/batch_code': { name: 'batch_id' },
    },
  })
  expect(propertyAt(portal, 'companies', 'plot_total')?.definition?.group).toBe('shadowed:orchard')
  expect(live(portal, 'companies').unsupported.map((u) => u.group)).toEqual(['shadowed:orchard'])
  expect(live(portal, 'harvest').custom).toMatchObject({
    primaryDisplayProperty: 'shadowed:batch_code',
    requiredProperties: ['shadowed:batch_code'],
    searchableProperties: ['shadowed:batch_code', 'orchard_ref'],
    secondaryDisplayProperties: ['picked_on'],
  })
})

test('a local name another override points at is that address, not a shadow', async () => {
  const bodies = edit(orchard(), routes.harvest, (p) => (p.name === 'batch_code' ? [] : p))
  const { portal } = await read({
    bodies,
    overrides: {
      'property:harvest/picked_on': { name: 'pickedon' },
      'property:harvest/batch_code': { name: 'picked_on' },
    },
  })
  expect(names(portal, 'harvest')).toEqual(['batch_code', 'hs_object_id', 'orchard_ref', 'weight_kg'])
  expect(portal.shadowed).toEqual([])
})

function propertyAt(portal: Portal, object: string, name: string) {
  return live(portal, object).properties.find((p) => p.name === name)
}

test('a name swap validate accepts reads each portal resource at the other address, with no ambiguity', async () => {
  const { portal } = await read({
    overrides: {
      'property:companies/plot_total': { name: 'plot_count' },
      'property:companies/plot_count': { name: 'plot_total' },
      'group:companies/orchard': { name: 'plots' },
      'group:companies/plots': { name: 'orchard' },
    },
  })
  expect(propertyAt(portal, 'companies', 'plot_total')?.definition).toMatchObject({
    label: 'Plot count',
    group: 'orchard',
  })
  expect(propertyAt(portal, 'companies', 'plot_count')?.definition).toMatchObject({
    label: 'Plot total',
    group: 'plots',
  })
  expect(live(portal, 'companies').groups.get('orchard')).toBe('Plots')
  expect(live(portal, 'companies').groups.get('plots')).toBe('Orchard details')
  expect(portal.shadowed).toEqual([])
})

test('a name chain whose every override name the portal holds is no ambiguity', async () => {
  const bodies = edit(orchard(), routes.companies, (p) => (p.name === 'plot_total' ? { ...p, name: 'plot_sum' } : p))
  const { portal } = await read({
    bodies,
    overrides: {
      'property:companies/plot_total': { name: 'plot_count' },
      'property:companies/plot_count': { name: 'plot_sum' },
    },
  })
  expect(propertyAt(portal, 'companies', 'plot_total')?.definition?.label).toBe('Plot count')
  expect(propertyAt(portal, 'companies', 'plot_count')?.definition?.label).toBe('Plot total')
  expect(names(portal, 'companies')).not.toContain('plot_sum')
  expect(portal.shadowed).toEqual([])
})

test('a name chain whose first address the portal also holds under its own name is ambiguous there', async () => {
  const overrides = {
    'property:companies/plot_total': { name: 'plot_count' },
    'property:companies/plot_count': { name: 'domain' },
  }
  // No override claims plot_total, so the portal's plot_total and plot_count could both be the first address.
  await expect(read({ overrides })).rejects.toMatchObject({
    exitCode: 1,
    issues: [
      {
        code: 'E_OVERRIDE_AMBIGUOUS',
        message:
          "the portal holds both 'plot_count' and 'plot_total' on companies, so the name override for property:companies/plot_total is ambiguous",
      },
    ],
  })
})

test('a name override equal to the address own name changes nothing', async () => {
  const plain = await read()
  const { portal } = await read({
    overrides: {
      'group:companies/plots': { name: 'plots' },
      'property:companies/plot_total': { name: 'plot_total' },
    },
  })
  expect(portal).toEqual(plain.portal)
})

test('an archived group under the address own name is no ambiguity and no shadow', async () => {
  const bodies = edit(orchard(), routes.companyGroups, (g) => (g.name === 'plots' ? { ...g, name: 'plot_group' } : g))
  const groups = bodies[routes.companyGroups] as { results: Record<string, unknown>[] }
  groups.results.push({ name: 'plots', label: 'Plots', displayOrder: -1, archived: true })
  edit(bodies, routes.companies, (p) => (p.groupName === 'plots' ? { ...p, groupName: 'plot_group' } : p))
  const { portal } = await read({ bodies, overrides: { 'group:companies/plots': { name: 'plot_group' } } })
  expect(live(portal, 'companies').groups.get('plots')).toBe('Plots')
  expect(propertyAt(portal, 'companies', 'plot_count')?.definition?.group).toBe('plots')
  expect(portal.shadowed).toEqual([])
})

test('a name override on a custom object: N missing is absent and shadowed, both names is ambiguous', async () => {
  const missing = await read({ overrides: { 'object:harvest': { name: 'harvests' } } })
  expect(missing.portal.absent).toEqual(['harvest'])
  expect(missing.portal.shadowed).toEqual(['object:harvest'])
  expect(missing.portal.otherObjects).toEqual(['harvest', 'press_run'])

  await expect(read({ overrides: { 'object:harvest': { name: 'press_run' } } })).rejects.toMatchObject({
    exitCode: 1,
    issues: [
      {
        code: 'E_OVERRIDE_AMBIGUOUS',
        message:
          "the portal holds both 'press_run' and 'harvest', so the name override for object:harvest is ambiguous",
      },
    ],
  })
})

test('two name overrides that read one portal name are E_OVERRIDE_NAME in either order, never the last one winning', async () => {
  // plot_tags is renamed to tags in the portal and row_meta is gone, so neither override is ambiguous.
  const renamed = (p: Record<string, unknown>) => (p.name === 'plot_tags' ? { ...p, name: 'tags' } : p)
  const bodies = () => edit(orchard(), routes.companies, (p) => (p.name === 'row_meta' ? [] : renamed(p)))
  const two = [
    ['property:companies/plot_tags', { name: 'tags' }],
    ['property:companies/row_meta', { name: 'tags' }],
  ] as const
  const orders = [two, [...two].reverse()].map((overrides) =>
    expect(read({ bodies: bodies(), overrides: Object.fromEntries(overrides) })).rejects.toMatchObject({
      exitCode: 3,
      issues: [{ code: 'E_OVERRIDE_NAME' }],
    }),
  )
  await Promise.all(orders)
  const groups = edit(orchard(), routes.companyGroups, (g) => (g.name === 'orchard' ? { ...g, name: 'orchard_v2' } : g))
  await expect(
    read({
      bodies: groups,
      overrides: { 'group:companies/orchard': { name: 'orchard_v2' }, 'group:companies/plots': { name: 'orchard_v2' } },
    }),
  ).rejects.toMatchObject({ issues: [{ code: 'E_OVERRIDE_NAME' }] })

  // Two config objects on one portal object.
  const crop = pulled.ir.resources['object:harvest'] as IRResource
  const loaded: Loaded = {
    ...withObjects({ ...pulled.config.objects, crop: {} }),
    ir: { ...pulled.ir, resources: { ...pulled.ir.resources, 'object:crop': crop } },
  }
  const schemas = edit(orchard(), routes.schemas, (s) => (s.name === 'harvest' ? { ...s, name: 'harvest_v2' } : s))
  await expect(
    read({
      bodies: schemas,
      loaded,
      overrides: { 'object:harvest': { name: 'harvest_v2' }, 'object:crop': { name: 'harvest_v2' } },
    }),
  ).rejects.toMatchObject({
    exitCode: 3,
    issues: [
      {
        code: 'E_OVERRIDE_NAME',
        message: "the name overrides for object:harvest and object:crop both read 'harvest_v2'",
      },
    ],
  })
})

test('the both-names check runs on the merged property list, sensitive lists included', async () => {
  const bodies = orchard()
  bodies[`${routes.harvest}${sensitive}`] = {
    results: [{ name: 'pickedon', label: 'Picked on', type: 'date', fieldType: 'date', groupName: 'harvest_details' }],
  }
  await expect(
    read({ bodies, overrides: { 'property:harvest/picked_on': { name: 'pickedon' } } }),
  ).rejects.toMatchObject({ issues: [{ code: 'E_OVERRIDE_AMBIGUOUS' }] })
})

test('archivedPropertyNames lists one object with archived=true once per data sensitivity, names merged and sorted', async () => {
  const { fetch, calls } = fakeFetch(
    jsonResponse(200, { results: [{ name: 'old_yield' }, { name: 'Legacy_code' }] }, rate),
    jsonResponse(200, { results: [{ name: 'harvest_window' }] }, rate),
    jsonResponse(200, { results: [{ name: 'buyer_iban' }, { name: 'old_yield' }] }, rate),
  )
  const http = createHttp({ key: 'kalup-test-secret-9f2c', fetch, warn: () => undefined })
  expect(await archivedPropertyNames(http, '2-4242001')).toEqual([
    'Legacy_code',
    'buyer_iban',
    'harvest_window',
    'old_yield',
  ])
  const list = 'https://api.hubapi.com/crm/properties/2026-09/2-4242001?archived=true'
  expect(calls.map((c) => c.url)).toEqual([
    list,
    `${list}&dataSensitivity=sensitive`,
    `${list}&dataSensitivity=highly_sensitive`,
  ])
})

test('archivedProperties merges the three archived lists by name, first list first, with group and archive time', async () => {
  const property = (name: string, groupName: string, archivedAt?: string) => ({
    name,
    label: name,
    type: 'string',
    fieldType: 'text',
    groupName,
    archived: true,
    ...(archivedAt === undefined ? {} : { archivedAt }),
  })
  const { fetch, calls } = fakeFetch(
    jsonResponse(200, { results: [property('old_yield', 'orchard', '2026-08-01T09:00:00.000Z')] }, rate),
    jsonResponse(200, { results: [property('harvest_window', 'harvest_details')] }, rate),
    jsonResponse(
      200,
      {
        results: [
          property('old_yield', 'elsewhere', '2026-01-01T00:00:00.000Z'),
          property('buyer_iban', 'harvest_details', '2026-09-01T12:00:00.000Z'),
        ],
      },
      rate,
    ),
  )
  const http = createHttp({ key: 'kalup-test-secret-9f2c', fetch, warn: () => undefined })
  expect(await archivedProperties(http, '2-4242001')).toEqual([
    { name: 'buyer_iban', groupName: 'harvest_details', archivedAt: '2026-09-01T12:00:00.000Z' },
    { name: 'harvest_window', groupName: 'harvest_details' },
    { name: 'old_yield', groupName: 'orchard', archivedAt: '2026-08-01T09:00:00.000Z' },
  ])
  expect(calls.map((c) => new URL(c.url).searchParams.toString())).toEqual([
    'archived=true',
    'archived=true&dataSensitivity=sensitive',
    'archived=true&dataSensitivity=highly_sensitive',
  ])
})

test('each object read carries the meta of its unarchived properties by local name, sensitivity from the list', async () => {
  const bodies = orchard()
  bodies[`${routes.companies}${sensitive}`] = fixture('api/orchard/companies.sensitive.json')
  const { portal } = await read({ bodies })
  const { meta } = live(portal, 'companies')
  expect(meta.get('grower_tax_ref')?.sensitivity).toBe('sensitive')
  expect(meta.get('yield_tier')?.sensitivity).toBe('non_sensitive')
  expect([...meta.keys()].sort()).toEqual(names(portal, 'companies'))
})
