// J2, the first edit: right after init, a developer changes a label, adds a property and adds an enum option in the
// object file. The plan shows each value it writes, apply --yes writes exactly those, and the plan after it is empty.
// The first-apply trap is gone: the pull recorded a base, so nothing the files and the portal agreed on is held.

import type { ApplyData } from '@kalup/engine'
import { expect, test } from 'vitest'
import { printed } from '../support/printed.js'
import { journey, simulator } from './journey.js'
import { initialised, nursery } from './nursery.js'

const FILE = 'kalup/objects/companies.ts'
const SEED_TRAYS = `    seedTrays: p.number('seed_trays', {
      label: 'Seed trays',
      group: 'nursery',
      fieldType: 'number',
    }),
`

test('J2 edit after pull: a label, a new property and a new option are planned with their values and applied', async () => {
  const j = journey(await simulator({ sandbox: nursery() }))
  await initialised(j)

  j.edit(FILE, "label: 'Bed count'", "label: 'Beds in use'")
  j.edit(
    FILE,
    "        { value: 'GLASS HOUSE', label: 'Glass house' },\n",
    "        { value: 'GLASS HOUSE', label: 'Glass house' },\n        { value: 'shade', label: 'Shade tunnel' },\n",
  )
  j.edit(FILE, '  },\n})', `${SEED_TRAYS}  },\n})`)

  const text = await j.kalup('plan')
  expect(text.exitCode, text.stderr).toBe(0)
  expect(printed(text)).toMatchInlineSnapshot(`
    "Target sandbox, portal 8800101 (the only target)
    Plan pl_<id> for target sandbox, portal 8800101 (SANDBOX, not protected)
    Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    s1 safe Adopt property group "Nursery" (nursery) on companies
    s2 safe Adopt property "Beds in use" (bed_count) on companies, set label
      label: "Bed count" -> "Beds in use"
    s3 safe Adopt property "Grower notes" (grower_notes) on companies
    s4 safe Adopt property "Last frost" (last_frost) on companies
    s5 safe Adopt property "Nursery zone" (nursery_zone) on companies, add option "Shade tunnel"
      + option "Shade tunnel" ("shade")
    s6 safe Adopt property "Plant families" (plant_families) on companies
    s7 safe Create property "Seed trays" (seed_trays) on companies
      label "Seed trays", group nursery, fieldType "number"
    7 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 0 held
    Coverage: complete; 0 unsupported, 0 skipped.
    About 17 API calls; 999985 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    "
  `)
  const plan = await j.plan()
  expect(plan.counts).toMatchObject({ safe: 7, risky: 0, destructive: 0, blocked: 0, held: 0 })
  expect(plan.steps.find((s) => s.address === 'property:companies/bed_count')?.changes).toEqual([
    { unit: 'label', class: 'config-change', op: 'set', before: 'Bed count', after: 'Beds in use' },
  ])
  expect(plan.steps.find((s) => s.address === 'property:companies/nursery_zone')?.changes).toMatchObject([
    { unit: 'options[shade]', class: 'add', op: 'add', after: { value: 'shade', label: 'Shade tunnel' } },
  ])
  expect(plan.steps.find((s) => s.address === 'property:companies/seed_trays')).toMatchObject({ action: 'create' })

  const before = j.writes().length
  const apply = await j.kalup<ApplyData>('apply', '--yes', '--json')
  expect(apply.exitCode, apply.stdout).toBe(0)
  expect(apply.data?.outcome).toBe('done')
  expect(j.writes().slice(before)).toEqual([
    'PATCH /crm/properties/2026-09/companies/bed_count',
    'PATCH /crm/properties/2026-09/companies/nursery_zone',
    'POST /crm/properties/2026-09/companies',
  ])
  expect((await j.backend.ui.property('sandbox', 'companies', 'bed_count')).label).toBe('Beds in use')
  const zone = await j.backend.ui.property('sandbox', 'companies', 'nursery_zone')
  expect(zone.options.map((o) => o.value)).toEqual(['north', 'south', 'GLASS HOUSE', 'shade'])
  expect(j.state().resources['property:companies/seed_trays']).toMatchObject({ origin: 'created' })
  expect(j.state().resources['property:companies/bed_count']).toMatchObject({ origin: 'adopted' })

  await j.planIsEmpty()
}, 60_000)
