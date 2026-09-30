// J12, the app side: the object file pull wrote, with an enum alias the developer added by hand, types and decodes
// the property bags of CRM records. An app compiled by tsc and run under plain Node reads a record fixture shaped as
// the CRM API returns records: the alias, an option HubSpot holds that config does not (Unlisted), a number, a date,
// a multi-select with an unlisted member, and unset values. It encodes a change back into the strings HubSpot takes.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { compileApp, journey, simulator } from './journey.js'
import { initialised, nursery } from './nursery.js'

const records = fileURLToPath(new URL('../fixtures/records/larkspur-companies.json', import.meta.url))

const APP = `import { Company, type CompanyData } from '../hubspot/index.js'

type Bag = Record<string, string | null>
const { bedCount, growerNotes, lastFrost, nurseryZone, plantFamilies } = Company.properties

export function decode(bag: Bag) {
  return {
    zone: nurseryZone.get(bag),
    beds: bedCount.get(bag),
    lastFrost: lastFrost.get(bag),
    families: plantFamilies.get(bag),
    notes: growerNotes.get(bag),
  }
}

/** Into the glass house with 50 beds and roses added, whatever families HubSpot already holds. */
export function moveToGlassHouse(families: CompanyData['plantFamilies']): Record<string, string> {
  const change: Record<string, string> = {}
  nurseryZone.set(change, 'glass_house')
  bedCount.set(change, 50)
  lastFrost.set(change, '2026-04-20')
  plantFamilies.set(change, [...(families ?? []), 'roses'])
  growerNotes.set(change, null)
  return change
}
`

const RUN = `import { readFileSync } from 'node:fs'
import { decode, moveToGlassHouse } from './out/app/records.js'
const { results } = JSON.parse(readFileSync(process.argv[1], 'utf8'))
const decoded = results.map((record) => decode(record.properties))
process.stdout.write(JSON.stringify({ decoded, change: moveToGlassHouse(decoded[1].families) }))
`

test('J12 app runtime: the generated object file decodes CRM records and encodes a change back', async () => {
  const j = journey(await simulator({ sandbox: nursery() }))
  await initialised(j)
  j.edit(
    'hubspot/objects/companies.ts',
    "{ value: 'GLASS HOUSE', label: 'Glass house' }",
    "{ value: 'GLASS HOUSE', label: 'Glass house', as: 'glass_house' }",
  )
  const validate = await j.kalup('validate')
  expect(validate.exitCode, validate.stdout).toBe(0)
  // A pull keeps the alias: it is the app's, not the portal's.
  const pull = await j.kalup('pull')
  expect(pull.exitCode, pull.stderr).toBe(0)
  expect(j.read('hubspot/objects/companies.ts')).toContain("as: 'glass_house' }")

  const app = compileApp(j.dir, { 'app/records.ts': APP }, '--outDir', 'out', '--rootDir', '.')
  expect(app.output).toBe('')
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', RUN, records], { cwd: j.dir, encoding: 'utf8' })
  expect(out.status, out.stderr).toBe(0)
  expect(JSON.parse(out.stdout)).toEqual({
    decoded: [
      {
        zone: 'glass_house',
        beds: 42,
        lastFrost: '2026-04-12',
        families: ['roses', 'herbs'],
        notes: 'Water the glass house twice a day',
      },
      { zone: 'polytunnel', beds: null, lastFrost: null, families: ['ferns', 'cacti'], notes: null },
    ],
    change: {
      nursery_zone: 'GLASS HOUSE',
      bed_count: '50',
      last_frost: '2026-04-20',
      plant_families: 'ferns;cacti;roses',
    },
  })
}, 60_000)
