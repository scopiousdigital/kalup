// Scenario: a portal with a custom object. The first apply adopts the custom object with its group and property, from
// a saved plan and without one; a group and a property created on it later go to the object's type ID; a second run
// writes nothing. The schema itself is never written, and a plan step that names the object by its type ID is refused.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  apply,
  applyNow,
  configFile,
  edit,
  effects,
  environment,
  liveProperty,
  planOf,
  portal,
  portalId,
  project,
  savePlan,
  stateBytes,
  stateOf,
  writePlan,
  writesOf,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const typeId = '2-5500001'
const inspections = `/crm/properties/2026-09/${typeId}`
const schemas = '/crm-object-schemas/2026-09/schemas'
const inspection = 'object:inspection'
const details = 'group:inspection/inspection_details'
const inspectionName = 'property:inspection/inspection_name'
const colony = 'group:inspection/colony'
const queenSeen = 'property:inspection/queen_seen'

const QUEEN_SEEN = `    queenSeen: p.string('queen_seen', {
      label: 'Queen seen',
      group: 'colony',
      fieldType: 'text',
    }),
`

/** Writes kalup/objects/inspection.ts: the custom object, its details group and name property, plus `extra`. */
function inspectionFile(dir: string, extra: { groups?: string; properties?: string } = {}): void {
  const text = [
    "import { defineCustomObject, type InferProperties, p } from '@kalup/core'",
    '',
    "export const Inspection = defineCustomObject('inspection', {",
    "  labels: { singular: 'Inspection', plural: 'Inspections' },",
    "  primaryDisplayProperty: 'inspection_name',",
    "  requiredProperties: ['inspection_name'],",
    "  searchableProperties: ['inspection_name'],",
    '  groups: {',
    "    inspection_details: { label: 'Inspection details' },",
    `${extra.groups ?? ''}  },`,
    '  properties: {',
    "    inspectionName: p.string('inspection_name', {",
    "      label: 'Inspection name',",
    "      group: 'inspection_details',",
    "      fieldType: 'text',",
    '    }),',
    `${extra.properties ?? ''}  },`,
    '})',
    '',
    'export type InspectionData = InferProperties<typeof Inspection.properties> & { id: string }',
    '',
  ]
  writeFileSync(join(dir, 'kalup', 'objects', 'inspection.ts'), text.join('\n'))
}

/** A project with the apiary on companies and the inspection custom object, as the portal holds it. */
function inspectionProject(): string {
  const dir = project()
  edit(dir, configFile, '    companies: {},\n', '    companies: {},\n    inspection: {},\n')
  inspectionFile(dir)
  return dir
}

/** The Kestrel portal with the inspection custom object, its details group and its name property. */
function inspectionPortal() {
  return portal({
    schemas: [
      {
        name: 'inspection',
        objectTypeId: typeId,
        labels: { singular: 'Inspection', plural: 'Inspections' },
        primaryDisplayProperty: 'inspection_name',
        requiredProperties: ['inspection_name'],
        searchableProperties: ['inspection_name'],
        secondaryDisplayProperties: [],
      },
    ],
    objects: {
      companies: {
        groups: [{ name: 'companyinformation', label: 'Company information' }],
        properties: [],
      },
      [typeId]: {
        groups: [{ name: 'inspection_details', label: 'Inspection details' }],
        properties: [
          liveProperty({
            name: 'inspection_name',
            label: 'Inspection name',
            type: 'string',
            fieldType: 'text',
            groupName: 'inspection_details',
          }),
        ],
      },
    },
  })
}

test('custom object, saved plan: the first apply adopts it, a later group and property go to its type ID, and a second run writes nothing', async () => {
  const sim = inspectionPortal()
  const dir = inspectionProject()

  const first = await savePlan(dir)
  expect(first.bindings[inspection]).toEqual({ id: typeId })
  expect(effects(first).map((s) => [s.address, s.action])).toEqual([
    [inspection, 'adopt'],
    ['group:companies/apiary', 'create'],
    [details, 'adopt'],
    ['property:companies/hive_count', 'create'],
    [inspectionName, 'adopt'],
  ])
  const adopted = await apply(dir, 'plan.json', '--yes', '--json')
  expect(adopted.exitCode, adopted.stdout).toBe(0)
  expect(adopted.data?.steps.map((s) => [s.address, s.outcome])).toEqual([
    [inspection, 'done'],
    ['group:companies/apiary', 'done'],
    [details, 'done'],
    ['property:companies/hive_count', 'done'],
    [inspectionName, 'done'],
  ])
  // Nothing is written on the custom object: its schema is adopted, never sent.
  expect(writesOf(sim)).toEqual([
    'POST /crm/properties/2026-09/companies/groups',
    'POST /crm/properties/2026-09/companies',
  ])
  expect(sim.log.filter((r) => r.path === schemas).length).toBeGreaterThan(0)
  expect(stateOf(dir).resources[inspection]).toEqual({
    origin: 'adopted',
    id: 'inspection',
    normVersion: 1,
    base: {
      labels: { plural: 'Inspections', singular: 'Inspection' },
      primaryDisplayProperty: 'inspection_name',
      requiredProperties: ['inspection_name'],
      searchableProperties: ['inspection_name'],
    },
  })
  expect(stateOf(dir).resources[details]).toMatchObject({ origin: 'adopted', id: 'inspection_details' })

  // A group and a property created on the custom object: sent to its type ID.
  inspectionFile(dir, { groups: "    colony: { label: 'Colony' },\n", properties: QUEEN_SEEN })
  const creates = await savePlan(dir)
  expect(effects(creates).map((s) => [s.address, s.action])).toEqual([
    [colony, 'create'],
    [queenSeen, 'create'],
  ])
  const from = sim.log.length
  const created = await apply(dir, 'plan.json', '--yes', '--json')
  expect(created.exitCode, created.stdout).toBe(0)
  expect(writesOf(sim, from)).toEqual([`POST ${inspections}/groups`, `POST ${inspections}`])
  expect(sim.object(portalId, typeId).properties.get('queen_seen')).toMatchObject({
    groupName: 'colony',
    label: 'Queen seen',
  })
  expect(stateOf(dir).resources[queenSeen]).toMatchObject({ origin: 'created', id: 'queen_seen' })
  expect(stateOf(dir).resources[colony]).toMatchObject({ origin: 'created', id: 'colony', base: { label: 'Colony' } })

  // A second run: nothing to plan, nothing written, state byte for byte as it was.
  const again = await planOf(dir)
  expect(effects(again)).toEqual([])
  const bytes = stateBytes(dir)
  const next = sim.log.length
  const nothing = await apply(dir, '--yes', '--json')
  expect(nothing.exitCode, nothing.stdout).toBe(0)
  expect(nothing.data?.outcome).toBe('nothing')
  expect(writesOf(sim, next)).toEqual([])
  expect(stateBytes(dir)).toBe(bytes)
})

test('custom object, direct apply: the first run adopts it, and a second run writes nothing', async () => {
  const sim = inspectionPortal()
  const dir = inspectionProject()
  const out = await apply(dir, '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.data?.steps.find((s) => s.address === inspection)).toMatchObject({ action: 'adopt', outcome: 'done' })
  expect(writesOf(sim)).toEqual([
    'POST /crm/properties/2026-09/companies/groups',
    'POST /crm/properties/2026-09/companies',
  ])
  expect(stateOf(dir).resources[inspection]).toMatchObject({ origin: 'adopted', id: 'inspection' })
  expect(stateOf(dir).resources[inspectionName]).toMatchObject({ origin: 'adopted', id: 'inspection_name' })

  const bytes = stateBytes(dir)
  const from = sim.log.length
  const again = await apply(dir, '--yes', '--json')
  expect(again.exitCode, again.stdout).toBe(0)
  expect(again.data?.outcome).toBe('nothing')
  expect(writesOf(sim, from)).toEqual([])
  expect(stateBytes(dir)).toBe(bytes)
})

test('custom object: a schema change is a note, and a forged schema write is refused before any write', async () => {
  const sim = inspectionPortal()
  const dir = inspectionProject()
  await applyNow(dir)
  edit(dir, 'kalup/objects/inspection.ts', "plural: 'Inspections'", "plural: 'Hive inspections'")
  const changed = await savePlan(dir)
  const step = changed.steps.find((s) => s.address === inspection)
  expect(step?.notes?.map((n) => n.note)).toEqual([
    'not written: custom object schema writes are not supported in this release',
  ])
  expect(effects(changed)).toEqual([])

  // A forger turns the note into a write and recomputes the digest: trusted derivation finds no update for it.
  const labels = { singular: 'Inspection', plural: 'Hive inspections' }
  const change = { unit: 'labels', class: 'config-change' as const, op: 'set' as const, before: null, after: labels }
  const forged = {
    ...changed,
    steps: changed.steps.map((s) => (s.address === inspection ? { ...s, changes: [change] } : s)),
  }
  writePlan(dir, forged, true)
  const bytes = stateBytes(dir)
  const from = sim.log.length
  // Without the type ID binding a step on the object needs, the bindings are refused first.
  const unbound = await apply(dir, 'plan.json', '--yes', '--json')
  expect(unbound.codes).toEqual(['E_BINDING_CHANGED'])
  expect(unbound.issues[0]?.message).toContain(
    `${inspection} was bound to no type ID, and the portal has type ID ${typeId}`,
  )
  writePlan(dir, { ...forged, bindings: { [inspection]: { id: typeId } } }, true)
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(1)
  expect(out.codes).toEqual(['E_PLAN_RISK'])
  expect(out.issues[0]?.message).toContain('HubSpot has no update for labels')
  expect(writesOf(sim, from)).toEqual([])
  expect(stateBytes(dir)).toBe(bytes)
})

test('custom object: a forged twin that names the object by its type ID is E_BINDING_CHANGED before any write', async () => {
  const sim = inspectionPortal()
  const dir = inspectionProject()
  const plan = await savePlan(dir)
  // The adopt of inspection_name again, under the type ID: one portal property, two addresses.
  const adopt = plan.steps.find((s) => s.address === inspectionName)
  const twin = JSON.parse(JSON.stringify(adopt).replaceAll('inspection/', `${typeId}/`))
  writePlan(dir, { ...plan, steps: [...plan.steps, { ...twin, id: `s${plan.steps.length + 1}` }] }, true)
  const from = sim.log.length
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(1)
  expect(out.codes).toEqual(['E_BINDING_CHANGED'])
  expect(out.issues[0]?.message).toContain(
    `the plan touches ${typeId}, which kalup.config.ts does not declare under objects`,
  )
  expect(out.issues[0]?.message).toContain(
    `${inspectionName} and property:${typeId}/inspection_name both resolve to property:${typeId}/inspection_name in the portal`,
  )
  expect(writesOf(sim, from)).toEqual([])
  expect(stateBytes(dir)).toBeNull()
})
