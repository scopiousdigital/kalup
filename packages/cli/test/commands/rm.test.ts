// kalup rm: offline, through the built host, with assertions on the files it leaves. The staged-write failure runs the
// handler from source with node:fs mocked, which the built host (loaded by Node itself) never sees. The lifecycles run
// rm, plan and apply against the stateful simulator.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { Plan, TargetState } from '@kalup/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Flags } from '../../src/commands/context.js'
import type { PullData } from '../../src/commands/pull.js'
import { type RmData, rm } from '../../src/commands/rm.js'
import { cli, copy, parseEnvelope } from '../../src/commands/testing.js'
import { KalupError } from '../../src/lib/output.js'
import { createPortalSim, type PortalSim } from '../support/portal-sim.js'
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
const objects = 'kalup/objects/companies.ts'
const removedFile = 'kalup/removed.ts'
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
  `import { defineRemoved } from 'kalup'\n\nexport default defineRemoved({\n${entries.map((e) => `  ${e},`).join('\n')}\n})\n`

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
    "Removed property:companies/soil_ph from kalup/objects/companies.ts.
    Wrote a destroy tombstone for property:companies/soil_ph to kalup/removed.ts.
    Next: kalup plan --target sandbox shows the delete. It runs only when the target sets allowDestroy: true and a person confirms it at a terminal.
    "
  `)
  expect(seen.calls).toBe(0)
})

test('rm --release writes a release tombstone and says the portal keeps it', async () => {
  offline()
  const dir = copy('apply')
  const out = await cli(dir, 'rm', soilPh, '--release')
  expect(out.exitCode).toBe(0)
  expect(text(dir, removedFile)).toBe(tombstones([`'${soilPh}': { action: 'release' }`]))
  expect(printed(out)).toMatchInlineSnapshot(`
    "Removed property:companies/soil_ph from kalup/objects/companies.ts.
    Wrote a release tombstone for property:companies/soil_ph to kalup/removed.ts.
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
  writeFileSync(join(dir, 'kalup/index.ts'), "export { Company } from './objects/companies'\n")
  const out = await run(dir, 'group:companies/orchard', '--release')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.files).toEqual(['kalup/index.ts', objects, removedFile])
  expect(text(dir, objects)).not.toContain('orchard')
  expect(text(dir, 'kalup/index.ts')).toBe(
    "export type { CompanyData } from './objects/companies'\nexport { Company } from './objects/companies'\n",
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
  const split = 'kalup/objects/a-companies.ts'
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
    "property:companies/legacy_score already has a release tombstone in kalup/removed.ts. Nothing was written.
    Kalup stops managing it; the portal keeps it, and pull no longer brings it back.
    Next: kalup plan --target sandbox shows the release, which sends nothing to HubSpot.
    "
  `)
  expect(project(dir)).toEqual(before)
})

test('an address that is not a property or group on one object is E_TOMBSTONE_ADDRESS, exit 3', async () => {
  offline()
  const dir = copy('pulled')
  const cases = [
    ['soil_ph', "'soil_ph' is not an address"],
    ['object:harvest', 'cannot remove object:harvest'],
    ['property:soil_ph', "'property:soil_ph' is not of the form"],
  ] as const
  const runs = await Promise.all(cases.map(([address]) => run(dir, address)))
  for (const [index, out] of runs.entries()) {
    expect(out.exitCode).toBe(3)
    expect(out.env.issues[0]?.code).toBe('E_TOMBSTONE_ADDRESS')
    expect(out.env.issues[0]?.message).toContain(cases[index]?.[1])
  }
  expect(Object.keys(tree(dir)).some((file) => file.includes('removed.ts'))).toBe(false)
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
