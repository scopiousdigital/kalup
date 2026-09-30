// J3, updates to what Kalup owns: a description, a fieldType change, an option relabelled and a property moved to a
// new group. The fieldType change is risky, so --yes refuses the run and the person confirms it at a terminal. Each
// change lands as planned and the plan after it is empty.
import { expect, test } from 'vitest'
import { printed } from '../support/printed.js'
import { journey, simulator } from './journey.js'
import { adopted, nursery } from './nursery.js'

const FILE = 'kalup/objects/companies.ts'

test('J3 updates: description, fieldType, option label and group move apply as planned', async () => {
  const j = journey(await simulator({ sandbox: nursery() }))
  await adopted(j)

  j.edit(FILE, "label: 'Bed count',", "label: 'Bed count',\n      description: 'Raised beds in use this season',")
  j.edit(FILE, "fieldType: 'textarea',", "fieldType: 'text',")
  j.edit(FILE, "{ value: 'north', label: 'North' }", "{ value: 'north', label: 'North beds' }")
  j.edit(
    FILE,
    "    nursery: { label: 'Nursery' },\n",
    "    climate: { label: 'Climate' },\n    nursery: { label: 'Nursery' },\n",
  )
  j.edit(FILE, "label: 'Last frost',\n      group: 'nursery',", "label: 'Last frost',\n      group: 'climate',")

  const plan = await j.plan()
  expect(plan.steps.map((s) => [s.action, s.risk, s.address, (s.changes ?? []).map((c) => c.unit)])).toEqual([
    ['create', 'safe', 'group:companies/climate', []],
    ['update', 'safe', 'property:companies/bed_count', ['description']],
    ['update', 'risky', 'property:companies/grower_notes', ['fieldType']],
    ['update', 'safe', 'property:companies/last_frost', ['group']],
    ['update', 'safe', 'property:companies/nursery_zone', ['options[north].label']],
  ])

  const yes = await j.kalup('apply', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  expect(yes.envelope?.issues[0]?.humanRequired).toBe(true)

  const confirmed = await j.terminal(['apply'], { 'Type the target name to apply:': 'sandbox' })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(printed({ stdout: confirmed.printed, stderr: '' })).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 8800101 (SANDBOX, not protected):
      s1 safe Create property group "Climate" (climate) on companies
      s2 safe Update property "Bed count" (bed_count) on companies, set description
      s3 risky Update property "Grower notes" (grower_notes) on companies, set fieldType
      s4 safe Update property "Last frost" (last_frost) on companies, set group
      s5 safe Update property "Nursery zone" (nursery_zone) on companies, set options[north].label
    5 writes, 0 adoptions, 0 releases, 0 base records, 0 destructive
    Type the target name to apply: sandbox
    Target sandbox, portal 8800101 (the only target)
    Applied plan pl_<id> on target sandbox, portal 8800101
    s1 done Create property group "Climate" (climate) on companies
    s2 done Update property "Bed count" (bed_count) on companies, set description
    s3 done Update property "Grower notes" (grower_notes) on companies, set fieldType
    s4 done Update property "Last frost" (last_frost) on companies, set group
    s5 done Update property "Nursery zone" (nursery_zone) on companies, set options[north].label
    5 done.
    State: <dir>/larkspur/.kalup/state/portal-8800101.json (serial 11). Journal: <dir>/larkspur/.kalup/journal/portal-8800101/pl_<id>-<time>.jsonl
    "
  `)

  const { ui } = j.backend
  expect((await ui.property('sandbox', 'companies', 'bed_count')).description).toBe('Raised beds in use this season')
  expect((await ui.property('sandbox', 'companies', 'grower_notes')).fieldType).toBe('text')
  expect((await ui.property('sandbox', 'companies', 'last_frost')).groupName).toBe('climate')
  const zone = await ui.property('sandbox', 'companies', 'nursery_zone')
  expect(zone.options.find((o) => o.value === 'north')?.label).toBe('North beds')
  expect(j.state().lastApply).toMatchObject({ actor: 'terminal', outcome: 'done' })

  await j.planIsEmpty()
}, 60_000)
