// J14 live: a custom object of the run's own, its name and its property's name carrying the run prefix. apply creates
// the schema bare, relabels the group HubSpot makes with it, creates its other group and its property, then sets its
// display fields; a label change is one full schema PATCH; a description changed through the API, as in the HubSpot UI,
// is held and taken with pull. Every step is safe, so --yes covers each apply; the run's cleanup archives the object,
// with what is on it, and purges it from the manifest.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { journey } from './journey.js'
import { liveRun, scopedConfig, simulated } from './live.js'

const live = liveRun('j14')
const SHOWN = { timeout: 60_000, interval: 1000 }
const SETTLE_MS = simulated ? 0 : 120_000

// HubSpot's schemas list can show a schema's values from before a write for some seconds after apply verified the
// write (live runs, 2026-10-05). A person who sees that plans again a little later; the journey tries each check that
// reads the schema again the same way, for up to two minutes, then once more to fail with the check's own message.
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

test('J14 live: a custom object created bare then completed, relabelled, a UI edit held and pulled', async () => {
  const run = await live.open()
  const j = journey(run.backend)
  const name = run.name('visit')
  const code = run.name('visit_code')
  const group = run.name('visit_details')
  scopedConfig(j, run, { custom: name })
  const file = `hubspot/objects/${name}.ts`
  const address = `object:${name}`
  mkdirSync(join(j.dir, 'hubspot', 'objects'), { recursive: true })
  writeFileSync(
    join(j.dir, file),
    [
      "import { defineCustomObject, p } from '@kalup/core'",
      '',
      `export const OrchardVisit = defineCustomObject('${name}', {`,
      `  labels: { singular: '${run.label('Orchard visit')}', plural: '${run.label('Orchard visits')}' },`,
      "  description: 'One visit to one orchard.',",
      `  primaryDisplayProperty: '${code}',`,
      `  searchableProperties: ['${code}'],`,
      '  groups: {',
      `    ${name}_information: { label: 'Visit record' },`,
      `    ${group}: { label: 'Visit details' },`,
      '  },',
      '  properties: {',
      `    visitCode: p.string('${code}', { label: 'Visit code', group: '${group}', fieldType: 'text' }),`,
      '  },',
      '})',
      '',
    ].join('\n'),
  )
  const { ui } = j.backend

  const created = await j.plan()
  expect(created.steps.map((s) => [s.action, s.risk, s.address])).toEqual([
    ['create', 'safe', address],
    ['create', 'safe', `group:${name}/${group}`],
    ['create', 'safe', `group:${name}/${name}_information`],
    ['create', 'safe', `property:${name}/${code}`],
  ])
  const apply = await j.kalup('apply', '--yes')
  expect(apply.exitCode, apply.stdout + apply.stderr).toBe(0)
  // A list read can lag the one apply verified on, so the checks wait for HubSpot as apply's read-back does.
  await expect
    .poll(() => ui.schema('sandbox', name), SHOWN)
    .toMatchObject({
      primaryDisplayProperty: code,
      searchableProperties: [code],
      description: 'One visit to one orchard.',
    })
  await settled(() => j.planIsEmpty())

  j.edit(file, `plural: '${run.label('Orchard visits')}'`, `plural: '${run.label('Site visits')}'`)
  const relabelled = await j.plan()
  expect(relabelled.steps.map((s) => [s.action, s.risk, s.address, (s.changes ?? []).map((c) => c.unit)])).toEqual([
    ['update', 'safe', address, ['labels']],
  ])
  const second = await j.kalup('apply', '--yes')
  expect(second.exitCode, second.stdout + second.stderr).toBe(0)
  await expect
    .poll(() => ui.schema('sandbox', name), SHOWN)
    .toMatchObject({
      labels: { plural: run.label('Site visits') },
      primaryDisplayProperty: code,
      description: 'One visit to one orchard.',
    })
  await settled(() => j.planIsEmpty())

  await ui.editSchema('sandbox', name, { description: 'Every orchard visit.' })
  await settled(async () =>
    expect((await j.plan()).steps).toMatchObject([
      {
        address,
        held: [
          { unit: 'description', class: 'drift', config: 'One visit to one orchard.', live: 'Every orchard visit.' },
        ],
      },
    ]),
  )
  await settled(async () => {
    const pulled = await j.kalup('pull', '--only', address)
    expect(pulled.exitCode, pulled.stdout + pulled.stderr).toBe(0)
    expect(j.read(file)).toContain("description: 'Every orchard visit.'")
  })
  await settled(() => j.planIsEmpty())
})
