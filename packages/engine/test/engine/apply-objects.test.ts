// Custom object schemas through plan and the executor against the simulator: a create that sends the bare schema and
// sets its display fields once its properties exist, the full schema PATCH, the archive and its refusal, and what apply
// refuses on a name HubSpot holds.

import { expect, test } from 'vitest'
import { executePlan } from '../../src/engine/apply.js'
import { stepTitle } from '../../src/engine/apply-check.js'
import type { TargetState } from '../../src/ir/state.js'
import type { PlanStep } from '../../src/plan/types.js'
import { fault, type SimPortalInput } from '../support/portal-sim.js'
import {
  type Edit,
  files,
  harness,
  loadProject,
  orchardGroup,
  planOn,
  portalId,
  request,
  simPortal,
  soilPhProperty,
} from './apply-harness.js'

const VISIT = 'hubspot/objects/orchard_visit.ts'
const visit = 'object:orchard_visit'
const schemas = '/crm-object-schemas/2026-09/schemas'

const withVisit: Edit = [files.config, 'companies: {},', 'companies: {},\n    orchard_visit: {},']

// The orchard visit object config holds: its labels, description, display fields, a group and a property.
function visitFile(fields = "primaryDisplayProperty: 'visit_code',\n  searchableProperties: ['visit_code'],"): string {
  return [
    "import { defineCustomObject, type InferProperties, p } from '@kalup/core'",
    '',
    "export const OrchardVisit = defineCustomObject('orchard_visit', {",
    "  labels: { singular: 'Orchard visit', plural: 'Orchard visits' },",
    "  description: 'One visit to one orchard.',",
    `  ${fields}`,
    "  groups: {\n    visit_details: { label: 'Visit details' },\n  },",
    "  properties: {\n    visitCode: p.string('visit_code', { label: 'Visit code', group: 'visit_details', fieldType: 'text' }),\n  },",
    '})',
    '',
    'export type OrchardVisitData = InferProperties<typeof OrchardVisit.properties> & { id: string }',
    '',
  ].join('\n')
}

function project(text = visitFile()) {
  return loadProject([withVisit], { [VISIT]: text })
}

// The fixture's company group and property, owned and agreeing with the portal.
const companiesOwned: TargetState['resources'] = {
  'group:companies/orchard': { origin: 'created', id: 'orchard', normVersion: 1, base: { label: 'Orchard' } },
  'property:companies/soil_ph': {
    origin: 'created',
    id: 'soil_ph',
    normVersion: 1,
    base: { fieldType: 'number', group: { $ref: 'group:companies/orchard' }, label: 'Soil pH', type: 'number' },
  },
}

function state(resources: TargetState['resources'] = {}): TargetState {
  return {
    format: 'kalup.state/1',
    lineage: '0a1b2c3d4e5f6071',
    serial: 3,
    portalId,
    resources: { ...companiesOwned, ...resources },
  }
}

function portal(input: Partial<SimPortalInput> = {}) {
  return simPortal({ groups: [orchardGroup], properties: [soilPhProperty] }, input)
}

// The visit object as HubSpot holds it once applied, with its group and property.
const live: Partial<SimPortalInput> = {
  schemas: [
    {
      name: 'orchard_visit',
      objectTypeId: '2-4242501',
      labels: { singular: 'Orchard visit', plural: 'Orchard visits' },
      description: 'One visit to one orchard.',
      primaryDisplayProperty: 'visit_code',
      searchableProperties: ['visit_code'],
      requiredProperties: [],
      secondaryDisplayProperties: [],
    },
  ],
  objects: {
    '2-4242501': {
      groups: [{ name: 'visit_details', label: 'Visit details' }],
      properties: [
        { name: 'hs_object_id', type: 'number', fieldType: 'number', groupName: 'visit_details', hubspotDefined: true },
        { name: 'visit_code', label: 'Visit code', type: 'string', fieldType: 'text', groupName: 'visit_details' },
      ],
    },
  },
}

// State that owns the visit object, its group and its property, agreeing with `live`.
function owned(): TargetState {
  return state({
    [visit]: {
      origin: 'created',
      id: 'orchard_visit',
      normVersion: 1,
      base: {
        description: 'One visit to one orchard.',
        labels: { plural: 'Orchard visits', singular: 'Orchard visit' },
        primaryDisplayProperty: 'visit_code',
        searchableProperties: ['visit_code'],
      },
    },
    'group:orchard_visit/visit_details': {
      origin: 'created',
      id: 'visit_details',
      normVersion: 1,
      base: { label: 'Visit details' },
    },
    'property:orchard_visit/visit_code': {
      origin: 'created',
      id: 'visit_code',
      normVersion: 1,
      base: {
        fieldType: 'text',
        group: { $ref: 'group:orchard_visit/visit_details' },
        label: 'Visit code',
        type: 'string',
      },
    },
  })
}

test('a custom object create sends the bare schema, then its group and property, then its display fields', async () => {
  const sim = portal()
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(), state())
  expect(plan.steps.map((s) => [s.address, s.action, s.risk])).toEqual([
    [visit, 'create', 'safe'],
    ['group:orchard_visit/visit_details', 'create', 'safe'],
    ['property:orchard_visit/visit_code', 'create', 'safe'],
  ])
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  // The display step is apply's own, derived from the create: an update of the object reported after it.
  expect(applied.data.steps.map((s) => [s.id, s.address, s.action, s.outcome])).toEqual([
    ['s1', visit, 'create', 'done'],
    ['s1.display', visit, 'update', 'done'],
    ['s2', 'group:orchard_visit/visit_details', 'create', 'done'],
    ['s3', 'property:orchard_visit/visit_code', 'create', 'done'],
  ])
  expect(applied.text).toContain(
    's1.display done Update custom object "Orchard visit" (orchard_visit), set primaryDisplayProperty, searchableProperties',
  )
  expect(applied.exitCode).toBe(0)
  const writes = sim.log.slice(from).filter((r) => r.method !== 'GET')
  expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual([
    `POST ${schemas}`,
    'POST /crm/properties/2026-09/2-4243001/groups',
    'POST /crm/properties/2026-09/2-4243001',
    `PATCH ${schemas}/2-4243001`,
  ])
  // The bare create: no properties or associations, which a same-name race would merge into another schema.
  expect(writes[0]?.body).toEqual({
    name: 'orchard_visit',
    labels: { singular: 'Orchard visit', plural: 'Orchard visits' },
    description: 'One visit to one orchard.',
    primaryDisplayProperty: 'hs_object_id',
  })
  // The tail: every field the schema PATCH takes, the display fields config states over what the create left.
  expect(writes[3]?.body).toEqual({
    labels: { singular: 'Orchard visit', plural: 'Orchard visits' },
    primaryDisplayProperty: 'visit_code',
    secondaryDisplayProperties: [],
    requiredProperties: [],
    searchableProperties: ['visit_code'],
    description: 'One visit to one orchard.',
    clearDescription: false,
    restorable: true,
  })
  const saved = h.deps.store.read(portalId)
  expect(saved?.resources[visit]).toEqual({
    origin: 'created',
    id: 'orchard_visit',
    normVersion: 1,
    base: {
      description: 'One visit to one orchard.',
      labels: { plural: 'Orchard visits', singular: 'Orchard visit' },
      primaryDisplayProperty: 'visit_code',
      searchableProperties: ['visit_code'],
    },
  })
  expect(Object.keys(saved?.resources ?? {})).toContain('property:orchard_visit/visit_code')
  const again = await planOn(sim, project(), saved)
  expect(again.steps).toEqual([])
})

// The visit object with its property in the group HubSpot makes with it, as pull writes it from a portal whose property
// sits there.
function inDefaultGroup(label: string): string {
  return visitFile()
    .replace("visit_details: { label: 'Visit details' }", `orchard_visit_information: { label: '${label}' }`)
    .replace("group: 'visit_details'", "group: 'orchard_visit_information'")
}

test.each([
  ['Visit details', ['PATCH /crm/properties/2026-09/2-4243001/groups/orchard_visit_information']],
  ['Orchard visit Information', []],
])('the group HubSpot makes with a new custom object takes config label %j, with %j', async (label, sent) => {
  const sim = portal()
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(inDefaultGroup(label)), state())
  expect(plan.steps.find((s) => s.address === 'group:orchard_visit/orchard_visit_information')).toMatchObject({
    action: 'create',
    notes: [
      {
        unit: 'group',
        live: null,
        note: 'HubSpot makes this group when it creates orchard_visit, labelled "Orchard visit Information"; apply gives it config\'s label instead of creating it',
      },
    ],
  })
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.exitCode).toBe(0)
  expect(applied.data.steps.every((s) => s.outcome === 'done')).toBe(true)
  const writes = sim.log.slice(from).filter((r) => r.method !== 'GET' && r.path.includes('/groups'))
  expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual(sent)
  const saved = h.deps.store.read(portalId)
  expect(saved?.resources['group:orchard_visit/orchard_visit_information']).toEqual({
    origin: 'created',
    id: 'orchard_visit_information',
    normVersion: 1,
    base: { label },
  })
  expect((await planOn(sim, project(inDefaultGroup(label)), saved)).steps).toEqual([])
})

test('HubSpot group a lagging groups list leaves out is read again, never created a second time', async () => {
  const sim = portal()
  // The first read of the new object's groups, the group step's own, does not show the group the create made yet.
  const groups = '/crm/properties/2026-09/2-4243001/groups'
  sim.fault({ method: 'GET', path: groups, occurrence: 1, action: fault.status(200, { results: [] }) })
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(inDefaultGroup('Visit details')), state())
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => [s.id, s.outcome])).toEqual([
    ['s1', 'done'],
    ['s1.display', 'done'],
    ['s2', 'done'],
    ['s3', 'done'],
  ])
  const writes = sim.log.slice(from).filter((r) => r.method !== 'GET' && r.path.startsWith(groups))
  expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual([`PATCH ${groups}/orchard_visit_information`])
})

test('HubSpot group that never shows is not run, nothing is sent for it, and nothing in it runs', async () => {
  const sim = portal()
  const groups = '/crm/properties/2026-09/2-4243001/groups'
  sim.fault({ method: 'GET', path: groups, action: fault.status(200, { results: [] }) })
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(inDefaultGroup('Visit details')), state())
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => [s.id, s.outcome])).toEqual([
    ['s1', 'done'],
    ['s1.display', 'not-run'],
    ['s2', 'not-run'],
    ['s3', 'not-run'],
  ])
  expect(applied.issues.find((i) => i.code === 'W_UNVERIFIED')?.message).toContain(
    'HubSpot makes this group with the custom object, and the groups list did not show it within 60 s; kalup never creates it, so nothing was sent, and nothing in it ran',
  )
  const writes = sim.log.slice(from).filter((r) => r.method !== 'GET')
  expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual([`POST ${schemas}`])
})

test('a lagging read of what the run just made is not taken for what HubSpot stored after the write over it', async () => {
  const sim = portal()
  // The tail's PATCH and the PATCH of HubSpot's group: the next reads show each as it was before (observed 2026-10-05).
  sim.fault({ method: 'PATCH', path: `${schemas}/2-4243001`, action: fault.lag(2) })
  const group = '/crm/properties/2026-09/2-4243001/groups/orchard_visit_information'
  sim.fault({ method: 'PATCH', path: group, action: fault.lag(2) })
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(inDefaultGroup('Visit details')), state())
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.issues).toEqual([])
  expect(applied.data.steps.map((s) => [s.id, s.outcome])).toEqual([
    ['s1', 'done'],
    ['s1.display', 'done'],
    ['s2', 'done'],
    ['s3', 'done'],
  ])
  const saved = h.deps.store.read(portalId)
  expect(saved?.resources[visit]).toMatchObject({ base: { primaryDisplayProperty: 'visit_code' } })
  expect(saved?.resources[visit]?.rewrites).toBeUndefined()
  expect(saved?.resources['group:orchard_visit/orchard_visit_information']).toMatchObject({
    base: { label: 'Visit details' },
  })
})

test('a tail reads the schemas list again when it leaves out the object the run created seconds before', async () => {
  // The simulator answers alike each run, so a run without the fault finds where the tail's first list read falls.
  async function created(hide?: number) {
    const sim = portal()
    const h = await harness(sim)
    h.deps.store.write(state(), null)
    const plan = await planOn(sim, project(), state())
    if (hide !== undefined) {
      sim.fault({ method: 'GET', path: schemas, occurrence: hide, action: fault.status(200, { results: [] }) })
    }
    const from = sim.log.length
    const applied = await executePlan(request(plan), h.deps)
    return { applied, log: sim.log.slice(from) }
  }
  const clean = await created()
  const property = clean.log.findIndex((r) => r.method === 'POST' && r.path === '/crm/properties/2026-09/2-4243001')
  const lists = clean.log.filter((r) => r.method === 'GET' && r.path === schemas)
  const tailRead = lists.findIndex((r) => clean.log.indexOf(r) > property) + 1
  expect(tailRead).toBeGreaterThan(0)

  const hidden = await created(tailRead)
  expect(hidden.applied.exitCode).toBe(0)
  expect(hidden.applied.data.steps.find((s) => s.address === visit)?.outcome).toBe('done')
  const patches = hidden.log.filter((r) => r.method === 'PATCH' && r.path === `${schemas}/2-4243001`)
  expect(patches).toHaveLength(1)
  // The read the fault emptied, then the one that found the object.
  expect(hidden.log.filter((r) => r.method === 'GET' && r.path === schemas)).toHaveLength(lists.length + 1)
})

test('a create whose property was not created is done, its display step does not run, and the next plan sets it', async () => {
  const sim = portal()
  sim.fault({ method: 'POST', path: '/crm/properties/2026-09/2-4243001', action: fault.status(400) })
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(), state())
  const applied = await executePlan(request(plan), h.deps)
  // The create keeps its own report and entry: HubSpot holds the object as the create left it.
  expect(applied.data.steps.map((s) => [s.id, s.outcome])).toEqual([
    ['s1', 'done'],
    ['s1.display', 'not-run'],
    ['s2', 'done'],
    ['s3', 'rejected'],
  ])
  expect(sim.log.some((r) => r.method === 'PATCH')).toBe(false)
  // The base holds what the create set, so config's display fields are a config change the next plan writes.
  const saved = h.deps.store.read(portalId)
  expect(saved?.resources[visit]).toMatchObject({
    origin: 'created',
    base: { primaryDisplayProperty: 'hs_object_id', searchableProperties: ['hs_object_id'] },
  })
  sim.log.length = 0
  const next = await planOn(sim, project(), saved)
  expect(next.steps.find((s) => s.address === visit)).toMatchObject({
    action: 'update',
    changes: [
      { unit: 'primaryDisplayProperty', class: 'config-change' },
      { unit: 'searchableProperties', class: 'config-change' },
    ],
  })
})

test('a display step HubSpot refuses for a reason other than a missing property is final, and the create stays done', async () => {
  const sim = portal()
  const refused = { status: 'error', category: 'VALIDATION_ERROR', subCategory: 'ObjectTypeError.SOMETHING_ELSE' }
  sim.fault({ method: 'PATCH', path: `${schemas}/2-4243001`, action: fault.status(400, refused) })
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(), state())
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => [s.id, s.outcome])).toEqual([
    ['s1', 'done'],
    ['s1.display', 'rejected'],
    ['s2', 'done'],
    ['s3', 'done'],
  ])
  // Sent once: only a missing property is worth waiting for.
  expect(sim.log.filter((r) => r.method === 'PATCH')).toHaveLength(1)
  expect(h.deps.store.read(portalId)?.resources[visit]).toMatchObject({
    origin: 'created',
    base: { primaryDisplayProperty: 'hs_object_id' },
  })
})

test('a create read back after a timeout gives its type ID, so its group, property and display step go to it', async () => {
  const sim = portal()
  sim.fault({ method: 'POST', path: schemas, action: fault.timeout({ apply: true }) })
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(), state())
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => [s.id, s.outcome])).toEqual([
    ['s1', 'done'],
    ['s1.display', 'done'],
    ['s2', 'done'],
    ['s3', 'done'],
  ])
  const writes = sim.log.slice(from).filter((r) => r.method !== 'GET')
  expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual([
    `POST ${schemas}`,
    'POST /crm/properties/2026-09/2-4243001/groups',
    'POST /crm/properties/2026-09/2-4243001',
    `PATCH ${schemas}/2-4243001`,
  ])
})

test('a refused custom object update holds back nothing else on the object: only its create is their parent', async () => {
  const sim = portal(live)
  const refused = { status: 'error', category: 'VALIDATION_ERROR', subCategory: 'ObjectTypeError.SOMETHING_ELSE' }
  sim.fault({ method: 'PATCH', path: `${schemas}/2-4242501`, action: fault.status(400, refused) })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  // A label change on the object, and a pipeline on it: the pipeline runs after the schema update in runOrder.
  const changed = visitFile().replace("plural: 'Orchard visits'", "plural: 'Visits'")
  const pipeline = [
    "import { definePipeline } from '@kalup/core'",
    '',
    "export const VisitRounds = definePipeline('orchard_visit', {",
    "  id: 'visit_rounds',",
    "  label: 'Visit rounds',",
    '  displayOrder: 0,',
    "  stages: { booked: { id: 'visit_booked', label: 'Booked' } },",
    '})',
    '',
  ].join('\n')
  const loaded = loadProject([withVisit], { [VISIT]: changed, 'hubspot/pipelines/orchard_visit.ts': pipeline })
  const plan = await planOn(sim, loaded, owned())
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.map((s) => [s.address, s.outcome])).toEqual([
    [visit, 'rejected'],
    ['pipeline:orchard_visit/visit_rounds', 'done'],
  ])
})

test('an object update naming a property state owns and HubSpot lost is blocked by plan, never refused by apply', async () => {
  // HubSpot holds the object and its group, not visit_code, which state owns; config moves the display to visit_code.
  const lost: Partial<SimPortalInput> = {
    schemas: [
      {
        ...(live.schemas?.[0] as NonNullable<SimPortalInput['schemas']>[number]),
        primaryDisplayProperty: 'hs_object_id',
        searchableProperties: ['hs_object_id'],
      },
    ],
    objects: {
      '2-4242501': {
        groups: [{ name: 'visit_details', label: 'Visit details' }],
        properties: [
          {
            name: 'hs_object_id',
            type: 'number',
            fieldType: 'number',
            groupName: 'visit_details',
            hubspotDefined: true,
          },
        ],
      },
    },
  }
  const st = owned()
  st.resources[visit] = {
    ...(st.resources[visit] as NonNullable<TargetState['resources'][string]>),
    base: {
      description: 'One visit to one orchard.',
      labels: { plural: 'Orchard visits', singular: 'Orchard visit' },
      primaryDisplayProperty: 'hs_object_id',
      searchableProperties: ['hs_object_id'],
    },
  }
  const sim = portal(lost)
  const h = await harness(sim)
  h.deps.store.write(st, null)
  const plan = await planOn(sim, project(), st)
  expect(plan.missing.map((m) => m.address)).toContain('property:orchard_visit/visit_code')
  expect(plan.steps.find((s) => s.address === visit)).toMatchObject({
    action: 'update',
    risk: 'blocked',
    blocked: { reason: 'dependency-blocked', detail: expect.stringContaining('names visit_code') },
  })
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.issues.map((i) => i.code)).not.toContain('E_PLAN_RISK')
})

test('a schema refusal that is not about a missing property keeps HubSpot own message', async () => {
  const sim = portal(live)
  const refused = {
    status: 'error',
    category: 'VALIDATION_ERROR',
    subCategory: 'ObjectSchemaError.INVALID_LABELS',
    message: 'Plural label is too long',
  }
  sim.fault({ method: 'PATCH', path: `${schemas}/2-4242501`, action: fault.status(400, refused) })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const plan = await planOn(sim, project(visitFile().replace("plural: 'Orchard visits'", "plural: 'Visits'")), owned())
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps[0]).toMatchObject({ address: visit, outcome: 'rejected' })
  const message = String(applied.issues[0]?.message)
  expect(message).toContain('Plural label is too long')
  expect(message).not.toContain('naming a property')
})

test('an update sends every field the schema PATCH takes, so no field comes back as an older copy held it', async () => {
  const sim = portal(live)
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const relabelled = visitFile().replace("plural: 'Orchard visits'", "plural: 'Visits'")
  const plan = await planOn(sim, project(relabelled), owned())
  expect(plan.steps).toMatchObject([
    {
      address: visit,
      action: 'update',
      risk: 'safe',
      changes: [{ unit: 'labels', after: { singular: 'Orchard visit', plural: 'Visits' } }],
    },
  ])
  // An older copy of the schema, which a partial PATCH would bring back.
  const [schema] = sim.portal(portalId).schemas
  sim.portal(portalId).previousSchemas.set('2-4242501', {
    ...schema,
    name: 'orchard_visit',
    objectTypeId: '2-4242501',
    searchableProperties: [],
  })
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.outcome).toBe('done')
  const patch = sim.log.slice(from).find((r) => r.method === 'PATCH')
  expect(patch?.path).toBe(`${schemas}/2-4242501`)
  expect(patch?.body).toMatchObject({
    labels: { singular: 'Orchard visit', plural: 'Visits' },
    searchableProperties: ['visit_code'],
    primaryDisplayProperty: 'visit_code',
  })
  expect(sim.portal(portalId).schemas[0]?.searchableProperties).toEqual(['visit_code'])
})

test('an archive needs a destroy tombstone, allowDestroy and a person, and HubSpot refuses one while records exist', async () => {
  const removed =
    "import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n  'object:orchard_visit': { action: 'destroy' },\n})\n"
  const allow: Edit = [files.config, 'portalId: 1111111,', 'portalId: 1111111,\n      allowDestroy: true,']
  const loaded = loadProject([withVisit, allow], { 'hubspot/removed.ts': removed })
  const sim = portal({ ...live, recordsIn: ['2-4242501'] })
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const plan = await planOn(sim, loaded, owned())
  // What the archive takes along, by count, read by plan and named in the step a person confirms.
  const title =
    'Archive custom object "Orchard visit" (orchard_visit) with its 1 property, 1 group and 0 pipelines; HubSpot keeps no properties on an archived custom object'
  expect(plan.steps.map((s) => [s.address, s.action, s.risk, s.title])).toEqual([
    [visit, 'delete', 'destructive', title],
  ])
  expect(plan.steps[0]?.expect.values?.takes).toEqual({ properties: 1, groups: 1, pipelines: 0 })
  expect(stepTitle(plan.steps[0] as PlanStep, undefined, true)).toBe(title)
  expect(plan.orphans).toEqual([])
  // A property added in HubSpot since the plan: the archive would take more than the person saw, so apply stops.
  const extra = {
    name: 'visit_notes',
    label: 'Visit notes',
    type: 'string',
    fieldType: 'text',
    groupName: 'visit_details',
  }
  const notes = { ...extra, archived: false, dataSensitivity: 'non_sensitive' }
  sim.object(portalId, '2-4242501').properties.set('visit_notes', notes as never)
  const grown = await executePlan(request(plan, 'terminal'), h.deps).catch((e: unknown) => e)
  expect(String((grown as Error).message)).toContain(`${visit} takes`)
  sim.object(portalId, '2-4242501').properties.delete('visit_notes')
  const refused = await executePlan(request(plan, 'terminal'), h.deps)
  expect(refused.data.steps[0]).toMatchObject({ outcome: 'rejected', issue: 'E_HTTP' })
  expect(refused.issues[0]?.message).toContain('HubSpot never archives a custom object that holds records')
  sim.portal(portalId).recordsIn.clear()
  const again = await planOn(sim, loaded, h.deps.store.read(portalId))
  const applied = await executePlan(request(again, 'terminal'), h.deps)
  expect(applied.data.outcome).toBe('done')
  expect(sim.portal(portalId).archivedSchemas.map((s) => s.name)).toEqual(['orchard_visit'])
  // Its group and property went with it.
  expect(Object.keys(h.deps.store.read(portalId)?.resources ?? {}).sort()).toEqual(Object.keys(companiesOwned).sort())
})

test('an archive is proven only by the archived list, never by the object missing from a list read', async () => {
  const removed =
    "import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n  'object:orchard_visit': { action: 'destroy' },\n})\n"
  const allow: Edit = [files.config, 'portalId: 1111111,', 'portalId: 1111111,\n      allowDestroy: true,']
  const loaded = loadProject([withVisit, allow], { 'hubspot/removed.ts': removed })
  const sim = portal(live)
  const h = await harness(sim)
  h.deps.store.write(owned(), null)
  const plan = await planOn(sim, loaded, owned())
  // HubSpot answers the DELETE and archives nothing, and the read right after leaves the object out of the list.
  sim.fault({ method: 'DELETE', path: `${schemas}/2-4242501`, action: fault.status(204) })
  const lists = await (async () => {
    // How many list reads apply makes before its read-back: the observation's and the delete's own read before it.
    const probe = portal(live)
    const ph = await harness(probe)
    ph.deps.store.write(owned(), null)
    const probed = await planOn(probe, loaded, owned())
    const from = probe.log.length
    await executePlan(request(probed, 'terminal'), ph.deps)
    const after = probe.log.slice(from)
    const del = after.findIndex((r) => r.method === 'DELETE')
    return after.slice(0, del).filter((r) => r.method === 'GET' && r.path === schemas).length
  })()
  sim.fault({ method: 'GET', path: schemas, occurrence: lists + 1, action: fault.status(200, { results: [] }) })
  const applied = await executePlan(request(plan, 'terminal'), h.deps)
  expect(applied.data.steps[0]).toMatchObject({ address: visit, outcome: 'unverified' })
  expect(sim.portal(portalId).schemas.map((s) => s.name)).toEqual(['orchard_visit'])
  // Nothing proved the archive, so state still owns the object and what is on it.
  expect(Object.keys(h.deps.store.read(portalId)?.resources ?? {})).toContain(visit)
  expect(Object.keys(h.deps.store.read(portalId)?.resources ?? {})).toContain('property:orchard_visit/visit_code')
})

test('apply stops before a create whose name HubSpot now holds archived, or answers with a schema it held', async () => {
  const sim = portal()
  const h = await harness(sim)
  h.deps.store.write(state(), null)
  const plan = await planOn(sim, project(), state())
  sim.portal(portalId).archivedSchemas.push({ name: 'orchard_visit', objectTypeId: '2-4242777' })
  await expect(executePlan(request(plan), h.deps)).rejects.toMatchObject({
    issues: [{ code: 'E_PLAN_STALE', message: expect.stringContaining(`${visit} archived`) }],
  })
  sim.portal(portalId).archivedSchemas = []
  // A create answered 201 with a schema the list held: HubSpot's answer to an active name, which made nothing.
  sim
    .portal(portalId)
    .schemas.push({ name: 'harvest_log', objectTypeId: '2-4242888', labels: { singular: 'Log', plural: 'Logs' } })
  sim.fault({
    method: 'POST',
    path: schemas,
    action: fault.status(201, { name: 'orchard_visit', objectTypeId: '2-4242888' }),
  })
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.steps.find((s) => s.address === visit)).toMatchObject({
    outcome: 'uncertain',
    issue: 'E_UNCERTAIN_WRITE',
  })
  expect(h.deps.store.read(portalId)?.resources[visit]).toBeUndefined()
})

test('a display field names a property by its local name, and the schema PATCH by the portal name an override gives', async () => {
  const rename: Edit = [
    files.config,
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: { 'property:orchard_visit/visit_code': { name: 'visit_ref' } },",
  ]
  const renamed = structuredClone(live)
  const [schema] = renamed.schemas ?? []
  Object.assign(schema ?? {}, { primaryDisplayProperty: 'visit_ref', searchableProperties: ['visit_ref'] })
  const props = renamed.objects?.['2-4242501']?.properties ?? []
  Object.assign(props[1] ?? {}, { name: 'visit_ref' })
  const sim = portal(renamed)
  const h = await harness(sim)
  const start = owned()
  Object.assign(start.resources['property:orchard_visit/visit_code'] ?? {}, { id: 'visit_ref' })
  // Config and HubSpot last agreed on no required property, so requiring one is config's change.
  Object.assign(start.resources[visit]?.base ?? {}, { requiredProperties: [] })
  h.deps.store.write(start, null)
  const required = visitFile().replace(
    "searchableProperties: ['visit_code'],",
    "searchableProperties: ['visit_code'],\n  requiredProperties: ['visit_code'],",
  )
  const plan = await planOn(sim, loadProject([withVisit, rename], { [VISIT]: required }), start)
  expect(plan.bindings['property:orchard_visit/visit_code']).toEqual({ name: 'visit_ref' })
  expect(plan.steps).toMatchObject([
    { address: visit, changes: [{ unit: 'requiredProperties', after: ['visit_code'] }] },
  ])
  const from = sim.log.length
  const applied = await executePlan(request(plan), h.deps)
  expect(applied.data.outcome).toBe('done')
  expect(sim.log.slice(from).find((r) => r.method === 'PATCH')?.body).toMatchObject({
    primaryDisplayProperty: 'visit_ref',
    requiredProperties: ['visit_ref'],
    searchableProperties: ['visit_ref'],
  })
})
