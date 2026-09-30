// J4, drift: an admin relabels a property in the HubSpot UI. The plan holds the edit with both exits and writes
// nothing. The developer takes the portal side with the pull the plan prints, and the plan is empty (pull --accept is
// for a conflict or an option removed in HubSpot; plain drift needs no --accept). The admin edits again; this
// time the developer takes config's side with plan --take config, which reverts the UI edit, so it is risky and a
// person confirms it at a terminal. The portal holds config's value and the plan is empty. Last, an admin makes a
// property in the UI that the developer then declares with other values: those units are held as diverged when apply
// --yes adopts it, and stay held after, so no later apply --yes writes over the admin's choice.
import { expect, test } from 'vitest'
import { printed } from '../support/printed.js'
import { journey, simulator } from './journey.js'
import { adopted, nursery } from './nursery.js'

const FILE = 'kalup/objects/companies.ts'
const BEDS = 'property:companies/bed_count'

test('J4 drift: a UI edit is held with both exits, pull takes it, and --take config reverts the next', async () => {
  const j = journey(await simulator({ sandbox: nursery() }))
  await adopted(j)
  const { ui } = j.backend

  await ui.editProperty('sandbox', 'companies', 'bed_count', { label: 'Beds (spring)' })
  const text = await j.kalup('plan', '--exit-code')
  expect(text.exitCode, text.stderr).toBe(2)
  expect(printed(text)).toMatchInlineSnapshot(`
    "Target sandbox, portal 8800101 (the only target)
    Plan pl_<id> for target sandbox, portal 8800101 (SANDBOX, not protected)
    Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    s1 safe No change to property "Bed count" (bed_count) on companies
      held label drift: config "Bed count", portal "Beds (spring)", last agreed "Bed count". Take the portal side: kalup pull --target sandbox --only property:companies/bed_count; take config: kalup plan --target sandbox --take config 'property:companies/bed_count#label'
    1 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 1 held
    Coverage: complete; 0 unsupported, 0 skipped.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    Changes pending: 1 held value.
    "
  `)
  const plan = await j.plan()
  expect(plan.steps.find((s) => s.address === BEDS)?.held).toEqual([
    {
      unit: 'label',
      class: 'drift',
      config: 'Bed count',
      live: 'Beds (spring)',
      base: 'Bed count',
      resolve: { portal: `kalup pull --target sandbox --only ${BEDS}` },
    },
  ])
  const writes = j.writes().length
  const nothing = await j.kalup('apply', '--yes')
  expect(nothing.exitCode, nothing.stderr).toBe(0)
  // Nothing to apply, and it says what it left alone, so the portal is not taken for matching config.
  expect(printed(nothing)).toMatchInlineSnapshot(`
    "Target sandbox, portal 8800101 (the only target)
    Nothing to apply: plan pl_<id> writes nothing to HubSpot or state.
    1 value differs between config and HubSpot (edited in HubSpot, or never agreed) and is held, not written: run kalup plan --target sandbox to see it and how to settle it.
    "
  `)
  expect(j.writes().length).toBe(writes)
  expect((await ui.property('sandbox', 'companies', 'bed_count')).label).toBe('Beds (spring)')

  // The portal side: the file takes the admin's label and state records that they agree.
  const pull = await j.kalup('pull', '--target', 'sandbox', '--only', BEDS)
  expect(pull.exitCode, pull.stderr).toBe(0)
  expect(j.read(FILE)).toContain("label: 'Beds (spring)'")
  expect(j.state().resources[BEDS]?.base).toMatchObject({ label: 'Beds (spring)' })
  await j.planIsEmpty()

  // Config's side: the next UI edit is reverted, as a reviewed risky step a person confirms.
  await ui.editProperty('sandbox', 'companies', 'bed_count', { label: 'Beds (summer)' })
  const take = await j.kalup('plan', '--take', 'config', BEDS, '--out', 'plan.json', '--json')
  expect(take.exitCode, take.stdout).toBe(0)
  const step = (take.data as { steps: { address: string; risk: string; labels?: string[] }[] }).steps.find(
    (s) => s.address === BEDS,
  )
  expect(step).toMatchObject({ risk: 'risky', labels: ['reverts-ui-edit'] })
  const yes = await j.kalup('apply', 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  const confirmed = await j.terminal(['apply', 'plan.json'], { 'Type the target name to apply:': 'sandbox' })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(confirmed.printed).toContain('risky [reverts-ui-edit] Update property "Beds (spring)" (bed_count)')
  expect((await ui.property('sandbox', 'companies', 'bed_count')).label).toBe('Beds (spring)')
  await j.planIsEmpty()

  // Held at adoption, held after it.
  await ui.createProperty('sandbox', 'companies', {
    name: 'soil_type',
    label: 'Soil type',
    type: 'string',
    fieldType: 'text',
    groupName: 'nursery',
    description: '',
    formField: false,
  })
  j.edit(
    FILE,
    '  },\n})',
    "    soilType: p.string('soil_type', {\n      label: 'Soil type',\n      group: 'nursery',\n      fieldType: 'text',\n      description: 'Hand-written',\n      formField: true,\n    }),\n  },\n})",
  )
  const soil = 'property:companies/soil_type'
  const heldUnits = async () =>
    (await j.plan()).steps.find((s) => s.address === soil)?.held?.map((u) => `${u.unit} ${u.class}`)
  expect(await heldUnits()).toEqual(['description diverged', 'formField diverged'])
  const adopt = await j.kalup('apply', '--yes')
  expect(adopt.exitCode, adopt.stderr).toBe(0)
  expect(j.state().resources[soil]).toMatchObject({ origin: 'adopted' })
  expect(await heldUnits()).toEqual(['description diverged', 'formField diverged'])
  const after = j.writes().length
  const again = await j.kalup('apply', '--yes')
  expect(again.exitCode, again.stderr).toBe(0)
  expect(again.stdout).toContain('2 values differ between config and HubSpot')
  expect(j.writes().length).toBe(after)
  expect(await ui.property('sandbox', 'companies', 'soil_type')).toMatchObject({ description: '', formField: false })
}, 60_000)
