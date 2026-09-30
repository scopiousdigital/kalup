// J12 live: the object file pull wrote from HubSpot, with an enum alias added by hand, decodes a real CRM record. The
// run creates one company record holding its properties, reads it back through the objects API, and an app compiled by
// tsc and run under plain Node decodes it with the generated codecs and encodes a change back into the strings HubSpot
// takes. Then the record is deleted.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { compileApp, journey } from './journey.js'
import { liveRun, NURSERY, pulled } from './live.js'

const live = liveRun('j12')

const RUN = `import { readFileSync } from 'node:fs'
import { decode, encode } from './out/app/records.js'
const record = JSON.parse(readFileSync(process.argv[1], 'utf8'))
const decoded = decode(record.properties)
process.stdout.write(JSON.stringify({ decoded, change: encode(decoded.families) }))
`

test('J12 live: the generated object file decodes a HubSpot record and encodes a change back', async () => {
  const run = await live.open()
  const j = journey(run.backend)
  await pulled(j, run)
  j.edit(
    'kalup/objects/companies.ts',
    "{ value: 'GLASS HOUSE', label: 'Glass house' }",
    "{ value: 'GLASS HOUSE', label: 'Glass house', as: 'glass_house' }",
  )
  const validate = await j.kalup('validate')
  expect(validate.exitCode, validate.stdout).toBe(0)
  const pull = await j.kalup('pull')
  expect(pull.exitCode, pull.stderr).toBe(0)
  expect(j.read('kalup/objects/companies.ts')).toContain("as: 'glass_house' }")

  const id = await run.ui.createRecord('companies', run.name('record'), {
    [run.name('nursery_zone')]: 'GLASS HOUSE',
    [run.name('bed_count')]: '42',
    [run.name('last_frost')]: '2026-04-12',
    [run.name('plant_families')]: 'roses;herbs',
    [run.name('grower_notes')]: 'Water the glass house twice a day',
  })
  const record = await run.ui.readRecord('companies', id, NURSERY.map(run.name))
  writeFileSync(join(j.dir, 'record.json'), JSON.stringify(record))

  const p = (name: string) => `Company.properties.${run.key(name)}`
  const app = `import { Company, type CompanyData } from '../kalup/index.js'

type Families = CompanyData['${run.key('plant_families')}']

export function decode(bag: Record<string, string | null>) {
  return {
    zone: ${p('nursery_zone')}.get(bag),
    beds: ${p('bed_count')}.get(bag),
    lastFrost: ${p('last_frost')}.get(bag),
    families: ${p('plant_families')}.get(bag),
    notes: ${p('grower_notes')}.get(bag),
  }
}

export function encode(families: Families): Record<string, string> {
  const change: Record<string, string> = {}
  ${p('nursery_zone')}.set(change, 'glass_house')
  ${p('bed_count')}.set(change, 50)
  ${p('plant_families')}.set(change, [...(families ?? []), 'ferns'])
  ${p('grower_notes')}.set(change, null)
  return change
}
`
  const compiled = compileApp(j.dir, { 'app/records.ts': app }, '--outDir', 'out', '--rootDir', '.')
  expect(compiled.output).toBe('')
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', RUN, 'record.json'], {
    cwd: j.dir,
    encoding: 'utf8',
  })
  expect(out.status, out.stderr).toBe(0)
  expect(JSON.parse(out.stdout)).toEqual({
    decoded: {
      zone: 'glass_house',
      beds: 42,
      lastFrost: '2026-04-12',
      families: ['roses', 'herbs'],
      notes: 'Water the glass house twice a day',
    },
    change: {
      [run.name('nursery_zone')]: 'GLASS HOUSE',
      [run.name('bed_count')]: '50',
      [run.name('plant_families')]: 'roses;herbs;ferns',
    },
  })

  await run.ui.deleteRecord('companies', id)
})
