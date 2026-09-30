// J5 live: kalup rm writes a destroy tombstone, the target allows destroying, and the plan archives the property in
// HubSpot. --yes never covers a delete: a person at a terminal types the target name and the number of destructive
// steps. HubSpot then reads the property archived, state drops its entry, and the plan after it is empty.
import { expect, test } from 'vitest'
import { journey } from './journey.js'
import { adopted, liveRun, scopedConfig } from './live.js'

const live = liveRun('j05')

test('J5 live: rm, allowDestroy and a person at a terminal archive the property; --yes is refused', async () => {
  const run = await live.open()
  const j = journey(run.backend)
  await adopted(j, run)
  const notes = run.address('grower_notes')
  const archived = async () => (await j.backend.ui.property('sandbox', 'companies', run.name('grower_notes'))).archived

  const rm = await j.kalup('rm', notes)
  expect(rm.exitCode, rm.stderr).toBe(0)
  expect(j.read('hubspot/removed.ts')).toContain(`'${notes}': { action: 'destroy' }`)

  const blocked = await j.plan()
  expect(blocked.steps).toMatchObject([
    { address: notes, action: 'delete', risk: 'blocked', blocked: { reason: 'policy' } },
  ])

  scopedConfig(j, run, { allowDestroy: true })
  const saved = await j.kalup('plan', '--out', 'plan.json', '--json')
  expect(saved.exitCode, saved.stdout).toBe(0)
  expect((saved.data as { steps: unknown[] }).steps).toMatchObject([
    { address: notes, action: 'delete', risk: 'destructive' },
  ])

  const yes = await j.kalup('apply', 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  expect(await archived()).toBe(false)

  const confirmed = await j.terminal(['apply', 'plan.json'], {
    'Type the target name to apply:': 'sandbox',
    'Type the number of destructive steps (1):': '1',
  })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(await archived()).toBe(true)
  expect(j.state().resources[notes]).toBeUndefined()
  await j.planIsEmpty()
})
