// J11, a blueprint: an agency adds its renewals fragment (a local blueprint/1 file) to a client project, plans and
// applies it. The client relabels one of its properties. Version 2.0.0 of the fragment changes that property's
// description, relabels another and adds a property and an option; the upgrade keeps the client's label and takes the
// rest, and applying it leaves nothing to do. Neither add nor upgrade sends a HubSpot request.
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { AddData } from '../../src/commands/add.js'
import type { UpgradeData } from '../../src/commands/blueprint-upgrade.js'
import { printed } from '../support/printed.js'
import { journey, simulator } from './journey.js'
import { initialised, nursery } from './nursery.js'

const DEALS = 'hubspot/objects/deals.ts'

function fragment(dir: string, version: string): string {
  const from = new URL(`../../../engine/test/fixtures/blueprints/renewals-${version}.json`, import.meta.url)
  mkdirSync(join(dir, 'blueprints'), { recursive: true })
  copyFileSync(from, join(dir, 'blueprints', `renewals-${version}.json`))
  return `blueprints/renewals-${version}.json`
}

test('J11 blueprint: add and apply a fragment, then upgrade it keeping a client edit, and apply again', async () => {
  const j = journey(await simulator({ sandbox: nursery() }))
  await initialised(j)
  const requests = () => j.requests().length

  const beforeAdd = requests()
  const add = await j.kalup<AddData>('add', fragment(j.dir, '1.0.0'), '--json')
  expect(add.exitCode, add.stdout).toBe(0)
  expect(requests()).toBe(beforeAdd)
  expect(add.data).toMatchObject({ blueprint: { name: 'acme/renewals', version: '1.0.0' }, objects: ['deals'] })
  expect(j.read(DEALS)).toContain("renewalStage: p.enum('renewal_stage', {")
  const first = await j.kalup('apply', '--yes')
  expect(first.exitCode, first.stderr).toBe(0)
  expect((await j.backend.ui.property('sandbox', 'deals', 'renewal_notes')).groupName).toBe('renewal')

  j.edit(DEALS, "label: 'Renewal notes'", "label: 'Renewal call notes'")
  const edited = await j.kalup('apply', '--yes')
  expect(edited.exitCode, edited.stderr).toBe(0)

  const beforeUpgrade = requests()
  const upgrade = await j.kalup<UpgradeData>(
    'blueprint',
    'upgrade',
    'acme/renewals',
    fragment(j.dir, '2.0.0'),
    '--json',
  )
  expect(upgrade.exitCode, upgrade.stdout).toBe(0)
  expect(upgrade.data).toMatchObject({ from: { version: '1.0.0' }, to: { version: '2.0.0' }, held: 0 })
  expect(requests()).toBe(beforeUpgrade)
  const deals = j.read(DEALS)
  expect(deals).toContain("label: 'Renewal call notes'")
  expect(deals).toContain("description: 'Notes from the renewal call'")
  expect(deals).toContain("label: 'Renewal due date'")
  expect(deals).toContain("renewalAmount: p.number('renewal_amount', {")

  const plan = await j.kalup('plan')
  expect(plan.exitCode, plan.stderr).toBe(0)
  expect(printed(plan)).toMatchInlineSnapshot(`
    "Target sandbox, portal 8800101 (the only target)
    Plan pl_<id> for target sandbox, portal 8800101 (SANDBOX, not protected)
    Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    s1 safe Create property "Renewal amount" (renewal_amount) on deals
      label "Renewal amount", group renewal, fieldType "number"
    s2 safe Update property "Renewal due date" (renewal_date) on deals, set label
      label: "Renewal date" -> "Renewal due date"
    s3 safe Update property "Renewal call notes" (renewal_notes) on deals, set description
      description: "Notes for the renewal" -> "Notes from the renewal call"
    s4 safe Update property "Renewal stage" (renewal_stage) on deals, reorder options, add option "Paused"
      options.order: ["open","won","lost"] -> ["open","won","paused","lost"]
      + option "Paused" ("paused")
    4 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 0 held
    Coverage: complete; 0 unsupported, 0 skipped.
    About 20 API calls; 999918 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    "
  `)
  const second = await j.kalup('apply', '--yes')
  expect(second.exitCode, second.stderr).toBe(0)
  const notes = await j.backend.ui.property('sandbox', 'deals', 'renewal_notes')
  expect([notes.label, notes.description]).toEqual(['Renewal call notes', 'Notes from the renewal call'])
  const stage = await j.backend.ui.property('sandbox', 'deals', 'renewal_stage')
  expect(stage.options.map((o) => o.value)).toEqual(['open', 'won', 'paused', 'lost'])
  await j.planIsEmpty()
}, 60_000)
