// J2 live: right after the first pull, a label changed, an option added and a property added in the object file are
// planned with their values, apply --yes writes exactly those to HubSpot, and the plan after it is empty.
import type { ApplyData } from '@kalup/engine'
import { expect, test } from 'vitest'
import { journey } from './journey.js'
import { liveRun, pulled } from './live.js'

const FILE = 'kalup/objects/companies.ts'
const live = liveRun('j02')

test('J2 live: a label, a new property and a new option are planned with their values and applied', async () => {
  const run = await live.open()
  const j = journey(run.backend)
  await pulled(j, run)

  j.edit(FILE, `label: '${run.label('Bed count')}'`, `label: '${run.label('Beds in use')}'`)
  j.edit(
    FILE,
    "        { value: 'GLASS HOUSE', label: 'Glass house' },\n",
    "        { value: 'GLASS HOUSE', label: 'Glass house' },\n        { value: 'shade', label: 'Shade tunnel' },\n",
  )
  const seedTrays = `    ${run.key('seed_trays')}: p.number('${run.name('seed_trays')}', {
      label: '${run.label('Seed trays')}',
      group: '${run.name('nursery')}',
      fieldType: 'number',
    }),
`
  j.edit(FILE, '  },\n})', `${seedTrays}  },\n})`)

  const plan = await j.plan()
  expect(plan.counts).toMatchObject({ safe: 7, risky: 0, destructive: 0, blocked: 0, held: 0 })
  expect(plan.steps.find((s) => s.address === run.address('bed_count'))?.changes).toEqual([
    {
      unit: 'label',
      class: 'config-change',
      op: 'set',
      before: run.label('Bed count'),
      after: run.label('Beds in use'),
    },
  ])
  expect(plan.steps.find((s) => s.address === run.address('nursery_zone'))?.changes).toMatchObject([
    { unit: 'options[shade]', class: 'add', op: 'add', after: { value: 'shade', label: 'Shade tunnel' } },
  ])
  expect(plan.steps.find((s) => s.address === run.address('seed_trays'))).toMatchObject({ action: 'create' })

  const apply = await j.kalup<ApplyData>('apply', '--yes', '--json')
  expect(apply.exitCode, apply.stdout).toBe(0)
  expect(apply.data?.outcome).toBe('done')
  const { ui } = j.backend
  expect((await ui.property('sandbox', 'companies', run.name('bed_count'))).label).toBe(run.label('Beds in use'))
  const zone = await ui.property('sandbox', 'companies', run.name('nursery_zone'))
  expect(zone.options.map((o) => o.value)).toEqual(['north', 'south', 'GLASS HOUSE', 'shade'])
  expect(await ui.property('sandbox', 'companies', run.name('seed_trays'))).toMatchObject({
    label: run.label('Seed trays'),
    groupName: run.name('nursery'),
    archived: false,
  })
  expect(j.state().resources[run.address('seed_trays')]).toMatchObject({ origin: 'created' })
  expect(j.state().resources[run.address('bed_count')]).toMatchObject({ origin: 'adopted' })

  await j.planIsEmpty()
})
