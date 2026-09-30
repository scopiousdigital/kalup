// J1, the first run: a developer runs kalup init for the sandbox, which sends nothing, then pulls with a key in the
// environment. The first pull writes typed object files and the barrel, state records what the files and the portal
// agree on, and nothing is written to HubSpot. A second pull changes no byte, validate passes, and an app that imports the barrel compiles with tsc under
// NodeNext and gets real types: a typo in an enum value is a type error.
import { expect, test } from 'vitest'
import type { PullData } from '../../src/commands/pull.js'
import { notRead } from '../scenarios/harness.js'
import { printed } from '../support/printed.js'
import { compileApp, journey, simulator } from './journey.js'
import { nursery } from './nursery.js'

const APP = `import { Company, type CompanyData } from '../hubspot/index.js'

type Zone = CompanyData['nurseryZone']

export function describe(bag: Record<string, string | null>): string {
  const zone: Zone = Company.properties.nurseryZone.get(bag)
  const beds: number | null = Company.properties.bedCount.get(bag)
  const families = Company.properties.plantFamilies.get(bag) ?? []
  return \`\${zone ?? 'no zone'}: \${beds ?? 0} beds, \${families.length} families\`
}

export function moveNorth(bag: Record<string, string>): void {
  Company.properties.nurseryZone.set(bag, 'north')
  // @ts-expect-error 'nort' is not an option of nursery_zone
  Company.properties.nurseryZone.set(bag, 'nort')
}
`

test('J1 first run: init and pull write typed files an app compiles against, and validate passes', async () => {
  const j = journey(await simulator({ sandbox: nursery() }))

  const init = await j.kalup('init', '--portal', '8800101', '--objects', 'companies', '--target', 'sandbox')
  expect(init.exitCode, init.stderr).toBe(0)
  // init is offline: it wrote the files and sent nothing.
  expect(j.requests()).toEqual([])
  expect(printed(init)).toMatchInlineSnapshot(`
    "Target sandbox, portal 8800101: companies
    wrote kalup.config.ts
    wrote hubspot/index.ts
    wrote .gitignore
    wrote AGENTS.md
    wrote CLAUDE.md
    No biome.json or prettier config found. If you add a formatter, ignore hubspot/ and kalup.config.ts in it: the writer keeps those files in its own format.
    Read scopes the key in HUBSPOT_SERVICE_KEY needs (Development > Keys > Service keys, see https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys):
      crm.schemas.companies.read (companies)
      crm.objects.companies.read (recommended, for the property limit check in plan; kalup reads no records)
    For apply, the write key needs the read scopes and:
      crm.schemas.companies.write (companies)
    Next:
      No package.json here. The files under hubspot/ import @kalup/core: install it in your app with npm install @kalup/core.
      Run npx kalup pull to write the object files from the portal.
    "
  `)
  const first = await j.kalup('pull')
  expect(first.exitCode, first.stderr).toBe(0)
  expect(printed(first)).toMatchInlineSnapshot(`
    "Target sandbox, portal 8800101 (the only target)
    companies: 6 added, 0 changed, 0 unchanged, 0 missing in portal
      added: property:companies/bed_count
      added: property:companies/grower_notes
      added: property:companies/last_frost
      added: property:companies/nursery_zone
      added: property:companies/plant_families
      added: group:companies/nursery
    wrote hubspot/index.ts
    wrote hubspot/objects/companies.ts
    Recorded the agreed values of 6 resources in state
    State for portal 8800101 is new: .kalup/state/portal-8800101.json
    "
  `)
  const objects = j.read('hubspot/objects/companies.ts')
  expect(objects).toContain("nurseryZone: p.enum('nursery_zone', {")
  expect(objects).toContain("plantFamilies: p.multiEnum('plant_families', {")
  expect(objects).toContain("lastFrost: p.date('last_frost', {")
  expect(j.read('hubspot/index.ts')).toBe(
    "export type { CompanyData } from './objects/companies.js'\nexport { Company } from './objects/companies.js'\n",
  )
  expect(j.read('.gitignore')).toContain('.kalup/')
  expect(j.read('CLAUDE.md')).toContain('@AGENTS.md')
  // The pull recorded a base for every resource it wrote. It owns none of them yet: the first plan adopts.
  const state = j.state()
  expect(Object.keys(state.resources).sort()).toEqual([
    'group:companies/nursery',
    'property:companies/bed_count',
    'property:companies/grower_notes',
    'property:companies/last_frost',
    'property:companies/nursery_zone',
    'property:companies/plant_families',
  ])
  expect(Object.values(state.resources).map((r) => r.origin)).toEqual(new Array(6).fill('pulled'))
  expect(notRead(j.requests())).toEqual([])

  // A second pull with nothing new in the portal rewrites nothing.
  const pull = await j.kalup<PullData>('pull', '--json')
  expect(pull.exitCode, pull.stdout).toBe(0)
  expect(pull.data).toMatchObject({ files: [], target: 'sandbox', portalId: 8_800_101 })
  expect(pull.data?.objects.companies).toMatchObject({ added: 0, changed: 0, unchanged: 6 })
  expect(j.read('hubspot/objects/companies.ts')).toBe(objects)

  const validate = await j.kalup('validate', '--json')
  expect(validate.exitCode, validate.stdout).toBe(0)
  expect(validate.envelope).toMatchObject({ ok: true, issues: [] })

  const app = compileApp(j.dir, { 'app/nursery.ts': APP }, '--noEmit', 'kalup.config.ts')
  expect(app.output).toBe('')
  expect(app.exitCode).toBe(0)
}, 60_000)
