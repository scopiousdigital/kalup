// J13 live: a deal pipeline of the run's own, its ID and stage IDs carrying the run prefix. apply creates it with its
// stages in one request; a stage added in the middle is created at the end and moved into place, and a label changes;
// a stage relabelled through the API, as in the HubSpot UI, is held and taken with pull. Every step is safe, so --yes
// covers each apply; the run's cleanup deletes the pipeline, with its stages, from the manifest.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { journey } from './journey.js'
import { liveRun, scopedConfig } from './live.js'

const live = liveRun('j13')
const FILE = 'hubspot/pipelines/deals.ts'

test('J13 live: a pipeline created with its stages, a stage inserted and moved, a UI relabel held and pulled', async () => {
  const run = await live.open()
  const j = journey(run.backend)
  scopedConfig(j, run, { deals: true })
  const id = run.name('sales')
  const stage = (name: string) => run.name(name)
  const address = `pipeline:deals/${id}`
  const stageAt = (name: string) => `stage:deals/${id}/${stage(name)}`
  const entry = (key: string, name: string, label: string, probability: number) =>
    `    ${key}: { id: '${stage(name)}', label: '${label}', probability: ${probability} },`
  mkdirSync(join(j.dir, 'hubspot', 'pipelines'), { recursive: true })
  writeFileSync(
    join(j.dir, FILE),
    [
      "import { definePipeline } from '@kalup/core'",
      '',
      "export const OrchardSalesPipeline = definePipeline('deals', {",
      `  id: '${id}',`,
      `  label: '${run.label('Orchard sales')}',`,
      '  displayOrder: 50,',
      '  stages: {',
      entry('tasting', 'tasting', 'Tasting', 0.2),
      entry('signed', 'signed', 'Signed', 1),
      entry('lost', 'lost', 'Lost', 0),
      '  },',
      '})',
      '',
    ].join('\n'),
  )
  const { ui } = j.backend

  const created = await j.plan()
  expect(created.steps.map((s) => [s.action, s.risk, s.address, (s.stages ?? []).length])).toEqual([
    ['create', 'safe', address, 3],
  ])
  const apply = await j.kalup('apply', '--yes')
  expect(apply.exitCode, apply.stdout + apply.stderr).toBe(0)
  expect((await ui.pipeline('sandbox', 'deals', id))?.stages.map((st) => st.id)).toEqual([
    stage('tasting'),
    stage('signed'),
    stage('lost'),
  ])
  await j.planIsEmpty()

  j.edit(
    FILE,
    `    signed: { id: '${stage('signed')}'`,
    `${entry('pressing', 'pressing', 'Pressing', 0.6)}\n    signed: { id: '${stage('signed')}'`,
  )
  j.edit(FILE, "label: 'Tasting'", "label: 'Tasting booked'")
  const inserted = await j.plan()
  expect(inserted.steps.map((s) => [s.action, s.risk, s.address, (s.changes ?? []).map((c) => c.unit)])).toEqual([
    ['update', 'safe', address, ['stages']],
    ['create', 'safe', stageAt('pressing'), []],
    ['update', 'safe', stageAt('tasting'), ['label']],
  ])
  const second = await j.kalup('apply', '--yes')
  expect(second.exitCode, second.stdout + second.stderr).toBe(0)
  expect((await ui.pipeline('sandbox', 'deals', id))?.stages.map((st) => [st.id, st.label])).toEqual([
    [stage('tasting'), 'Tasting booked'],
    [stage('pressing'), 'Pressing'],
    [stage('signed'), 'Signed'],
    [stage('lost'), 'Lost'],
  ])
  await j.planIsEmpty()

  await ui.editStage('sandbox', 'deals', id, stage('signed'), 'Signed and paid')
  const held = await j.plan()
  expect(held.steps).toMatchObject([
    {
      address: stageAt('signed'),
      held: [{ unit: 'label', class: 'drift', config: 'Signed', live: 'Signed and paid' }],
    },
  ])
  const pulled = await j.kalup('pull', '--only', stageAt('signed'))
  expect(pulled.exitCode, pulled.stdout + pulled.stderr).toBe(0)
  expect(j.read(FILE)).toContain("label: 'Signed and paid'")
  await j.planIsEmpty()
})
