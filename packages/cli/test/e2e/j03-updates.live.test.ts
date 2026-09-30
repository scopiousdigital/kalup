// J3 live: updates to what Kalup owns on HubSpot: a description, a fieldType change, an option relabelled and a
// property moved to a new group. The fieldType change is risky, so --yes is refused and a person confirms the apply at
// a terminal. Each change reads back from HubSpot as planned and the plan after it is empty.
import { expect, test } from 'vitest'
import { journey } from './journey.js'
import { adopted, liveRun } from './live.js'

const FILE = 'hubspot/objects/companies.ts'
const live = liveRun('j03')

test('J3 live: description, fieldType, option label and group move apply as planned', async () => {
  const run = await live.open()
  const j = journey(run.backend)
  await adopted(j, run)
  const nursery = run.name('nursery')
  const climate = run.name('climate')

  j.edit(
    FILE,
    `label: '${run.label('Bed count')}',`,
    `label: '${run.label('Bed count')}',\n      description: 'Raised beds in use this season',`,
  )
  j.edit(FILE, "fieldType: 'textarea',", "fieldType: 'text',")
  j.edit(FILE, "{ value: 'north', label: 'North' }", "{ value: 'north', label: 'North beds' }")
  j.edit(
    FILE,
    `    ${nursery}: { label: '${run.label('Nursery')}' },\n`,
    `    ${climate}: { label: '${run.label('Climate')}' },\n    ${nursery}: { label: '${run.label('Nursery')}' },\n`,
  )
  j.edit(
    FILE,
    `label: '${run.label('Last frost')}',\n      group: '${nursery}',`,
    `label: '${run.label('Last frost')}',\n      group: '${climate}',`,
  )

  const plan = await j.plan()
  expect(plan.steps.map((s) => [s.action, s.risk, s.address, (s.changes ?? []).map((c) => c.unit)])).toEqual([
    ['create', 'safe', run.address('climate', 'group'), []],
    ['update', 'safe', run.address('bed_count'), ['description']],
    ['update', 'risky', run.address('grower_notes'), ['fieldType']],
    ['update', 'safe', run.address('last_frost'), ['group']],
    ['update', 'safe', run.address('nursery_zone'), ['options[north].label']],
  ])

  const yes = await j.kalup('apply', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])

  const confirmed = await j.terminal(['apply'], { 'Type the target name to apply:': 'sandbox' })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(confirmed.printed).toContain('5 done.')

  const { ui } = j.backend
  const property = (name: string) => ui.property('sandbox', 'companies', run.name(name))
  expect((await property('bed_count')).description).toBe('Raised beds in use this season')
  expect((await property('grower_notes')).fieldType).toBe('text')
  expect((await property('last_frost')).groupName).toBe(climate)
  expect((await property('nursery_zone')).options.find((o) => o.value === 'north')?.label).toBe('North beds')
  expect(j.state().lastApply).toMatchObject({ actor: 'terminal', outcome: 'done' })

  await j.planIsEmpty()
})
