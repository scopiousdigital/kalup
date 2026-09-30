// J8 live: takeover scoped to the run's own names. After the first pull, someone adds two properties and an option in
// HubSpot. Config switches to takeover and includes one of the new properties; custom: false keeps every other name in
// the portal out of scope, so takeover can never reach it. Without allowDestroy the plan blocks both removals; with it,
// a person at a terminal confirms the archive and the option removal. The property left out of scope and HubSpot's own
// name property are untouched, and the plan after it is empty.
import { expect, test } from 'vitest'
import { journey } from './journey.js'
import { liveRun, NURSERY, pulled, scopedConfig, simulated } from './live.js'
import { options } from './nursery.js'

const live = liveRun('j08')

test('J8 live: takeover archives an in-scope property and a portal-only option only with allowDestroy and a person', async () => {
  const run = await live.open()
  const j = journey(run.backend)
  await pulled(j, run)
  const { ui } = j.backend
  const property = (name: string) => ui.property('sandbox', 'companies', name)
  const text = { type: 'string', fieldType: 'text', groupName: run.name('nursery') }
  await ui.createProperty('sandbox', 'companies', {
    ...text,
    name: run.name('old_supplier'),
    label: run.label('Old supplier'),
  })
  await ui.createProperty('sandbox', 'companies', {
    ...text,
    name: run.name('import_batch'),
    label: run.label('Import batch'),
  })
  const east = options(['north', 'North'], ['south', 'South'], ['GLASS HOUSE', 'Glass house'], ['east', 'East'])
  await ui.editProperty('sandbox', 'companies', run.name('nursery_zone'), { options: east })

  const include = [...NURSERY, 'old_supplier']
  scopedConfig(j, run, { mode: 'takeover', include })
  const plan = await j.plan()
  const removals = plan.steps.filter((s) => s.risk === 'blocked')
  expect(removals.map((s) => [s.address, s.action, s.blocked?.reason])).toEqual([
    [run.address('nursery_zone'), 'adopt', 'policy'],
    [run.address('old_supplier'), 'delete', 'policy'],
  ])
  expect(removals[1]?.blocked?.fix).toContain(`kalup pull --target sandbox --only ${run.address('old_supplier')}`)
  expect(plan.steps.map((s) => s.address).filter((a) => !a.includes(run.prefix))).toEqual([])

  scopedConfig(j, run, { mode: 'takeover', include, allowDestroy: true })
  const yes = await j.kalup('apply', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  const confirmed = await j.terminal(['apply'], {
    'Type the target name to apply:': 'sandbox',
    'Type the number of destructive steps (2):': '2',
  })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)

  expect((await property(run.name('old_supplier'))).archived).toBe(true)
  expect((await property(run.name('nursery_zone'))).options.map((o) => o.value)).toEqual([
    'north',
    'south',
    'GLASS HOUSE',
  ])
  expect((await property(run.name('import_batch'))).archived).toBe(false)
  expect((await property('name')).archived).toBe(false)
  if (simulated) {
    // Another team's properties, which only the simulated portal is known to hold.
    expect((await property('orchard_soil')).options.map((o) => o.value)).toEqual(['clay', 'loam'])
    expect((await property('orchard_rows')).archived).toBe(false)
  }
  await j.planIsEmpty()
})
