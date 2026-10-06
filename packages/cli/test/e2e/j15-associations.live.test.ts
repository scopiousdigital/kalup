// J15 live: association labels on a custom object of the run's own and companies, every name carrying the run prefix
// and every label the run ID. apply creates the object, then the pair's plain association, then one label; a relabel is
// one PUT with both labels; kalup rm and a person at a terminal delete the label. The pair holds two associations at
// most, far below HubSpot's cap of 50 (it emails the portal owner at 80%). The run's cleanup archives the object, which
// takes its associations along, and purges it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { journey } from './journey.js'
import { liveRun, scopedConfig, simulated } from './live.js'

const live = liveRun('j15')
const SHOWN = { timeout: 60_000, interval: 1000 }
// HubSpot's schema read lists a new label's name only minutes after the create (live runs, 2026-10-05); state's type
// IDs name it meanwhile. A list read can still lag a write apply verified, so each plan check may try again.
const SETTLE_MS = simulated ? 0 : 120_000

async function settled(check: () => Promise<unknown>): Promise<void> {
  const until = Date.now() + SETTLE_MS
  while (Date.now() < until) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests: each try reads the portal
      await check()
      return
    } catch {
      await new Promise((done) => setTimeout(done, 10_000))
    }
  }
  await check()
}

test('J15 live: a plain association and a label created, relabelled, then the label deleted at a terminal', async () => {
  const run = await live.open()
  const j = journey(run.backend)
  const name = run.name('visit')
  const plain = run.name('visit_company')
  const host = run.name('host')
  scopedConfig(j, run, { custom: name, allowDestroy: true })
  mkdirSync(join(j.dir, 'hubspot', 'objects'), { recursive: true })
  writeFileSync(
    join(j.dir, `hubspot/objects/${name}.ts`),
    [
      "import { defineCustomObject } from '@kalup/core'",
      '',
      `export const OrchardVisit = defineCustomObject('${name}', {`,
      `  labels: { singular: '${run.label('Orchard visit')}', plural: '${run.label('Orchard visits')}' },`,
      "  primaryDisplayProperty: 'hs_object_id',",
      '})',
      '',
    ].join('\n'),
  )
  const file = 'hubspot/associations.ts'
  writeFileSync(
    join(j.dir, file),
    [
      "import { defineAssociations } from '@kalup/core'",
      '',
      'export const Associations = defineAssociations({',
      `  visitCompany: { from: '${name}', to: 'companies', name: '${plain}' },`,
      `  host: { from: '${name}', to: 'companies', name: '${host}', label: '${run.label('Host')}', inverseLabel: '${run.label('Hosted visit')}' },`,
      '})',
      '',
    ].join('\n'),
  )
  const { ui } = j.backend
  const plainAddress = `association:${name}/companies/${plain}`
  const hostAddress = `association:${name}/companies/${host}`

  const created = await j.plan()
  expect(created.steps.map((s) => [s.action, s.risk, s.address])).toEqual(
    expect.arrayContaining([
      ['create', 'safe', `object:${name}`],
      ['create', 'safe', plainAddress],
      ['create', 'safe', hostAddress],
    ]),
  )
  const apply = await j.kalup('apply', '--yes')
  expect(apply.exitCode, apply.stdout + apply.stderr).toBe(0)
  await expect
    .poll(async () => (await ui.labels('sandbox', name, 'companies')).map((l) => l.label).sort(), SHOWN)
    .toEqual([run.label('Host'), null].sort())
  expect(j.state().resources[hostAddress]?.typeIds).toHaveLength(2)
  await settled(() => j.planIsEmpty())

  j.edit(file, `label: '${run.label('Host')}'`, `label: '${run.label('Visit host')}'`)
  const relabelled = await j.plan()
  expect(relabelled.steps.map((s) => [s.action, s.risk, s.address, (s.changes ?? []).map((c) => c.unit)])).toEqual([
    ['update', 'safe', hostAddress, ['label']],
  ])
  const second = await j.kalup('apply', '--yes')
  expect(second.exitCode, second.stdout + second.stderr).toBe(0)
  await expect
    .poll(async () => (await ui.labels('sandbox', 'companies', name)).map((l) => l.label), SHOWN)
    .toContain(run.label('Hosted visit'))
  expect((await ui.labels('sandbox', name, 'companies')).map((l) => l.label)).toContain(run.label('Visit host'))
  await settled(() => j.planIsEmpty())

  expect((await j.kalup('rm', hostAddress)).exitCode).toBe(0)
  const removal = await j.plan()
  expect(removal.steps.map((s) => [s.action, s.risk, s.address])).toEqual([['delete', 'destructive', hostAddress]])
  const confirmed = await j.terminal(['apply'], {
    'Type the target name to apply:': 'sandbox',
    'Type the number of destructive steps (1):': '1',
  })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  await expect
    .poll(async () => (await ui.labels('sandbox', name, 'companies')).map((l) => l.label), SHOWN)
    .toEqual([null])
  expect(j.state().resources[hostAddress]).toBeUndefined()
  await settled(() => j.planIsEmpty())
})
