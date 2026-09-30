// J8, takeover: after init, someone adds a property and an option in the HubSpot UI, and another property an import
// tool owns. Config switches the portal to takeover and excludes the import tool's names. Without allowDestroy the plan
// blocks both removals and says how to keep them; with it, a person at a terminal confirms the archive and the option
// removal. The excluded property and HubSpot's own name property are untouched, and the plan after it is empty.
import { expect, test } from 'vitest'
import { printed } from '../support/printed.js'
import { journey, simulator } from './journey.js'
import { initialised, nursery, options } from './nursery.js'

const SUPPLIER = 'property:companies/old_supplier'
const ZONE = 'property:companies/nursery_zone'

test('J8 takeover: archives an unmanaged property and a portal-only option only with allowDestroy and a person', async () => {
  const j = journey(await simulator({ sandbox: nursery() }))
  await initialised(j)
  const { ui } = j.backend
  const text = { type: 'string', fieldType: 'text', groupName: 'nursery' }
  await ui.createProperty('sandbox', 'companies', { ...text, name: 'old_supplier', label: 'Old supplier' })
  await ui.createProperty('sandbox', 'companies', { ...text, name: 'import_batch', label: 'Import batch' })
  const zone = await ui.property('sandbox', 'companies', 'nursery_zone')
  const east = options(['north', 'North'], ['south', 'South'], ['GLASS HOUSE', 'Glass house'], ['east', 'East'])
  await ui.editProperty('sandbox', 'companies', 'nursery_zone', { options: east })
  expect(zone.options).toHaveLength(3)

  j.edit(
    'kalup.config.ts',
    '  objects: {\n    companies: {},',
    "  mode: 'takeover',\n  objects: {\n    companies: { exclude: ['import_*'] },",
  )
  const blocked = await j.kalup('plan')
  expect(blocked.exitCode, blocked.stderr).toBe(0)
  expect(printed(blocked)).toMatchInlineSnapshot(`
    "Target sandbox, portal 8800101 (the only target)
    Plan pl_<id> for target sandbox, portal 8800101 (SANDBOX, not protected)
    Settings: mode takeover on companies, else addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    s1 safe Adopt property group "Nursery" (nursery) on companies
    s2 safe Adopt property "Bed count" (bed_count) on companies
    s3 safe Adopt property "Grower notes" (grower_notes) on companies
    s4 safe Adopt property "Last frost" (last_frost) on companies
    Takeover on companies: what config lacks in the pull scope is archived, and options only the portal holds are removed; blocked: allowDestroy is false on target sandbox
    s5 blocked Cannot plan property nursery_zone on companies: option removals not allowed
      note mode: takeover (the top-level mode): only the portal holds the option "east", and config does not
      takeover removes the option "east", which only the portal holds, and target sandbox does not allow deletes
      fix: keep them in config: run kalup pull --target sandbox --only property:companies/nursery_zone; or keep them unmanaged: set lifecycle: { options: 'additive' } on nursery_zone; or remove them: set allowDestroy: true under targets.sandbox in kalup.config.ts
    s6 safe Adopt property "Plant families" (plant_families) on companies
    s7 blocked Cannot plan property old_supplier on companies: deletes not allowed
      note mode: takeover (the top-level mode): HubSpot holds it in the pull scope of companies, and config does not
      takeover archives old_supplier, and target sandbox does not allow deletes
      fix: keep it in config: run kalup pull --target sandbox --only property:companies/old_supplier; or leave it unmanaged: add 'old_supplier' to objects.companies.exclude; or archive it: set allowDestroy: true under targets.sandbox in kalup.config.ts
    5 safe, 0 risky, 0 destructive, 2 blocked, 0 manual; 0 held
    Coverage: complete; 0 unsupported, 0 skipped.
    About 5 API calls; 999988 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    "
  `)
  const plan = await j.plan()
  const removals = plan.steps.filter((s) => s.risk === 'blocked')
  expect(removals.map((s) => [s.address, s.action, s.risk, s.blocked?.reason])).toEqual([
    [ZONE, 'adopt', 'blocked', 'policy'],
    [SUPPLIER, 'delete', 'blocked', 'policy'],
  ])
  expect(removals[1]?.blocked?.fix).toContain(`kalup pull --target sandbox --only ${SUPPLIER}`)

  j.edit('kalup.config.ts', 'portalId: 8800101,', 'portalId: 8800101,\n      allowDestroy: true,')
  const yes = await j.kalup('apply', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])
  const confirmed = await j.terminal(['apply'], {
    'Type the target name to apply:': 'sandbox',
    'Type the number of destructive steps (2):': '2',
  })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)

  expect((await ui.property('sandbox', 'companies', 'old_supplier')).archived).toBe(true)
  const after = await ui.property('sandbox', 'companies', 'nursery_zone')
  expect(after.options.map((o) => o.value)).toEqual(['north', 'south', 'GLASS HOUSE'])
  expect((await ui.property('sandbox', 'companies', 'import_batch')).archived).toBe(false)
  expect((await ui.property('sandbox', 'companies', 'name')).archived).toBe(false)
  const touched = j.writes()
  expect(touched).toEqual([
    'POST /crm/properties/2026-09/companies',
    'POST /crm/properties/2026-09/companies',
    'PATCH /crm/properties/2026-09/companies/nursery_zone',
    'DELETE /crm/properties/2026-09/companies/old_supplier',
  ])
  await j.planIsEmpty()
}, 60_000)
