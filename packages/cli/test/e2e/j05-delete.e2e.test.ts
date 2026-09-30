// J5, a delete: kalup rm writes a destroy tombstone, the target allows destroying, and the plan deletes the property.
// --yes never covers a delete. A person at a terminal types the target name and the number of destructive steps; the
// property reads archived, state drops its entry, and the plan after it is empty.
import { expect, test } from 'vitest'
import { printed } from '../support/printed.js'
import { journey, simulator } from './journey.js'
import { adopted, nursery } from './nursery.js'

const NOTES = 'property:companies/grower_notes'

test('J5 delete: rm, allowDestroy and a person at a terminal archive the property; --yes is refused', async () => {
  const j = journey(await simulator({ sandbox: nursery() }))
  await adopted(j)

  const rm = await j.kalup('rm', NOTES)
  expect(rm.exitCode, rm.stderr).toBe(0)
  expect(j.read('kalup/removed.ts')).toContain(`'${NOTES}': { action: 'destroy' }`)
  expect(j.read('kalup/objects/companies.ts')).not.toContain('grower_notes')

  // Without allowDestroy the delete is blocked by policy, and nothing is written.
  const blocked = await j.plan()
  expect(blocked.steps).toMatchObject([
    { address: NOTES, action: 'delete', risk: 'blocked', blocked: { reason: 'policy' } },
  ])

  j.edit('kalup.config.ts', 'portalId: 8800101,', 'portalId: 8800101,\n      allowDestroy: true,')
  const saved = await j.kalup('plan', '--out', 'plan.json')
  expect(saved.exitCode, saved.stderr).toBe(0)
  expect(printed(saved)).toMatchInlineSnapshot(`
    "Target sandbox, portal 8800101 (the only target)
    Plan pl_<id> for target sandbox, portal 8800101 (SANDBOX, not protected)
    Settings: mode addon; adopt hold; drift hold; allowDestroy true; yesLimit 25
    s1 destructive [existed-before-kalup] Archive property "Grower notes" (grower_notes) on companies
    0 safe, 0 risky, 1 destructive, 0 blocked, 0 manual; 0 held
    Coverage: complete; 0 unsupported, 0 skipped.
    About 11 API calls; 999975 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    Wrote plan.json
    "
  `)

  const yes = await j.kalup('apply', 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  expect(yes.envelope?.issues[0]?.message).toContain('--yes never covers a delete')
  expect((await j.backend.ui.property('sandbox', 'companies', 'grower_notes')).archived).toBe(false)

  const confirmed = await j.terminal(['apply', 'plan.json'], {
    'Type the target name to apply:': 'sandbox',
    'Type the number of destructive steps (1):': '1',
  })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(confirmed.printed).toContain('s1 done Archive property grower_notes on companies')
  expect((await j.backend.ui.property('sandbox', 'companies', 'grower_notes')).archived).toBe(true)
  const deletes = j.writes().filter((w) => w.startsWith('DELETE '))
  expect(deletes).toEqual(['DELETE /crm/properties/2026-09/companies/grower_notes'])
  expect(j.state().resources[NOTES]).toBeUndefined()
  await j.planIsEmpty()
}, 60_000)
