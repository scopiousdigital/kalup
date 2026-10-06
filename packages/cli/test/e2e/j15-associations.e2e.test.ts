// J15, association labels: init turns them on for its objects, and the first pull writes a label made in the HubSpot
// UI into hubspot/associations.ts, in the pair's order; apply adopts it. A new label and a relabel go in; HubSpot's
// schema read lists the new label's name only some reads later, and the plan after the apply names it by the type IDs
// state records. A relabel in the HubSpot UI is held and taken with pull, and kalup rm and a person at a terminal
// delete the label. Every plan after an apply is empty.
import { expect, test } from 'vitest'
import { journey, simulator } from './journey.js'

const FILE = 'hubspot/associations.ts'
const BUYER = 'association:companies/deals/orchard_buyer'
const SUPPLIER = 'association:deals/companies/orchard_supplier'
const LABELS = '/crm/associations/2026-09'

test('J15 association labels: pull, adopt, create and relabel, a held UI edit taken with pull, and a delete', async () => {
  const j = journey(
    await simulator({
      sandbox: {
        accountType: 'DEVELOPER_TEST',
        // The schema read leaves out a new label's name for this many reads (observed: up to about 5 minutes).
        associationNameLag: 40,
        associations: [
          { from: 'deals', to: 'companies', name: 'orchard_buyer', label: 'Buyer', inverseLabel: 'Buys from' },
        ],
      },
    }),
  )
  const portal = String(j.backend.portals.sandbox?.portalId)
  expect((await j.kalup('init', '--portal', portal, '--objects', 'companies,deals')).exitCode).toBe(0)
  expect(j.read('kalup.config.ts')).toContain('companies: { associations: true },')
  const pulled = await j.kalup('pull')
  expect(pulled.exitCode, pulled.stdout + pulled.stderr).toBe(0)
  expect(j.read(FILE)).toMatchInlineSnapshot(`
    "import { defineAssociations } from '@kalup/core'

    export const Associations = defineAssociations({
      orchardBuyer: { from: 'companies', to: 'deals', name: 'orchard_buyer', label: 'Buys from', inverseLabel: 'Buyer' },
    })
    "
  `)
  expect(j.read('hubspot/index.ts')).toContain("export { Associations } from './associations.js'")

  // init turns the deal pipelines on too: apply adopts HubSpot's sales pipeline with the label.
  const adopt = await j.plan()
  expect(adopt.steps.filter((s) => !s.address.includes('deals/default')).map((s) => [s.action, s.address])).toEqual([
    ['adopt', BUYER],
  ])
  expect((await j.kalup('apply', '--yes')).exitCode).toBe(0)
  expect(j.writes()).toEqual([])
  await j.planIsEmpty()

  j.edit(FILE, "label: 'Buys from'", "label: 'Buys fruit from'")
  j.edit(
    FILE,
    '})',
    "  orchardSupplier: { from: 'deals', to: 'companies', name: 'orchard_supplier', label: 'Supplier', inverseLabel: 'Supplied by' },\n})",
  )
  const written = await j.plan()
  expect(written.steps.map((s) => [s.action, s.risk, s.address, (s.changes ?? []).map((c) => c.unit)])).toEqual([
    ['update', 'safe', BUYER, ['label']],
    ['create', 'safe', SUPPLIER, []],
  ])
  const applied = await j.kalup('apply', '--yes')
  expect(applied.exitCode, applied.stdout + applied.stderr).toBe(0)
  expect(j.writes()).toEqual([`POST ${LABELS}/deals/companies/labels`, `PUT ${LABELS}/companies/deals/labels`])
  expect(await j.backend.ui.labels('sandbox', 'deals', 'companies')).toEqual(
    expect.arrayContaining([
      { label: 'Buyer', typeId: expect.any(Number) },
      { label: 'Supplier', typeId: expect.any(Number) },
    ]),
  )
  // The schema read still leaves the new name out: the plan names the label by the type IDs state records.
  expect(j.state().resources[SUPPLIER]?.typeIds).toHaveLength(2)
  await j.planIsEmpty()

  // Minutes later a person relabels it: within minutes of apply's write it would be settling, not drift.
  await j.later()
  const supplier = (await j.backend.ui.labels('sandbox', 'deals', 'companies')).find((l) => l.label === 'Supplier')
  await j.backend.ui.editLabel('sandbox', ['deals', 'companies'], supplier?.typeId as number, [
    'Fruit supplier',
    'Supplied by',
  ])
  const held = await j.plan()
  expect(held.steps).toMatchObject([
    { address: SUPPLIER, held: [{ unit: 'label', class: 'drift', config: 'Supplier', live: 'Fruit supplier' }] },
  ])
  const taken = await j.kalup('pull', '--only', SUPPLIER)
  expect(taken.exitCode, taken.stdout + taken.stderr).toBe(0)
  expect(j.read(FILE)).toContain("label: 'Fruit supplier'")
  await j.planIsEmpty()

  expect((await j.kalup('rm', SUPPLIER)).exitCode).toBe(0)
  expect(j.read(FILE)).not.toContain('orchard_supplier')
  j.edit('kalup.config.ts', `portalId: ${portal},`, `portalId: ${portal},\n      allowDestroy: true,`)
  const removal = await j.plan()
  expect(removal.steps.map((s) => [s.action, s.risk, s.address])).toEqual([['delete', 'destructive', SUPPLIER]])
  const confirmed = await j.terminal(['apply'], {
    'Type the target name to apply:': 'production',
    'Type the number of destructive steps (1):': '1',
  })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(j.writes().at(-1)).toBe(`DELETE ${LABELS}/deals/companies/labels/${supplier?.typeId}`)
  expect((await j.backend.ui.labels('sandbox', 'deals', 'companies')).map((l) => l.label)).toEqual(['Buyer'])
  expect(j.state().resources[SUPPLIER]).toBeUndefined()
  await j.planIsEmpty()
}, 60_000)
