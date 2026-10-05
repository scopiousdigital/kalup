// J14, a custom object: config defines one the portal lacks; apply creates the schema bare, then its group and
// property, then sets its display fields. A label change is one full schema PATCH. A description changed in HubSpot is
// held and taken with pull. kalup rm and a person at a terminal archive it with what is on it. Every plan after an
// apply is empty.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { journey, simulator } from './journey.js'

const FILE = 'hubspot/objects/orchard_visit.ts'
const VISIT = 'object:orchard_visit'
const SCHEMAS = '/crm-object-schemas/2026-09/schemas'

const OBJECT = [
  "import { defineCustomObject, type InferProperties, p } from '@kalup/core'",
  '',
  "export const OrchardVisit = defineCustomObject('orchard_visit', {",
  "  labels: { singular: 'Orchard visit', plural: 'Orchard visits' },",
  "  description: 'One visit to one orchard.',",
  "  primaryDisplayProperty: 'visit_code',",
  "  searchableProperties: ['visit_code'],",
  '  groups: {',
  "    visit_details: { label: 'Visit details' },",
  '  },',
  '  properties: {',
  "    visitCode: p.string('visit_code', { label: 'Visit code', group: 'visit_details', fieldType: 'text' }),",
  '  },',
  '})',
  '',
  'export type OrchardVisitData = InferProperties<typeof OrchardVisit.properties> & { id: string }',
  '',
].join('\n')

test('J14 custom object: created bare then completed, relabelled, a held UI edit taken with pull, then archived', async () => {
  const j = journey(await simulator({ sandbox: { accountType: 'DEVELOPER_TEST' } }))
  const portal = String(j.backend.portals.sandbox?.portalId)
  expect((await j.kalup('init', '--portal', portal, '--objects', 'companies')).exitCode).toBe(0)
  j.edit('kalup.config.ts', 'companies: {},', 'companies: {},\n    orchard_visit: {},')
  mkdirSync(join(j.dir, 'hubspot', 'objects'), { recursive: true })
  writeFileSync(join(j.dir, FILE), OBJECT)

  const created = await j.plan()
  expect(created.steps.map((s) => [s.action, s.risk, s.address])).toEqual([
    ['create', 'safe', VISIT],
    ['create', 'safe', 'group:orchard_visit/visit_details'],
    ['create', 'safe', 'property:orchard_visit/visit_code'],
  ])
  const apply = await j.kalup('apply', '--yes')
  expect(apply.exitCode, apply.stdout + apply.stderr).toBe(0)
  const typeId = String((await j.backend.ui.schema('sandbox', 'orchard_visit'))?.objectTypeId)
  expect(j.writes()).toEqual([
    `POST ${SCHEMAS}`,
    `POST /crm/properties/2026-09/${typeId}/groups`,
    `POST /crm/properties/2026-09/${typeId}`,
    `PATCH ${SCHEMAS}/${typeId}`,
  ])
  expect(await j.backend.ui.schema('sandbox', 'orchard_visit')).toMatchObject({
    primaryDisplayProperty: 'visit_code',
    searchableProperties: ['visit_code'],
    description: 'One visit to one orchard.',
  })
  await j.planIsEmpty()

  j.edit(FILE, "plural: 'Orchard visits'", "plural: 'Site visits'")
  const relabelled = await j.plan()
  expect(relabelled.steps.map((s) => [s.action, s.risk, s.address, (s.changes ?? []).map((c) => c.unit)])).toEqual([
    ['update', 'safe', VISIT, ['labels']],
  ])
  expect((await j.kalup('apply', '--yes')).exitCode).toBe(0)
  expect((await j.backend.ui.schema('sandbox', 'orchard_visit'))?.labels?.plural).toBe('Site visits')
  await j.planIsEmpty()

  await j.backend.ui.editSchema('sandbox', 'orchard_visit', { description: 'Every orchard visit.' })
  const held = await j.plan()
  expect(held.steps).toMatchObject([
    {
      address: VISIT,
      held: [
        { unit: 'description', class: 'drift', config: 'One visit to one orchard.', live: 'Every orchard visit.' },
      ],
    },
  ])
  const pulled = await j.kalup('pull', '--only', VISIT)
  expect(pulled.exitCode, pulled.stdout + pulled.stderr).toBe(0)
  expect(j.read(FILE)).toContain("description: 'Every orchard visit.'")
  await j.planIsEmpty()

  expect((await j.kalup('rm', VISIT)).exitCode).toBe(0)
  j.edit('kalup.config.ts', `portalId: ${portal},`, `portalId: ${portal},\n      allowDestroy: true,`)
  const removal = await j.plan()
  expect(removal.steps.map((s) => [s.action, s.risk, s.address])).toEqual([['delete', 'destructive', VISIT]])
  const confirmed = await j.terminal(['apply'], {
    'Type the target name to apply:': 'production',
    'Type the number of destructive steps (1):': '1',
  })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(await j.backend.ui.schema('sandbox', 'orchard_visit')).toBeUndefined()
  expect(Object.keys(j.state().resources).filter((a) => a.includes('orchard_visit'))).toEqual([])
  await j.planIsEmpty()
}, 60_000)
