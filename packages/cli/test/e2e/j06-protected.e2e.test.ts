// J6, a protected production portal: init on a STANDARD account names the target production and protects it. A
// change there applies only from a saved plan a person confirms at a terminal: apply without a plan file is refused,
// and --yes is refused for the saved plan. The plan names the internal name it makes permanent.
import { expect, test } from 'vitest'
import { printed } from '../support/printed.js'
import { journey, simulator } from './journey.js'
import { initialised, nursery } from './nursery.js'

const SEED_TRAYS = `    seedTrays: p.number('seed_trays', {
      label: 'Seed trays',
      group: 'nursery',
      fieldType: 'number',
    }),
`

test('J6 protected production: only a saved plan confirmed at a terminal applies; --yes is refused', async () => {
  const j = journey(await simulator({ production: nursery({ accountType: 'STANDARD' }) }))
  await initialised(j, 'production')
  expect(j.read('kalup.config.ts')).toContain('    production: {\n      portalId: 8800303,\n      protected: true,')

  j.edit('kalup/objects/companies.ts', '  },\n})', `${SEED_TRAYS}  },\n})`)
  const unsaved = await j.kalup('apply', '--yes', '--json')
  expect(unsaved.exitCode).toBe(1)
  expect(unsaved.codes).toEqual(['E_PROTECTED_SAVED_PLAN'])
  expect(unsaved.envelope?.issues[0]?.fix).toContain('kalup plan --target production --out plan.json')

  const saved = await j.kalup('plan', '--out', 'plan.json', '--json')
  expect(saved.exitCode, saved.stdout).toBe(0)
  expect(saved.data).toMatchObject({
    target: { name: 'production', accountType: 'STANDARD', protected: true },
    permanentNames: 1,
  })
  const yes = await j.kalup('apply', 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  expect(j.writes()).toEqual([])

  const confirmed = await j.terminal(['apply', 'plan.json'], { 'Type the target name to apply:': 'production' })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(printed({ stdout: confirmed.printed, stderr: '' })).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target production, portal 8800303 (STANDARD, protected):
      s1 safe Adopt property group "Nursery" (nursery) on companies
      s2 safe Adopt property "Bed count" (bed_count) on companies
      s3 safe Adopt property "Grower notes" (grower_notes) on companies
      s4 safe Adopt property "Last frost" (last_frost) on companies
      s5 safe Adopt property "Nursery zone" (nursery_zone) on companies
      s6 safe Adopt property "Plant families" (plant_families) on companies
      s7 safe Create property "Seed trays" (seed_trays) on companies
    1 writes, 6 adoptions, 0 releases, 0 base records, 0 destructive
    Type the target name to apply: production
    Applied plan pl_<id> on target production, portal 8800303
    s1 done Adopt property group "Nursery" (nursery) on companies
    s2 done Adopt property "Bed count" (bed_count) on companies
    s3 done Adopt property "Grower notes" (grower_notes) on companies
    s4 done Adopt property "Last frost" (last_frost) on companies
    s5 done Adopt property "Nursery zone" (nursery_zone) on companies
    s6 done Adopt property "Plant families" (plant_families) on companies
    s7 done Create property "Seed trays" (seed_trays) on companies
    7 done.
    State: <dir>/larkspur/.kalup/state/portal-8800303.json (serial 5). Journal: <dir>/larkspur/.kalup/journal/portal-8800303/pl_<id>-<time>.jsonl
    "
  `)
  expect((await j.backend.ui.property('production', 'companies', 'seed_trays')).label).toBe('Seed trays')
  await j.planIsEmpty()
}, 60_000)
