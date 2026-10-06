// kalup rm: offline, through the built host, with assertions on the files it leaves. The staged-write failure runs the
// handler from source with node:fs mocked, which the built host (loaded by Node itself) never sees. The lifecycles run
// rm, plan and apply against the stateful simulator.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { Plan, TargetState } from '@kalup/engine'
import { KalupError } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createPortalSim, type PortalSim } from '../../../engine/test/support/portal-sim.js'
import type { Flags } from '../../src/commands/context.js'
import type { PullData } from '../../src/commands/pull.js'
import { type RmData, rm } from '../../src/commands/rm.js'
import { cli, copy, parseEnvelope } from '../../src/commands/testing.js'
import { printed } from '../support/printed.js'
import { edit, tree } from './orchard.js'

const control = vi.hoisted(() => ({ failRename: 0, renames: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    renameSync: (from: string, to: string) => {
      control.renames += 1
      if (control.renames === control.failRename) {
        throw Object.assign(new Error('rename failed'), { code: 'EIO' })
      }
      fs.renameSync(from, to)
    },
  }
})

const key = 'kalup-rm-sandbox-5b2e'
const portalId = 1_111_111
const soilPh = 'property:companies/soil_ph'
const config = 'kalup.config.ts'
const objects = 'hubspot/objects/companies.ts'
const removedFile = 'hubspot/removed.ts'
const pin = 'portalId: 1111111,'

beforeEach(() => {
  control.failRename = 0
  control.renames = 0
  vi.stubEnv('KALUP_LOCK_DIR', join(copy('apply'), '.locks'))
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', key)
  vi.stubEnv('CI', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function text(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

/** Every project file, history and state left out. */
function project(dir: string): Record<string, string> {
  return Object.fromEntries(Object.entries(tree(dir)).filter(([file]) => !file.startsWith('.')))
}

/** fetch that fails the test if anything calls it. */
function offline(): { calls: number } {
  const seen = { calls: 0 }
  vi.stubGlobal('fetch', () => {
    seen.calls += 1
    throw new Error('rm sent a request')
  })
  return seen
}

async function run(dir: string, ...argv: string[]) {
  const out = await cli(dir, 'rm', ...argv, '--json')
  return { ...out, env: parseEnvelope<RmData>(out.stdout) }
}

const tombstones = (entries: string[]) =>
  `import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n${entries.map((e) => `  ${e},`).join('\n')}\n})\n`

test('rm writes a destroy tombstone canonically, takes the property out of its file and sends no request', async () => {
  const seen = offline()
  const dir = copy('apply')
  const out = await run(dir, soilPh)
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data).toEqual({
    address: soilPh,
    action: 'destroy',
    files: [objects, removedFile],
    from: objects,
  })
  expect(text(dir, removedFile)).toBe(tombstones([`'${soilPh}': { action: 'destroy' }`]))
  expect(text(dir, objects)).not.toContain('soil_ph')
  expect(text(dir, objects)).toContain("orchard: { label: 'Orchard' }")
  expect(seen.calls).toBe(0)
  const human = await cli(copy('apply'), 'rm', soilPh)
  expect(printed(human)).toMatchInlineSnapshot(`
    "Removed property:companies/soil_ph from hubspot/objects/companies.ts.
    Wrote a destroy tombstone for property:companies/soil_ph to hubspot/removed.ts.
    Next: kalup plan --target sandbox shows the delete. It runs only when the target sets allowDestroy: true and a person confirms it at a terminal.
    "
  `)
  expect(seen.calls).toBe(0)
})

test('with dir in the config, rm edits the object file there and writes removed.ts in that folder', async () => {
  offline()
  const dir = copy('apply')
  renameSync(join(dir, 'hubspot'), join(dir, 'crm'))
  edit(dir, config, 'export default defineConfig({', "export default defineConfig({\n  dir: 'crm',")
  const out = await run(dir, soilPh)
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.files).toEqual(['crm/objects/companies.ts', 'crm/removed.ts'])
  expect(text(dir, 'crm/removed.ts')).toBe(tombstones([`'${soilPh}': { action: 'destroy' }`]))
})

test('rm --release writes a release tombstone and says the portal keeps it', async () => {
  offline()
  const dir = copy('apply')
  const out = await cli(dir, 'rm', soilPh, '--release')
  expect(out.exitCode).toBe(0)
  expect(text(dir, removedFile)).toBe(tombstones([`'${soilPh}': { action: 'release' }`]))
  expect(printed(out)).toMatchInlineSnapshot(`
    "Removed property:companies/soil_ph from hubspot/objects/companies.ts.
    Wrote a release tombstone for property:companies/soil_ph to hubspot/removed.ts.
    Kalup stops managing it; the portal keeps it, and pull no longer brings it back.
    Next: kalup plan --target sandbox shows the release, which sends nothing to HubSpot.
    "
  `)
})

test('removing a group takes its entry out, the barrel is written again, and a copy of each file goes to history', async () => {
  offline()
  const dir = copy('apply')
  expect((await run(dir, soilPh)).exitCode).toBe(0)
  // A barrel out of canonical form is written again with the rest.
  writeFileSync(join(dir, 'hubspot/index.ts'), "export { Company } from './objects/companies'\n")
  const out = await run(dir, 'group:companies/orchard', '--release')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.files).toEqual(['hubspot/index.ts', objects, removedFile])
  expect(text(dir, objects)).not.toContain('orchard')
  expect(text(dir, 'hubspot/index.ts')).toBe(
    "export type { CompanyData } from './objects/companies.js'\nexport { Company } from './objects/companies.js'\n",
  )
  expect(text(dir, removedFile)).toBe(
    tombstones([`'group:companies/orchard': { action: 'release' }`, `'${soilPh}': { action: 'destroy' }`]),
  )
  const history = Object.keys(tree(dir)).filter((file) => file.startsWith('.kalup/history/'))
  expect(history.filter((file) => file.endsWith(`/${objects}`))).toHaveLength(2)
  expect(history.filter((file) => file.endsWith(`/${removedFile}`))).toHaveLength(1)
})

test('preventDestroy refuses a destroy with E_PREVENT_DESTROY, exit 3, and allows a release', async () => {
  offline()
  const dir = copy('apply')
  edit(dir, objects, "fieldType: 'number',", "fieldType: 'number',\n      lifecycle: { preventDestroy: true },")
  const before = project(dir)
  const out = await run(dir, soilPh)
  expect(out.exitCode).toBe(3)
  expect(out.env.issues[0]).toMatchObject({
    code: 'E_PREVENT_DESTROY',
    message: expect.stringContaining(soilPh),
    file: objects,
    fix: expect.stringContaining(`kalup rm ${soilPh} --release`),
  })
  expect(project(dir)).toEqual(before)
  expect((await run(dir, soilPh, '--release')).exitCode).toBe(0)
})

test('a group config properties use, or a property a custom object schema names, is E_RM_DEPENDENTS, exit 3', async () => {
  offline()
  const dir = copy('pulled')
  const before = project(dir)
  const group = await run(dir, 'group:harvest/harvest_details', '--release')
  expect(group.exitCode).toBe(3)
  expect(group.env.issues[0]).toMatchObject({
    code: 'E_RM_DEPENDENTS',
    message: expect.stringContaining(
      'property:harvest/batch_code, property:harvest/orchard_ref, property:harvest/picked_on, property:harvest/weight_kg',
    ),
  })
  const named = await run(dir, 'property:harvest/picked_on')
  expect(named.exitCode).toBe(3)
  expect(named.env.issues[0]).toMatchObject({
    code: 'E_RM_DEPENDENTS',
    message: expect.stringContaining('config names it: object:harvest'),
  })
  expect(project(dir)).toEqual(before)
  expect((await run(dir, 'property:harvest/weight_kg')).exitCode).toBe(0)
})

// The canonical writer leaves no properties block, which defineObject takes as no properties, so the app still loads.
test('removing the last property of an export leaves it with its groups and no properties block', async () => {
  offline()
  const dir = copy('apply')
  expect((await run(dir, soilPh, '--release')).exitCode).toBe(0)
  expect(text(dir, objects)).toBe(
    [
      '// Orchard CRM: the company group and properties the apply tests write.',
      '',
      "import { defineObject, type InferProperties } from '@kalup/core'",
      '',
      "export const Company = defineObject('companies', {",
      '  groups: {',
      "    orchard: { label: 'Orchard' },",
      '  },',
      '})',
      '',
      'export type CompanyData = InferProperties<typeof Company.properties> & { id: string }',
      '',
    ].join('\n'),
  )
  expect((await cli(dir, 'validate')).exitCode).toBe(0)
})

test('an object split across files: rm edits the export that defines the address, whatever the file order', async () => {
  offline()
  const dir = copy('apply')
  const split = 'hubspot/objects/a-companies.ts'
  const depth = [
    "import { defineObject, type InferProperties, p } from '@kalup/core'",
    '',
    "export const CompanyDepth = defineObject('companies', {",
    '  properties: {',
    "    soilDepth: p.number('soil_depth', {",
    "      label: 'Soil depth',",
    "      group: 'orchard',",
    "      fieldType: 'number',",
    '    }),',
    '  },',
    '})',
    '',
    'export type CompanyDepthData = InferProperties<typeof CompanyDepth.properties> & { id: string }',
    '',
  ].join('\n')
  writeFileSync(join(dir, split), depth)
  expect((await cli(dir, 'validate')).exitCode).toBe(0)
  const first = await run(dir, soilPh)
  expect(first.exitCode, first.stdout).toBe(0)
  expect(first.env.data?.from).toBe(objects)
  expect(text(dir, objects)).not.toContain('soil_ph')
  expect(text(dir, split)).toBe(depth)
  const second = await run(dir, 'property:companies/soil_depth', '--release')
  expect(second.exitCode, second.stdout).toBe(0)
  expect(second.env.data?.from).toBe(split)
  expect(text(dir, split)).not.toContain('soil_depth')
  expect(text(dir, objects)).toContain("orchard: { label: 'Orchard' }")
})

test('an address config does not define gets the tombstone alone', async () => {
  offline()
  const dir = copy('apply')
  const out = await run(dir, 'property:companies/legacy_score', '--release')
  expect(out.exitCode).toBe(0)
  expect(out.env.data).toEqual({
    address: 'property:companies/legacy_score',
    action: 'release',
    files: [removedFile],
  })
  expect(text(dir, removedFile)).toBe(tombstones(["'property:companies/legacy_score': { action: 'release' }"]))
})

test('an address already tombstoned gets its action changed, keeping its reason; the same action writes nothing', async () => {
  offline()
  const dir = copy('apply')
  writeFileSync(
    join(dir, removedFile),
    tombstones(["'property:companies/legacy_score': { action: 'destroy', reason: 'Replaced by soil_ph' }"]),
  )
  const changed = await run(dir, 'property:companies/legacy_score', '--release')
  expect(changed.exitCode).toBe(0)
  expect(changed.env.data?.previous).toBe('destroy')
  expect(text(dir, removedFile)).toBe(
    tombstones(["'property:companies/legacy_score': { action: 'release', reason: 'Replaced by soil_ph' }"]),
  )
  const before = project(dir)
  const same = await cli(dir, 'rm', 'property:companies/legacy_score', '--release')
  expect(same.exitCode).toBe(0)
  expect(printed(same)).toMatchInlineSnapshot(`
    "property:companies/legacy_score already has a release tombstone in hubspot/removed.ts. Nothing was written.
    Kalup stops managing it; the portal keeps it, and pull no longer brings it back.
    Next: kalup plan --target sandbox shows the release, which sends nothing to HubSpot.
    "
  `)
  expect(project(dir)).toEqual(before)
})

test('an address of a type rm does not remove, or not of its form, is E_TOMBSTONE_ADDRESS, exit 3', async () => {
  offline()
  const dir = copy('pulled')
  const cases = [
    ['soil_ph', "'soil_ph' is not an address"],
    ['list:harvest', 'cannot remove list:harvest'],
    ['property:soil_ph', "'property:soil_ph' is not of the form"],
    ['object:harvest/extra', "'object:harvest/extra' is not of the form object:<name>"],
  ] as const
  const runs = await Promise.all(cases.map(([address]) => run(dir, address)))
  for (const [index, out] of runs.entries()) {
    expect(out.exitCode).toBe(3)
    expect(out.env.issues[0]?.code).toBe('E_TOMBSTONE_ADDRESS')
    expect(out.env.issues[0]?.message).toContain(cases[index]?.[1])
  }
  expect(Object.keys(tree(dir)).some((file) => file.includes('removed.ts'))).toBe(false)
})

test('rm on a custom object takes its export out with everything on it and deletes the file it leaves empty', async () => {
  const seen = offline()
  const dir = copy('pulled')
  const out = await run(dir, 'object:harvest')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data).toEqual({
    address: 'object:harvest',
    action: 'destroy',
    files: ['hubspot/index.ts', 'hubspot/objects/harvest.ts', removedFile],
    from: 'hubspot/objects/harvest.ts',
  })
  expect(() => text(dir, 'hubspot/objects/harvest.ts')).toThrow()
  expect(text(dir, removedFile)).toContain("'object:harvest': { action: 'destroy' }")
  expect(text(dir, 'hubspot/index.ts')).not.toContain('harvest')
  // The project still validates: harvest stays under objects, which removed.ts now names.
  const validated = await cli(dir, 'validate', '--json')
  expect(validated.exitCode, validated.stdout).toBe(0)
  expect(seen.calls).toBe(0)
})

// The associations file of the pulled fixture with these entries.
function associations(...entries: string[]): string {
  const body = entries.map((e) => `  ${e},`).join('\n')
  return `import { defineAssociations } from '@kalup/core'\n\nexport const Associations = defineAssociations({\n${body}\n})\n`
}

test('rm on a custom object takes its associations along, and deletes the associations file it leaves empty', async () => {
  offline()
  const dir = copy('pulled')
  const file = 'hubspot/associations.ts'
  writeFileSync(join(dir, file), associations("haul: { from: 'harvest', to: 'companies', name: 'harvest_haul' }"))
  const out = await run(dir, 'object:harvest')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.files).toEqual([file, 'hubspot/index.ts', 'hubspot/objects/harvest.ts', removedFile])
  expect(() => text(dir, file)).toThrow()
  expect(text(dir, 'hubspot/index.ts')).not.toContain('Associations')
  expect((await cli(dir, 'validate', '--json')).exitCode).toBe(0)
})

test('rm takes an association out by its address, whatever key the entry has', async () => {
  offline()
  const dir = copy('pulled')
  const file = 'hubspot/associations.ts'
  const kept = "crew: { from: 'companies', to: 'harvest', name: 'harvest_crew', label: 'Crew' }"
  writeFileSync(
    join(dir, file),
    associations("'haul.one': { from: 'harvest', to: 'companies', name: 'harvest_haul', label: 'Hauler' }", kept),
  )
  const out = await run(dir, 'association:harvest/companies/harvest_haul')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(text(dir, file)).not.toContain('harvest_haul')
  expect(text(dir, file)).toContain('harvest_crew')
  expect(text(dir, removedFile)).toContain("'association:harvest/companies/harvest_haul': { action: 'destroy' }")
})

test('rm of a custom object refuses a destroy while something on it sets preventDestroy, and allows a release', async () => {
  offline()
  const dir = copy('pulled')
  const harvest = 'hubspot/objects/harvest.ts'
  edit(dir, harvest, "fieldType: 'number',", "fieldType: 'number',\n      lifecycle: { preventDestroy: true },")
  const before = project(dir)
  const out = await run(dir, 'object:harvest')
  expect(out.exitCode).toBe(3)
  expect(out.env.issues[0]).toMatchObject({
    code: 'E_PREVENT_DESTROY',
    message:
      'object:harvest takes property:harvest/weight_kg with it, which sets lifecycle.preventDestroy, so rm does not write a destroy tombstone for it. Nothing was written.',
    fix: expect.stringContaining('kalup rm object:harvest --release'),
  })
  expect(project(dir)).toEqual(before)
  expect((await run(dir, 'object:harvest', '--release')).exitCode).toBe(0)
})

test('rm refuses object: on a standard object, or on a key that is no custom object under objects', async () => {
  offline()
  const dir = copy('pulled')
  const before = project(dir)
  const standard = await run(dir, 'object:companies')
  expect(standard.exitCode).toBe(3)
  expect(standard.env.issues[0]).toMatchObject({
    code: 'E_TOMBSTONE_ADDRESS',
    message:
      'object:companies is a standard object: HubSpot defines it, and Kalup removes only custom objects. Nothing was written.',
  })
  const unknown = await run(dir, 'object:crate')
  expect(unknown.exitCode).toBe(3)
  expect(unknown.env.issues[0]).toMatchObject({
    code: 'E_TOMBSTONE_ADDRESS',
    message: 'object:crate is not a custom object under objects in kalup.config.ts. Nothing was written.',
  })
  expect(project(dir)).toEqual(before)
})

test('rm will not turn a custom object release into a destroy: nothing on it is in config to check', async () => {
  offline()
  const dir = copy('pulled')
  expect((await run(dir, 'object:harvest', '--release')).exitCode).toBe(0)
  const before = project(dir)
  const out = await run(dir, 'object:harvest')
  expect(out.exitCode).toBe(3)
  expect(out.env.issues[0]).toMatchObject({
    code: 'E_PREVENT_DESTROY',
    message:
      'object:harvest has a release tombstone, and its groups and properties have left config, so rm cannot check preventDestroy on what an archive would take. Nothing was written.',
    fix: 'remove object:harvest from hubspot/removed.ts, run kalup pull to bring the object back into config, then run kalup rm object:harvest',
  })
  expect(project(dir)).toEqual(before)
})

test('a removal that leaves the project invalid writes nothing: every issue, exit 3', async () => {
  offline()
  const dir = copy('apply')
  edit(dir, config, pin, `${pin}\n      overrides: { '${soilPh}': { name: 'soilph' } },`)
  const before = project(dir)
  const out = await run(dir, soilPh)
  expect(out.exitCode).toBe(3)
  expect(out.env.issues[0]).toMatchObject({ code: 'E_UNKNOWN_OVERRIDE' })
  expect(out.env.issues[0]?.message).toContain(`as rm ${soilPh} would leave it`)
  expect(project(dir)).toEqual(before)
})

test('an invalid project stops rm before anything is written', async () => {
  offline()
  const dir = copy('apply')
  edit(dir, objects, "group: 'orchard',", "group: 'cellar',")
  const before = project(dir)
  expect((await run(dir, soilPh)).exitCode).toBe(3)
  expect(project(dir)).toEqual(before)
})

const flags: Flags = {
  check: false,
  discover: false,
  dryRun: false,
  exitCode: false,
  release: false,
  write: false,
  yes: false,
}

test('a failure on the second rename leaves every file as it was: E_PROJECT_WRITE, exit 1', () => {
  const dir = copy('apply')
  const before = project(dir)
  control.failRename = 2
  let error: unknown
  try {
    rm({ cwd: dir, args: [soilPh], flags })
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(KalupError)
  expect((error as KalupError).issues[0]).toMatchObject({
    code: 'E_PROJECT_WRITE',
    message: expect.stringContaining(`${objects}, ${removedFile} (EIO)`),
  })
  expect((error as KalupError).exitCode).toBe(1)
  expect(control.renames).toBe(2)
  expect(project(dir)).toEqual(before)
})

// The lifecycles, through the commands against the simulator.

function sim(): PortalSim {
  const portal = createPortalSim([
    {
      portalId,
      keys: { HUBSPOT_SANDBOX_KEY: key },
      objects: { companies: { groups: [], properties: [] } },
    },
  ])
  vi.stubGlobal('fetch', portal.fetch)
  return portal
}

function stateOf(dir: string): TargetState {
  return JSON.parse(text(dir, join('.kalup', 'state', `portal-${portalId}.json`))) as TargetState
}

async function planned(dir: string): Promise<Plan> {
  const out = await cli(dir, 'plan', '--out', 'plan.json', '--json')
  if (out.exitCode !== 0) {
    throw new Error(`the plan failed: ${out.stdout}`)
  }
  return parseEnvelope<Plan>(out.stdout).data as Plan
}

function terminal(dir: string, ...answers: string[]) {
  return { cwd: dir, interactive: true, stdin: Readable.from([answers.map((a) => `${a}\n`).join('')]) }
}

/** The apply project with its group and soil_ph created: state owns both. */
async function created(portal: PortalSim): Promise<string> {
  const dir = copy('apply')
  await planned(dir)
  const out = await cli(dir, 'apply', 'plan.json', '--yes')
  if (out.exitCode !== 0) {
    throw new Error(`the first apply failed: ${out.stderr}`)
  }
  portal.log.length = 0
  return dir
}

test('the delete lifecycle: rm, a plan with the delete, apply at a terminal with the count, then no step', async () => {
  const portal = sim()
  const dir = await created(portal)
  expect((await cli(dir, 'rm', soilPh)).exitCode).toBe(0)
  expect(portal.log).toEqual([])
  const refused = await planned(dir)
  expect(refused.steps).toMatchObject([
    { address: soilPh, action: 'delete', risk: 'blocked', blocked: { reason: 'policy' } },
  ])
  edit(dir, config, pin, `${pin}\n      allowDestroy: true,`)
  const plan = await planned(dir)
  expect(plan.steps).toMatchObject([{ address: soilPh, action: 'delete', risk: 'destructive' }])
  const out = await cli(terminal(dir, 'sandbox', '1'), 'apply', 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(portal.writes().map((r) => `${r.method} ${r.path}`)).toEqual([
    'DELETE /crm/properties/2026-09/companies/soil_ph',
  ])
  expect(stateOf(dir).resources[soilPh]).toBeUndefined()
  expect((await planned(dir)).steps).toEqual([])
})

test('the release lifecycle: rm --release, a release step, apply sends no write, and pull never brings it back', async () => {
  const portal = sim()
  const dir = await created(portal)
  expect((await cli(dir, 'rm', soilPh, '--release')).exitCode).toBe(0)
  const plan = await planned(dir)
  expect(plan.steps).toMatchObject([{ address: soilPh, action: 'release', risk: 'safe' }])
  const out = await cli(dir, 'apply', 'plan.json', '--yes')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(portal.writes()).toEqual([])
  expect(stateOf(dir).resources[soilPh]).toBeUndefined()
  expect(portal.object(portalId, 'companies').properties.has('soil_ph')).toBe(true)
  const pulled = await cli(dir, 'pull', '--json')
  expect(pulled.exitCode, pulled.stdout).toBe(0)
  const changes = parseEnvelope<PullData>(pulled.stdout).data?.objects.companies?.changes ?? []
  expect(changes).toContainEqual({ kind: 'removed', address: soilPh })
  expect(text(dir, objects)).not.toContain('soil_ph')
  expect((await planned(dir)).steps).toEqual([])
  expect(portal.writes()).toEqual([])
})

const pipelines = 'hubspot/pipelines/deals.ts'
const PIPELINE = [
  "import { definePipeline } from '@kalup/core'",
  '',
  "export const OrchardSalesPipeline = definePipeline('deals', {",
  "  id: 'orchard_sales',",
  "  label: 'Orchard sales',",
  '  displayOrder: 1,',
  '  stages: {',
  "    tasting: { id: 'orchard_tasting', label: 'Tasting', probability: 0.2 },",
  "    signed: { id: 'orchard_signed', label: 'Signed', probability: 1 },",
  '  },',
  '})',
  '',
].join('\n')

// The apply project with deals and one deal pipeline.
function withPipeline(): string {
  const dir = copy('apply')
  edit(dir, config, 'companies: {},', 'companies: {},\n    deals: {},')
  mkdirSync(join(dir, 'hubspot', 'pipelines'))
  writeFileSync(join(dir, pipelines), PIPELINE)
  return dir
}

test('rm on a stage takes it out of its pipeline; rm on its last stage is refused, as validate refuses the file', async () => {
  const dir = withPipeline()
  const out = await cli(dir, 'rm', 'stage:deals/orchard_sales/orchard_signed', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(parseEnvelope<RmData>(out.stdout).data).toMatchObject({ from: pipelines, action: 'destroy' })
  expect(text(dir, pipelines)).not.toContain('orchard_signed')
  expect(text(dir, removedFile)).toContain("'stage:deals/orchard_sales/orchard_signed': { action: 'destroy' }")
  const last = await cli(dir, 'rm', 'stage:deals/orchard_sales/orchard_tasting', '--json')
  expect(last.exitCode).toBe(3)
  expect(parseEnvelope(last.stdout).issues.map((i) => i.code)).toEqual(['E_PIPELINE_STAGES'])
  expect(text(dir, pipelines)).toContain('orchard_tasting')
})

test('rm on a pipeline takes the whole export with its stages, and deletes a pipeline file it leaves empty', async () => {
  const dir = withPipeline()
  const out = await cli(dir, 'rm', 'pipeline:deals/orchard_sales', '--release', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(parseEnvelope<RmData>(out.stdout).data?.files).toEqual([pipelines, removedFile])
  expect(() => text(dir, pipelines)).toThrow()
  expect(text(dir, removedFile)).toContain("'pipeline:deals/orchard_sales': { action: 'release' }")
  expect(text(dir, 'hubspot/index.ts')).not.toContain('OrchardSalesPipeline')
})
