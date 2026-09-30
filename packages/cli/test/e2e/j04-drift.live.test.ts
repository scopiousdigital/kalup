// J4 live: a label edited in HubSpot is held with both exits and nothing is written. The developer takes the portal
// side with the pull the plan prints, and the plan is empty. The next edit in HubSpot is reverted with plan --take
// config, a risky step that --yes refuses and a person confirms at a terminal; HubSpot then holds config's label.
import { expect, test } from 'vitest'
import { journey } from './journey.js'
import { adopted, liveRun } from './live.js'

const FILE = 'kalup/objects/companies.ts'
const live = liveRun('j04')

test('J4 live: a HubSpot edit is held with both exits, pull takes it, and --take config reverts the next', async () => {
  const run = await live.open()
  const j = journey(run.backend)
  await adopted(j, run)
  const { ui } = j.backend
  const beds = run.address('bed_count')
  const label = async () => (await ui.property('sandbox', 'companies', run.name('bed_count'))).label

  await ui.editProperty('sandbox', 'companies', run.name('bed_count'), { label: run.label('Beds (spring)') })
  const held = await j.kalup('plan', '--exit-code')
  expect(held.exitCode, held.stdout + held.stderr).toBe(2)
  const plan = await j.plan()
  expect(plan.steps.find((s) => s.address === beds)?.held).toEqual([
    {
      unit: 'label',
      class: 'drift',
      config: run.label('Bed count'),
      live: run.label('Beds (spring)'),
      base: run.label('Bed count'),
      resolve: { portal: `kalup pull --target sandbox --only ${beds}` },
    },
  ])
  const nothing = await j.kalup('apply', '--yes')
  expect(nothing.exitCode, nothing.stderr).toBe(0)
  expect(nothing.stdout).toContain(
    '1 held unit, not written: run kalup plan --target sandbox to see it and how to settle it.',
  )
  expect(await label()).toBe(run.label('Beds (spring)'))

  const pull = await j.kalup('pull', '--target', 'sandbox', '--only', beds)
  expect(pull.exitCode, pull.stderr).toBe(0)
  expect(j.read(FILE)).toContain(`label: '${run.label('Beds (spring)')}'`)
  await j.planIsEmpty()

  await ui.editProperty('sandbox', 'companies', run.name('bed_count'), { label: run.label('Beds (summer)') })
  const take = await j.kalup('plan', '--take', 'config', beds, '--out', 'plan.json', '--json')
  expect(take.exitCode, take.stdout).toBe(0)
  const step = (take.data as { steps: { address: string; labels?: string[]; risk: string }[] }).steps.find(
    (s) => s.address === beds,
  )
  expect(step).toMatchObject({ risk: 'risky', labels: ['reverts-ui-edit'] })
  const yes = await j.kalup('apply', 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  const confirmed = await j.terminal(['apply', 'plan.json'], { 'Type the target name to apply:': 'sandbox' })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(await label()).toBe(run.label('Beds (spring)'))
  await j.planIsEmpty()
})
