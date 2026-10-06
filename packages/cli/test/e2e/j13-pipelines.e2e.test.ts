// J13, pipelines: init turns them on for deals, the first pull writes HubSpot's own sales pipeline into
// hubspot/pipelines/deals.ts and apply adopts it. A new pipeline goes in with its stages in one create. A stage added
// in the middle is created at the end and moved into place, a stage relabelled in HubSpot is held and taken with pull,
// and a stage tombstone deletes it at a terminal. A snapshot counts the pipelines. Every plan after an apply is empty.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { journey, simulator } from './journey.js'

const FILE = 'hubspot/pipelines/deals.ts'
const ORCHARD = [
  '',
  "export const OrchardSalesPipeline = definePipeline('deals', {",
  "  id: 'orchard_sales',",
  "  label: 'Orchard sales',",
  '  displayOrder: 1,',
  '  stages: {',
  "    tasting: { id: 'orchard_tasting', label: 'Tasting', probability: 0.2 },",
  "    signed: { id: 'orchard_signed', label: 'Signed', probability: 1 },",
  '  },',
  '})',
  '',
].join('\n')

test('J13 pipelines: pull, adopt, create, insert a stage, a held UI edit taken with pull, and a stage deleted', async () => {
  const j = journey(await simulator({ sandbox: { accountType: 'DEVELOPER_TEST' } }))
  const portal = String(j.backend.portals.sandbox?.portalId)
  expect((await j.kalup('init', '--portal', portal, '--objects', 'deals')).exitCode).toBe(0)
  expect(j.read('kalup.config.ts')).toContain('deals: { pipelines: true, associations: true },')
  expect((await j.kalup('pull')).exitCode).toBe(0)
  expect(j.read(FILE)).toMatchInlineSnapshot(`
    "import { definePipeline } from '@kalup/core'

    export const SalesPipeline = definePipeline('deals', {
      id: 'default',
      label: 'Sales Pipeline',
      displayOrder: 0,
      stages: {
        appointmentscheduled: { id: 'appointmentscheduled', label: 'Appointment Scheduled', probability: 0.2 },
        contractsent: { id: 'contractsent', label: 'Contract Sent', probability: 0.9 },
        closedwon: { id: 'closedwon', label: 'Closed Won', probability: 1 },
        closedlost: { id: 'closedlost', label: 'Closed Lost', probability: 0 },
      },
    })
    "
  `)
  expect(j.read('hubspot/index.ts')).toContain("export { SalesPipeline } from './pipelines/deals.js'")

  const adopt = await j.plan()
  expect(adopt.steps.map((s) => [s.action, s.address])).toEqual([
    ['adopt', 'pipeline:deals/default'],
    ['adopt', 'stage:deals/default/appointmentscheduled'],
    ['adopt', 'stage:deals/default/closedlost'],
    ['adopt', 'stage:deals/default/closedwon'],
    ['adopt', 'stage:deals/default/contractsent'],
  ])
  expect((await j.kalup('apply', '--yes')).exitCode).toBe(0)
  expect(j.writes()).toEqual([])
  await j.planIsEmpty()

  writeFileSync(join(j.dir, FILE), `${j.read(FILE)}${ORCHARD}`)
  const created = await j.plan()
  expect(created.steps.map((s) => [s.action, s.risk, s.address, (s.stages ?? []).length])).toEqual([
    ['create', 'safe', 'pipeline:deals/orchard_sales', 2],
  ])
  expect((await j.kalup('apply', '--yes')).exitCode).toBe(0)
  expect(j.writes()).toEqual(['POST /crm/pipelines/2026-09/deals'])
  await j.planIsEmpty()
  const snapshot = await j.kalup<{ counts: Record<string, number> }>('snapshot', '--json')
  expect(snapshot.data?.counts).toMatchObject({ pipelines: 2, stages: 6 })

  j.edit(
    FILE,
    "    signed: { id: 'orchard_signed'",
    "    pressing: { id: 'orchard_pressing', label: 'Pressing', probability: 0.6 },\n    signed: { id: 'orchard_signed'",
  )
  j.edit(FILE, "label: 'Tasting'", "label: 'Tasting booked'")
  const inserted = await j.plan()
  expect(inserted.steps.map((s) => [s.action, s.risk, s.address, (s.changes ?? []).map((c) => c.unit)])).toEqual([
    ['update', 'safe', 'pipeline:deals/orchard_sales', ['stages']],
    ['create', 'safe', 'stage:deals/orchard_sales/orchard_pressing', []],
    ['update', 'safe', 'stage:deals/orchard_sales/orchard_tasting', ['label']],
  ])
  expect((await j.kalup('apply', '--yes')).exitCode).toBe(0)
  const { ui } = j.backend
  const orchard = await ui.pipeline('sandbox', 'deals', 'orchard_sales')
  expect(orchard?.stages.map((st) => [st.id, st.label])).toEqual([
    ['orchard_tasting', 'Tasting booked'],
    ['orchard_pressing', 'Pressing'],
    ['orchard_signed', 'Signed'],
  ])
  await j.planIsEmpty()

  await ui.editStage('sandbox', 'deals', 'orchard_sales', 'orchard_signed', 'Signed and paid')
  const held = await j.plan()
  expect(held.steps).toMatchObject([
    {
      address: 'stage:deals/orchard_sales/orchard_signed',
      held: [{ unit: 'label', class: 'drift', config: 'Signed', live: 'Signed and paid' }],
    },
  ])
  expect((await j.kalup('pull', '--only', 'stage:deals/orchard_sales/orchard_signed')).exitCode).toBe(0)
  expect(j.read(FILE)).toContain("label: 'Signed and paid'")
  await j.planIsEmpty()

  const rm = await j.kalup('rm', 'stage:deals/orchard_sales/orchard_pressing')
  expect(rm.exitCode, rm.stderr).toBe(0)
  j.edit('kalup.config.ts', 'credentials:', 'allowDestroy: true,\n      credentials:')
  const removal = await j.plan()
  expect(removal.steps.map((s) => [s.action, s.risk, s.address])).toEqual([
    ['delete', 'destructive', 'stage:deals/orchard_sales/orchard_pressing'],
  ])
  const yes = await j.kalup('apply', '--yes', '--json')
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  const confirmed = await j.terminal(['apply'], {
    'Type the target name to apply:': 'production',
    'Type the number of destructive steps (1):': '1',
  })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect((await ui.pipeline('sandbox', 'deals', 'orchard_sales'))?.stages.map((st) => st.id)).toEqual([
    'orchard_tasting',
    'orchard_signed',
  ])
  expect(j.state().resources['stage:deals/orchard_sales/orchard_pressing']).toBeUndefined()
  await j.planIsEmpty()
})
