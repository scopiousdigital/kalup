// What apply reads before it writes: the lists of each object a plan's effects touch, under the plan's own names.

import { expect, test } from 'vitest'
import { namesOf, observeForApply } from '../../src/engine/apply-observe.js'
import type { KalupError } from '../../src/lib/errors.js'
import { createHttp } from '../../src/lib/http.js'
import type { Plan } from '../../src/plan/types.js'
import { fault } from '../support/portal-sim.js'
import {
  companies,
  groups,
  key,
  loadProject,
  orchardGroup,
  planOn,
  sent,
  simPortal,
  soilPh,
  soilPhProperty,
} from './apply-harness.js'

test('a create reads the three sensitivity lists, the groups list and the archived lists of its object', async () => {
  const sim = simPortal()
  const plan = await planOn(sim, loadProject())
  const from = sim.log.length
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  const observation = await observeForApply(http, plan)
  expect(sent(sim, from)).toEqual([
    `GET ${companies}`,
    `GET ${companies}`,
    `GET ${companies}`,
    `GET ${groups}`,
    `GET ${companies}`,
    `GET ${companies}`,
    `GET ${companies}`,
  ])
  expect(sim.log.slice(from).map((r) => r.query)).toEqual([
    {},
    { dataSensitivity: 'sensitive' },
    { dataSensitivity: 'highly_sensitive' },
    {},
    { archived: 'true' },
    { archived: 'true', dataSensitivity: 'sensitive' },
    { archived: 'true', dataSensitivity: 'highly_sensitive' },
  ])
  expect(observation).toMatchObject({ reads: 7, resources: {}, archived: { companies: [] } })
})

test('a property is observed under its address as plan observed it, with its meta; a group by its label', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [{ ...soilPhProperty, dataSensitivity: 'sensitive' }] })
  const plan = await planOn(
    sim,
    loadProject([['hubspot/objects/companies.ts', "label: 'Soil pH'", "label: 'Soil acidity'"]]),
  )
  const observation = await observeForApply(createHttp({ key, fetch: sim.fetch, warn: () => undefined }), plan)
  expect(observation.resources[soilPh]).toEqual({
    type: 'property',
    managed: true,
    definition: {
      label: 'Soil pH',
      group: { $ref: 'group:companies/orchard' },
      type: 'number',
      fieldType: 'number',
      dataSensitivity: 'sensitive',
    },
  })
  expect(observation.meta[soilPh]).toMatchObject({ sensitivity: 'sensitive' })
  expect(observation.resources['group:companies/orchard']).toEqual({
    type: 'group',
    managed: true,
    definition: { label: 'Orchard' },
  })
  expect(observation.members).toEqual({ companies: { companyinformation: ['name'], orchard: ['soil_ph'] } })
})

test('a list the write key cannot read is E_INCOMPLETE, exit 1, naming the read scope', async () => {
  const sim = simPortal()
  const plan = await planOn(sim, loadProject())
  sim.fault({ method: 'GET', path: groups, action: fault.status(403, { category: 'MISSING_SCOPES', message: 'no' }) })
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  await expect(observeForApply(http, plan)).rejects.toMatchObject({
    exitCode: 1,
    issues: [
      {
        code: 'E_INCOMPLETE',
        message: expect.stringContaining('groups list of companies (403)'),
        fix: expect.stringContaining('crm.schemas.companies.read to the write key'),
      },
    ],
  })
})

/** A plan with one group create on custom object harvest, and these bindings. */
function harvestPlan(bindings: Plan['bindings']): Plan {
  const step = {
    id: 's1',
    address: 'group:harvest/yield',
    action: 'create',
    risk: 'safe',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'x',
    desired: { label: 'Yield' },
    expect: { exists: false },
  }
  return { planId: 'pl_000000000001', target: { name: 'sandbox' }, bindings, steps: [step] } as unknown as Plan
}

const harvest = { name: 'harvest', objectTypeId: '2-4242002', labels: { singular: 'Harvest', plural: 'Harvests' } }

test('a bound custom object type ID that no longer names its object is E_BINDING_CHANGED', async () => {
  const sim = simPortal({}, { schemas: [harvest] })
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  const error = (await observeForApply(http, harvestPlan({ 'object:harvest': { id: '2-4242001' } })).catch(
    (thrown: unknown) => thrown,
  )) as KalupError
  expect(error).toMatchObject({ issues: [{ code: 'E_BINDING_CHANGED' }] })
  expect(error.issues[0]?.message).toMatchInlineSnapshot(
    `"The bindings of plan pl_000000000001 are not what kalup.config.ts and the portal give now: object:harvest was bound to type ID 2-4242001, and the portal has type ID 2-4242002. Nothing was written."`,
  )
})

test('a plan that leaves out a custom object type ID, or binds one no step touches, is E_BINDING_CHANGED', async () => {
  const sim = simPortal({}, { schemas: [harvest] })
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  await expect(observeForApply(http, harvestPlan({}))).rejects.toThrow('object:harvest was bound to no type ID')
  const extra = { ...harvestPlan({ 'object:harvest': { id: '2-4242002' } }), steps: [] }
  await expect(observeForApply(http, extra)).rejects.toThrow('object:harvest, which no step touches')
  const standard = { ...extra, bindings: { 'object:companies': { id: '0-2' } } }
  await expect(observeForApply(http, standard)).rejects.toThrow('object:companies, which no step touches')
})

test('with the target overrides, a name binding config does not give is E_BINDING_CHANGED', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const plan = await planOn(sim, loadProject())
  const forged = { ...plan, bindings: { ...plan.bindings, [soilPh]: { name: 'plot_notes' } } }
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  await expect(observeForApply(http, forged, {})).rejects.toThrow(`${soilPh} to portal name plot_notes`)
  const observation = await observeForApply(http, forged, { [soilPh]: { name: 'plot_notes' } })
  expect(observation.resources[soilPh]).toBeUndefined()
})

test('a custom object step observes its schema, its properties under their local names', async () => {
  const schema = { ...harvest, primaryDisplayProperty: 'crop_name', requiredProperties: ['crop_name'] }
  const sim = simPortal({}, { schemas: [schema] })
  const step = { ...harvestPlan({}).steps[0], address: 'object:harvest', action: 'adopt', expect: { exists: true } }
  const plan = { ...harvestPlan({ 'object:harvest': { id: '2-4242002' } }), steps: [step] } as Plan
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  const observation = await observeForApply(http, plan, { 'property:harvest/crop': { name: 'crop_name' } })
  expect(observation.resources['object:harvest']).toEqual({
    type: 'object',
    managed: true,
    definition: {
      labels: { singular: 'Harvest', plural: 'Harvests' },
      primaryDisplayProperty: 'crop',
      requiredProperties: ['crop'],
      searchableProperties: [],
      secondaryDisplayProperties: [],
    },
  })
})

test('names come from the plan bindings: a name override, a custom object type ID, a renamed group', () => {
  const names = namesOf({
    bindings: {
      [soilPh]: { name: 'legacy_ph' },
      'object:harvest': { id: '2-4242001' },
      'group:companies/orchard': { name: 'orchard_details' },
    },
  })
  expect(names.portalName(soilPh)).toBe('legacy_ph')
  expect(names.portalName('property:companies/plot_count')).toBe('plot_count')
  expect(names.objectType('harvest')).toBe('2-4242001')
  expect(names.objectType('companies')).toBe('companies')
  expect(names.localGroup('companies', 'orchard_details')).toBe('orchard')
  expect(names.localGroup('companies', 'plots')).toBe('plots')
})
