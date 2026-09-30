// J6, a protected production portal: init writes no protection, and the STANDARD account protects the target by
// default. A change there applies only with a person at a terminal: apply without a plan file and with no terminal is
// refused before it plans, --yes is refused for a saved plan, a saved plan applies once the person confirms it, and a
// later change applies in one step, planned and confirmed in the same run. The plan names the internal name it makes
// permanent.
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
const PLAN_FILE = /Wrote (\.kalup\/plans\/production-pl_[0-9a-f]{12}\.json)\n/

test('J6 protected production: a person at a terminal applies a saved plan or a plan made in the same run', async () => {
  const j = journey(await simulator({ production: nursery({ accountType: 'STANDARD' }) }))
  await initialised(j, 'production')
  expect(j.read('kalup.config.ts')).toContain('    production: {\n      portalId: 8800303,\n      credentials:')

  j.edit('hubspot/objects/companies.ts', '  },\n})', `${SEED_TRAYS}  },\n})`)
  const unsaved = await j.kalup('apply', '--yes', '--json')
  expect(unsaved.exitCode).toBe(4)
  expect(unsaved.codes).toEqual(['E_PROTECTED_SAVED_PLAN'])
  expect(unsaved.envelope?.issues[0]).toMatchObject({
    humanRequired: true,
    fix: 'ask the user to run kalup apply --target production in a terminal, where they confirm it; in CI, apply a plan saved with kalup plan --target production --out after review',
  })

  const saved = await j.kalup('plan', '--out')
  expect(saved.exitCode, saved.stderr).toBe(0)
  const file = PLAN_FILE.exec(saved.stdout)?.[1] as string
  expect(JSON.parse(j.read(file))).toMatchObject({
    target: { name: 'production', accountType: 'STANDARD', protected: true },
    permanentNames: 1,
  })
  const yes = await j.kalup('apply', file, '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  expect(j.writes()).toEqual([])

  const confirmed = await j.terminal(['apply', file], { 'Type the target name to apply:': 'production' })
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
    1 write, 6 adoptions, 0 destructive
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

  // One step: apply plans now, shows the plan at the terminal and applies what the person confirmed.
  j.edit('hubspot/objects/companies.ts', "label: 'Seed trays'", "label: 'Seed tray count'")
  const direct = await j.terminal(['apply'], { 'Type the target name to apply:': 'production' })
  expect(direct.exitCode, direct.printed).toBe(0)
  expect(printed({ stdout: direct.printed, stderr: '' })).toMatchInlineSnapshot(`
    "Plan pl_<id> for target production, portal 8800303 (STANDARD, protected)
    Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    s1 safe Update property "Seed tray count" (seed_trays) on companies, set label
      label: "Seed trays" -> "Seed tray count"
    1 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 0 held
    Coverage: complete; 0 unsupported, 0 skipped.
    About 8 API calls; 999968 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    Apply plan pl_<id> to target production, portal 8800303 (STANDARD, protected):
      s1 safe Update property "Seed tray count" (seed_trays) on companies, set label
    1 write, 0 destructive
    Type the target name to apply: production
    Target production, portal 8800303 (the only target)
    Applied plan pl_<id> on target production, portal 8800303
    s1 done Update property "Seed tray count" (seed_trays) on companies, set label
    1 done.
    State: <dir>/larkspur/.kalup/state/portal-8800303.json (serial 8). Journal: <dir>/larkspur/.kalup/journal/portal-8800303/pl_<id>-<time>.jsonl
    "
  `)
  expect((await j.backend.ui.property('production', 'companies', 'seed_trays')).label).toBe('Seed tray count')
  await j.planIsEmpty()
}, 60_000)
