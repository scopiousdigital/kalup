// J1 live: kalup init on the test portal, whose first pull reads every custom company property there (reading only)
// and writes typed files. The run's nursery is among them with the builders and base J1 offline checks; a second pull
// changes no byte, validate passes, and an app compiles against the run's properties. No other live journey pulls
// outside its own names.
import { expect, test } from 'vitest'
import type { PullData } from '../../src/commands/pull.js'
import { compileApp, journey } from './journey.js'
import { liveRun, NURSERY } from './live.js'

const live = liveRun('j01')

test('J1 live: init and pull write typed files an app compiles against, and validate passes', async () => {
  const run = await live.open()
  const j = journey(run.backend)

  const init = await j.kalup('init', '--portal', String(run.portalId), '--objects', 'companies')
  expect(init.exitCode, init.stdout + init.stderr).toBe(0)
  const objects = j.read('kalup/objects/companies.ts')
  expect(objects).toContain(`${run.key('nursery_zone')}: p.enum('${run.name('nursery_zone')}', {`)
  expect(objects).toContain(`${run.key('plant_families')}: p.multiEnum('${run.name('plant_families')}', {`)
  expect(objects).toContain(`${run.key('last_frost')}: p.date('${run.name('last_frost')}', {`)
  expect(objects).toContain(`${run.key('bed_count')}: p.number('${run.name('bed_count')}', {`)
  expect(j.read('kalup/index.ts')).toContain("export { Company } from './objects/companies.js'")
  const { resources } = j.state()
  for (const address of [...NURSERY.map((n) => run.address(n)), run.address('nursery', 'group')]) {
    expect(resources[address], address).toMatchObject({ origin: 'pulled' })
  }

  const pull = await j.kalup<PullData>('pull', '--json')
  expect(pull.exitCode, pull.stdout).toBe(0)
  expect(pull.data?.files).toEqual([])
  expect(pull.data?.objects.companies).toMatchObject({ added: 0, changed: 0 })
  expect(j.read('kalup/objects/companies.ts')).toBe(objects)

  const validate = await j.kalup('validate', '--json')
  expect(validate.exitCode, validate.stdout).toBe(0)
  expect(validate.envelope).toMatchObject({ ok: true })

  const app = `import { Company } from '../kalup/index.js'

export function describe(bag: Record<string, string | null>): string {
  const zone = Company.properties.${run.key('nursery_zone')}.get(bag)
  const beds: number | null = Company.properties.${run.key('bed_count')}.get(bag)
  return \`\${zone ?? 'no zone'}: \${beds ?? 0} beds\`
}

export function moveNorth(bag: Record<string, string>): void {
  Company.properties.${run.key('nursery_zone')}.set(bag, 'north')
  // @ts-expect-error 'nort' is not an option
  Company.properties.${run.key('nursery_zone')}.set(bag, 'nort')
}
`
  const compiled = compileApp(j.dir, { 'app/nursery.ts': app }, '--noEmit')
  expect(compiled.output).toBe('')
  expect(compiled.exitCode).toBe(0)
})
