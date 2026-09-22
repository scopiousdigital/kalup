import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type BuilderKind,
  type Definition,
  type Group,
  HUBSPOT_TYPES,
  type ObjectExport,
  type Property,
  validate as validateProject,
} from '@kalup/core'
import { afterEach, expect, test, vi } from 'vitest'
import { canonical } from '../../src/commands/fmt.js'
import type { DiscoverData, PullData } from '../../src/commands/pull.js'
import { cli, copy, empty, parseEnvelope, project } from '../../src/commands/testing.js'
import type { Fetch } from '../../src/lib/http.js'
import { load, readProjectFiles } from '../../src/lib/load.js'
import { camelCase, exportName } from '../../src/lib/pull/keys.js'
import { mergeObject } from '../../src/lib/pull/merge.js'
import type { LiveObject, LiveProperty } from '../../src/lib/pull/normalize.js'
import { addressMatcher, scopeOf } from '../../src/lib/pull/scope.js'
import { fakeFetch, fixture, jsonResponse } from '../../src/lib/testing.js'

const key = 'kalup-test-secret-9f2c'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const files = ['kalup/objects/companies.ts', 'kalup/objects/harvest.ts', 'kalup/index.ts']
const rate = {
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}

const routes = {
  account: '/account-info/2026-09/details',
  schemas: '/crm-object-schemas/2026-09/schemas',
  companies: '/crm/properties/2026-09/companies',
  companyGroups: '/crm/properties/2026-09/companies/groups',
  harvest: '/crm/properties/2026-09/2-4242001',
  harvestGroups: '/crm/properties/2026-09/2-4242001/groups',
}

type Bodies = Record<string, unknown>

/** The orchard portal: the API fixtures under test/fixtures/api/orchard, keyed by path. */
function orchard(): Bodies {
  return {
    [routes.account]: fixture('account-info.json'),
    [routes.schemas]: fixture('api/orchard/schemas.json'),
    [routes.companies]: fixture('api/orchard/companies.properties.json'),
    [routes.companyGroups]: fixture('api/orchard/companies.groups.json'),
    [routes.harvest]: fixture('api/orchard/harvest.properties.json'),
    [routes.harvestGroups]: fixture('api/orchard/harvest.groups.json'),
  }
}

/**
 * Stubs fetch with a portal and the key. Each path answers with its body, or its Response; anything else is a 404.
 * Every call goes through fakeFetch, so a request outside the read-tagged registry paths throws.
 */
function portal(bodies: Bodies = orchard()): { calls: string[] } {
  const calls: string[] = []
  const fetch: Fetch = (url, init) => {
    const { pathname } = new URL(url)
    calls.push(`${init.method ?? 'GET'} ${pathname}`)
    return fakeFetch(answer(bodies[pathname])).fetch(url, init)
  }
  vi.stubGlobal('fetch', fetch)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', key)
  return { calls }
}

function answer(body: unknown): Response {
  if (body instanceof Response) {
    return body
  }
  return body === undefined ? jsonResponse(404, { message: 'Not found' }) : jsonResponse(200, body, rate)
}

function withProperties(bodies: Bodies, route: string, edit: (p: Record<string, unknown>) => Record<string, unknown>) {
  const list = bodies[route] as { results: Record<string, unknown>[] }
  bodies[route] = { results: list.results.map(edit) }
  return bodies
}

function text(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(['kalup.config.ts', ...files].map((file) => [file, text(dir, file)]))
}

function biome(dir: string): string {
  try {
    execFileSync(join(root, 'node_modules/.bin/biome'), ['check', `--config-path=${root}`, dir], { encoding: 'utf8' })
    return ''
  } catch (e) {
    const { stdout, stderr } = e as { stdout: string; stderr: string }
    return `${stdout}\n${stderr}`
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('the golden pull: the files equal the pulled fixture, only read paths are hit, history holds the old files', async () => {
  const { calls } = portal()
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox')
  expect(out.exitCode).toBe(0)
  for (const file of files) {
    expect(text(dir, file), file).toBe(text(project('pulled'), file))
  }
  expect(text(dir, 'kalup.config.ts')).toBe(before['kalup.config.ts'])
  expect(calls).toEqual([
    'GET /account-info/2026-09/details',
    'GET /crm-object-schemas/2026-09/schemas',
    'GET /crm/properties/2026-09/companies',
    'GET /crm/properties/2026-09/companies/groups',
    'GET /crm/properties/2026-09/2-4242001',
    'GET /crm/properties/2026-09/2-4242001/groups',
  ])
  const [stamp] = readdirSync(join(dir, '.kalup', 'history'))
  const history = join(dir, '.kalup', 'history', stamp ?? '')
  for (const file of ['kalup/objects/companies.ts', 'kalup/objects/harvest.ts']) {
    expect(text(history, file)).toBe(before[file])
  }
  // The barrel did not change, so it was neither written nor copied.
  expect(existsSync(join(history, 'kalup/index.ts'))).toBe(false)
})

test('the summary: counts per object, one line per change, the warnings, the same data with --json', async () => {
  portal()
  const dir = copy('pull')
  const human = await cli(dir, 'pull', '--target', 'sandbox')
  expect(human.exitCode).toBe(0)
  expect(human.stdout).toContain('companies: 5 added, 4 changed, 3 unchanged, 2 missing in portal\n')
  expect(human.stdout).toContain('harvest: 2 added, 2 changed, 2 unchanged, 0 missing in portal\n')
  expect(human.stdout).toContain('  missing in portal: property:companies/harvest_window\n')
  expect(human.stdout).toContain('  changed: property:companies/yield_tier#label "Yield tier" -> "Yield band"\n')
  expect(human.stdout).toContain(
    '  changed: property:companies/yield_tier#description none -> "Set by the yield sync"\n',
  )
  expect(human.stdout).toContain('  added: property:companies/yield_tier#options[peak]\n')
  expect(human.stdout).toContain('  only in config: property:companies/yield_tier#options[trial]\n')
  expect(human.stdout).toContain('  changed: group:companies/orchard#label "Orchard" -> "Orchard details"\n')
  expect(human.stdout).toContain(
    '  changed: object:harvest#searchableProperties none -> ["batch_code","orchard_ref"]\n',
  )
  expect(human.stdout).toContain('wrote kalup/objects/companies.ts\nwrote kalup/objects/harvest.ts\n')
  expect(human.stderr).toContain('W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates')
  expect(human.stderr).toContain('W_KEY_COLLISION: property:companies/plot_count: the key plotCount is taken')

  portal()
  const json = await cli(copy('pull'), 'pull', '--target', 'sandbox', '--json')
  expect(json.stderr).toBe('')
  const env = parseEnvelope<PullData>(json.stdout)
  expect(env.ok).toBe(true)
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_UNSUPPORTED_TYPE', 'W_KEY_COLLISION'])
  expect(env.data?.target).toBe('sandbox')
  expect(env.data?.portalId).toBe(1_111_111)
  expect(env.data?.files).toEqual(['kalup/objects/companies.ts', 'kalup/objects/harvest.ts'])
  expect(env.data?.objects.companies).toMatchObject({ added: 5, changed: 4, unchanged: 3, missing: 2 })
  expect(env.data?.objects.harvest).toMatchObject({ added: 2, changed: 2, unchanged: 2, missing: 0 })
  const changes = env.data?.objects.companies?.changes ?? []
  expect(changes).toContainEqual({
    kind: 'added',
    address: 'property:companies/lifecyclestage',
    field: 'options[subscriber]',
  })
  expect(changes).toContainEqual({ kind: 'added', address: 'property:companies/plot_count' })
  expect(changes).toContainEqual({ kind: 'added', address: 'property:companies/soil_ph' })
  expect(changes).toContainEqual({ kind: 'added', address: 'group:companies/plots' })
  expect(changes).toContainEqual({ kind: 'missing', address: 'group:companies/legacy' })
  expect(changes).toContainEqual({
    kind: 'changed',
    address: 'property:companies/row_meta',
    field: 'description',
    after: 'Row layout as JSON',
  })
  expect(env.data?.objects.harvest?.changes).toContainEqual({
    kind: 'changed',
    address: 'property:harvest/batch_code',
    field: 'hasUniqueValue',
    after: true,
  })
})

test('a second pull with no portal change is byte-identical and writes no history', async () => {
  portal()
  const dir = copy('pull')
  await cli(dir, 'pull', '--target', 'sandbox')
  const again = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(again.exitCode).toBe(0)
  expect(parseEnvelope<PullData>(again.stdout).data?.files).toEqual([])
  for (const file of files) {
    expect(text(dir, file), file).toBe(text(project('pulled'), file))
  }
  expect(readdirSync(join(dir, '.kalup', 'history'))).toHaveLength(1)

  const golden = copy('pulled')
  const out = await cli(golden, 'pull', '--target', 'sandbox')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toContain('Files are up to date\n')
  for (const file of files) {
    expect(text(golden, file), file).toBe(text(project('pulled'), file))
  }
  expect(existsSync(join(golden, '.kalup'))).toBe(false)
})

test('the golden files pass biome, are canonical, validate, and load into the same IR as the pull output', async () => {
  expect(biome(project('pulled'))).toBe('')
  for (const name of ['pull', 'pulled']) {
    const project_ = readProjectFiles(project(name))
    for (const [file, canon] of canonical(project_)) {
      expect(canon, `${name}/${file}`).toBe(project_[file])
    }
  }
  portal()
  const dir = copy('pull')
  await cli(dir, 'pull', '--target', 'sandbox')
  const loaded = load(dir)
  expect(validateProject(loaded).issues).toEqual([])
  expect(loaded.ir).toEqual(load(project('pulled')).ir)
})

test('--check writes nothing and lists the files that would change; exit 2 only with --exit-code', async () => {
  portal()
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--check')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toContain('would write kalup/objects/companies.ts\nwould write kalup/objects/harvest.ts\n')
  expect(snapshot(dir)).toEqual(before)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
  const pending = await cli(dir, 'pull', '--target', 'sandbox', '--check', '--exit-code', '--json')
  expect(pending.exitCode).toBe(2)
  expect(parseEnvelope<PullData>(pending.stdout)).toMatchObject({
    ok: true,
    data: { files: ['kalup/objects/companies.ts', 'kalup/objects/harvest.ts'] },
  })
  expect(snapshot(dir)).toEqual(before)
  const clean = await cli(copy('pulled'), 'pull', '--target', 'sandbox', '--check', '--exit-code')
  expect(clean.exitCode).toBe(0)
})

test('--only limits the merge to the matching addresses and leaves the rest untouched', async () => {
  portal()
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--only', 'property:companies/yield_*', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.data?.files).toEqual(['kalup/objects/companies.ts'])
  expect(env.data?.objects.companies).toMatchObject({ added: 0, changed: 1, unchanged: 0, missing: 0 })
  expect(env.data?.objects.harvest).toMatchObject({ added: 0, changed: 0, unchanged: 0, missing: 0 })
  const companies = text(dir, 'kalup/objects/companies.ts')
  expect(companies).toContain("label: 'Yield band'")
  expect(companies).toContain("orchard: { label: 'Orchard' }")
  expect(companies).not.toContain('irrigation_notes')
  expect(text(dir, 'kalup/objects/harvest.ts')).toBe(before['kalup/objects/harvest.ts'])
})

test('--discover lists the objects and properties outside the scope and writes nothing', async () => {
  portal()
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--discover', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<DiscoverData>(out.stdout).data).toEqual({
    target: 'sandbox',
    portalId: 1_111_111,
    objects: ['press_run'],
    properties: { companies: ['domain', 'hs_lastmodifieddate'], harvest: ['hs_object_id'] },
  })
  expect(snapshot(dir)).toEqual(before)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
  const human = await cli(dir, 'pull', '--target', 'sandbox', '--discover')
  expect(human.stdout).toContain('  object:press_run  (custom object; add press_run: {} under objects)\n')
  expect(human.stdout).toContain(
    "  property:companies/domain  (HubSpot-defined; add 'domain' to objects.companies.include)\n",
  )
  expect(human.stdout).toContain('Nothing written.\n')
})

test('a per-target name override reads the portal under the override name and writes under the address', async () => {
  const rename = (p: Record<string, unknown>) =>
    p.name === 'picked_on' ? { ...p, name: 'pickedon', label: 'Picked on (legacy name)' } : p
  portal(withProperties(orchard(), routes.harvest, rename))
  const dir = copy('pull')
  const override = "overrides: { 'property:harvest/picked_on': { name: 'pickedon' } },"
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace('credentials:', `${override}\n      credentials:`),
  )
  const out = await cli(dir, 'pull', '--target', 'sandbox')
  expect(out.exitCode).toBe(0)
  const harvest = text(dir, 'kalup/objects/harvest.ts')
  expect(harvest).toContain("pickedOn: p.date('picked_on', {")
  expect(harvest).toContain("label: 'Picked on (legacy name)'")
  expect(harvest).not.toContain('pickedon')

  const both = (p: Record<string, unknown>) => (p.name === 'weight_kg' ? { ...p, name: 'pickedon' } : p)
  portal(withProperties(orchard(), routes.harvest, both))
  const ambiguous = await cli(dir, 'pull', '--target', 'sandbox')
  expect(ambiguous.exitCode).toBe(1)
  expect(ambiguous.stderr).toContain('E_OVERRIDE_AMBIGUOUS')
})

test('an archived property is skipped: a local one is reported missing in portal and kept', async () => {
  portal(withProperties(orchard(), routes.companies, (p) => (p.name === 'plot_total' ? { ...p, archived: true } : p)))
  const dir = copy('pull')
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.data?.objects.companies?.changes).toContainEqual({
    kind: 'missing',
    address: 'property:companies/plot_total',
  })
  expect(text(dir, 'kalup/objects/companies.ts')).toContain("plotCount: p.number('plot_total', {")
})

test('a 403 on one object is a reported gap, and the other objects are still written', async () => {
  const bodies = orchard()
  bodies[routes.harvest] = jsonResponse(403, fixture('errors/missing-scope.json'))
  portal(bodies)
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.ok).toBe(true)
  expect(env.issues.find((issue) => issue.code === 'E_SCOPE')?.message).toContain('crm.schemas.custom.read')
  expect(env.data?.files).toEqual(['kalup/objects/companies.ts'])
  expect(Object.keys(env.data?.objects ?? {})).toEqual(['companies'])
  expect(text(dir, 'kalup/objects/harvest.ts')).toBe(before['kalup/objects/harvest.ts'])
})

test('a 401 exits 1 with E_AUTH and nothing is written', async () => {
  const bodies = orchard()
  bodies[routes.companies] = jsonResponse(401, fixture('errors/unauthorized.json'))
  portal(bodies)
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain('E_AUTH')
  expect(snapshot(dir)).toEqual(before)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
})

test('a portal mismatch exits 4 before any other request', async () => {
  const { calls } = portal({ [routes.account]: { ...fixture('account-info.json'), portalId: 2_222_222 } })
  const out = await cli(copy('pull'), 'pull', '--target', 'sandbox')
  expect(out.exitCode).toBe(4)
  expect(out.stderr).toContain('E_TARGET_PORTAL_MISMATCH')
  expect(calls).toEqual(['GET /account-info/2026-09/details'])
})

test('config errors exit 3: a missing target, an unknown object key, an unknown include name', async () => {
  const { calls } = portal()
  const unknownTarget = await cli(copy('pull'), 'pull', '--target', 'production', '--json')
  expect(unknownTarget.exitCode).toBe(3)
  expect(parseEnvelope(unknownTarget.stdout).issues[0]?.code).toBe('E_UNKNOWN_TARGET')
  expect(calls).toEqual([])

  const dir = copy('pull')
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace('harvest: {},', 'harvest: {},\n    presses: {},'),
  )
  const unknownObject = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(unknownObject.exitCode).toBe(3)
  expect(parseEnvelope(unknownObject.stdout).issues).toEqual([
    {
      code: 'E_UNKNOWN_OBJECT',
      message:
        "'presses' is not a standard object or a custom object in the portal (custom objects: harvest, press_run)",
      file: 'kalup.config.ts',
      line: 8,
      configPath: 'objects.presses',
      fix: 'use one of the names listed, or remove the key',
      docs: 'errors/E_UNKNOWN_OBJECT.md',
    },
  ])
  expect(existsSync(join(dir, '.kalup'))).toBe(false)

  const included = copy('pull')
  writeFileSync(
    join(included, 'kalup.config.ts'),
    text(included, 'kalup.config.ts').replace("'lifecyclestage'", "'lifecyclestage', 'nope', 'never'"),
  )
  const unknownInclude = await cli(included, 'pull', '--target', 'sandbox', '--json')
  expect(unknownInclude.exitCode).toBe(3)
  expect(parseEnvelope(unknownInclude.stdout).issues[0]).toMatchObject({
    code: 'E_UNKNOWN_INCLUDE',
    message: 'objects.companies.include names properties the portal does not have: nope, never',
    configPath: 'objects.companies.include',
  })
})

test('pull needs --target, and a missing key names the variable and never its value', async () => {
  const usage = await cli(copy('pull'), 'pull')
  expect(usage.exitCode).toBe(1)
  expect(usage.stderr).toContain('E_USAGE: kalup pull needs --target <name>')
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', undefined)
  const out = await cli(copy('pull'), 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(1)
  expect(parseEnvelope(out.stdout).issues[0]).toMatchObject({
    code: 'E_MISSING_KEY',
    message: 'HUBSPOT_SANDBOX_KEY is not set.',
  })
})

const failing: Record<string, () => Bodies> = {
  '401': () => ({ ...orchard(), [routes.companies]: jsonResponse(401, fixture('errors/unauthorized.json')) }),
  '403 on account-info': () => ({ [routes.account]: jsonResponse(403, fixture('errors/missing-scope.json')) }),
  'portal mismatch': () => ({ [routes.account]: { ...fixture('account-info.json'), portalId: 2_222_222 } }),
  '5xx': () => ({ ...orchard(), [routes.companyGroups]: jsonResponse(503) }),
  'not JSON': () => ({ ...orchard(), [routes.companies]: new Response('<html>', { status: 200 }) }),
  'nothing answers': () => ({}),
}

test.each(
  Object.entries(failing).flatMap(([name, bodies]) => [
    { name, bodies, json: [] },
    { name, bodies, json: ['--json'] },
  ]),
)('key hygiene: no failing path prints the key: $name $json', async ({ name, bodies, json }) => {
  portal(bodies())
  const dir = copy('pull')
  writeFileSync(join(dir, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\n`)
  const out = await cli(dir, 'pull', '--target', 'sandbox', ...json)
  expect(out.exitCode, name).not.toBe(0)
  expect(`${out.stdout}${out.stderr}`, name).not.toContain(key)
  expect(`${out.stdout}${out.stderr}`.length, name).toBeGreaterThan(0)
})

test('a first pull writes a new file with no header, the default export name and the barrel', async () => {
  const bodies = orchard()
  bodies['/crm/properties/2026-09/2-4242002'] = fixture('api/orchard/harvest.properties.json')
  bodies['/crm/properties/2026-09/2-4242002/groups'] = fixture('api/orchard/harvest.groups.json')
  portal(bodies)
  const dir = empty()
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    [
      "import { defineConfig } from 'kalup'",
      '',
      'export default defineConfig({',
      '  objects: { press_run: {} },',
      "  targets: { sandbox: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } } },",
      '})',
      '',
    ].join('\n'),
  )
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.data?.files).toEqual(['kalup/index.ts', 'kalup/objects/press_run.ts'])
  expect(env.data?.objects.press_run).toMatchObject({ added: 6, changed: 0, unchanged: 0, missing: 0 })
  const file = text(dir, 'kalup/objects/press_run.ts')
  expect(file.startsWith("import { defineCustomObject, type InferProperties, p } from '@kalup/core'\n")).toBe(true)
  expect(file).not.toContain('1111111')
  expect(file).toContain("export const PressRun = defineCustomObject('press_run', {")
  expect(file).toContain("labels: { singular: 'Press run', plural: 'Press runs' },")
  expect(file).toContain("primaryDisplayProperty: 'run_code',")
  expect(text(dir, 'kalup/index.ts')).toBe(
    "export type { PressRunData } from './objects/press_run'\nexport { PressRun } from './objects/press_run'\n",
  )
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
  expect(biome(dir)).toBe('')
  expect(validateProject(load(dir)).issues).toEqual([])
})

test('the barrel is regenerated from every object file', async () => {
  portal()
  const dir = copy('pull')
  rmSync(join(dir, 'kalup', 'index.ts'))
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(parseEnvelope<PullData>(out.stdout).data?.files).toContain('kalup/index.ts')
  expect(text(dir, 'kalup/index.ts')).toBe(text(project('pulled'), 'kalup/index.ts'))
})

test('an object shares its file with another: the file stays their home', async () => {
  portal()
  const dir = copy('pull')
  const companies = text(dir, 'kalup/objects/companies.ts')
  const harvest = text(dir, 'kalup/objects/harvest.ts')
  rmSync(join(dir, 'kalup', 'objects', 'harvest.ts'))
  mkdirSync(join(dir, 'kalup', 'crm'))
  writeFileSync(
    join(dir, 'kalup', 'crm', 'all.ts'),
    `${companies
      .replace(
        "import { defineObject, type InferProperties, p } from '@kalup/core'",
        "import { defineCustomObject, defineObject, type InferProperties, p } from '@kalup/core'",
      )
      .replace("from '../../src/row-meta'", "from '../../src/row-meta'")}\n${harvest.split('\n').slice(2).join('\n')}`,
  )
  rmSync(join(dir, 'kalup', 'objects', 'companies.ts'))
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<PullData>(out.stdout).data?.files).toEqual(['kalup/crm/all.ts', 'kalup/index.ts'])
  expect(readdirSync(join(dir, 'kalup', 'objects'))).toEqual([])
  expect(text(dir, 'kalup/index.ts')).toBe(
    "export type { CompanyData, HarvestData } from './crm/all'\nexport { Company, Harvest } from './crm/all'\n",
  )
})

test('a codec kind that conflicts with the portal type leaves the project valid, so the next pull can run', async () => {
  const asEnum = (p: Record<string, unknown>) =>
    p.name === 'plot_tags'
      ? {
          ...p,
          type: 'enumeration',
          fieldType: 'checkbox',
          options: [{ label: 'North', value: 'north', displayOrder: 0, hidden: false }],
        }
      : p
  portal(withProperties(orchard(), routes.companies, asEnum))
  const dir = copy('pull')
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope(out.stdout).issues.map((i) => i.code)).toContain('W_CODEC_MISMATCH')
  // The portal's fieldType and options would be E_TYPE_FIELDTYPE on p.stringArray, so the property stays as written.
  expect(text(dir, 'kalup/objects/companies.ts')).toContain(
    "plotTags: p.stringArray('plot_tags', {\n      label: 'Plot tags',\n      group: 'orchard',\n      fieldType: 'text',\n    }),",
  )
  expect(validateProject(load(dir)).issues).toEqual([])
  expect((await cli(dir, 'pull', '--target', 'sandbox', '--json')).exitCode).toBe(0)
})

test('a name override also maps the schema fields that name the property', async () => {
  const bodies = withProperties(orchard(), routes.harvest, (p) =>
    p.name === 'batch_code' ? { ...p, name: 'batchcode' } : p,
  )
  withProperties(bodies, routes.schemas, (s) =>
    s.name === 'harvest'
      ? {
          ...s,
          primaryDisplayProperty: 'batchcode',
          requiredProperties: ['batchcode'],
          searchableProperties: ['batchcode', 'orchard_ref'],
        }
      : s,
  )
  portal(bodies)
  const dir = copy('pull')
  const override = "overrides: { 'property:harvest/batch_code': { name: 'batchcode' } },"
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace('credentials:', `${override}\n      credentials:`),
  )
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const harvest = text(dir, 'kalup/objects/harvest.ts')
  expect(harvest).toContain("primaryDisplayProperty: 'batch_code',")
  expect(harvest).toContain("requiredProperties: ['batch_code'],")
  expect(harvest).toContain("searchableProperties: ['batch_code', 'orchard_ref'],")
  expect(harvest).not.toContain('batchcode')
  const objectChanges = parseEnvelope<PullData>(out.stdout).data?.objects.harvest?.changes ?? []
  expect(objectChanges.filter((c) => c.address === 'object:harvest').map((c) => c.field)).toEqual([
    'searchableProperties',
    'secondaryDisplayProperties',
  ])
})

test('--only writes no file for an object it leaves untouched', async () => {
  portal()
  const dir = copy('pull')
  rmSync(join(dir, 'kalup/objects/harvest.ts'))
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--only', 'property:companies/yield_*', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<PullData>(out.stdout).data?.files).toEqual(['kalup/index.ts', 'kalup/objects/companies.ts'])
  expect(existsSync(join(dir, 'kalup/objects/harvest.ts'))).toBe(false)
  expect(validateProject(load(dir)).issues).toEqual([])
})

test('--only object:<name> refreshes the schema fields alone; --only group:* refreshes the groups alone', async () => {
  portal()
  const dir = copy('pull')
  const before = snapshot(dir)
  const object = await cli(dir, 'pull', '--target', 'sandbox', '--only', 'object:harvest', '--json')
  expect(object.exitCode).toBe(0)
  const objectEnv = parseEnvelope<PullData>(object.stdout)
  expect(objectEnv.data?.files).toEqual(['kalup/objects/harvest.ts'])
  expect(objectEnv.data?.objects.harvest).toMatchObject({ added: 0, changed: 1, unchanged: 0, missing: 0 })
  expect(objectEnv.data?.objects.companies).toMatchObject({ added: 0, changed: 0, unchanged: 0, missing: 0 })
  const harvest = text(dir, 'kalup/objects/harvest.ts')
  expect(harvest).toContain("searchableProperties: ['batch_code', 'orchard_ref'],")
  expect(harvest).toContain("secondaryDisplayProperties: ['picked_on'],")
  expect(harvest).not.toContain('weight_kg')
  expect(text(dir, 'kalup/objects/companies.ts')).toBe(before['kalup/objects/companies.ts'])
  expect(validateProject(load(dir)).issues).toEqual([])

  portal()
  const groups = copy('pull')
  const group = await cli(groups, 'pull', '--target', 'sandbox', '--only', 'group:*', '--json')
  expect(group.exitCode).toBe(0)
  const groupEnv = parseEnvelope<PullData>(group.stdout)
  expect(groupEnv.data?.files).toEqual(['kalup/objects/companies.ts'])
  expect(groupEnv.data?.objects.companies).toMatchObject({ added: 0, changed: 1, unchanged: 0, missing: 1 })
  expect(groupEnv.data?.objects.harvest).toMatchObject({ added: 0, changed: 0, unchanged: 1, missing: 0 })
  const companies = text(groups, 'kalup/objects/companies.ts')
  expect(companies).toContain("orchard: { label: 'Orchard details' }")
  expect(companies).toContain("label: 'Yield tier'")
  expect(companies).not.toContain('irrigation_notes')
  expect(text(groups, 'kalup/objects/harvest.ts')).toBe(before['kalup/objects/harvest.ts'])
})

test('a local property outside the scope is kept as written and printed as out of scope', async () => {
  portal()
  const dir = copy('pull')
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace("include: ['name', 'lifecyclestage'] }", "include: ['name'], custom: false }"),
  )
  const out = await cli(dir, 'pull', '--target', 'sandbox')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toContain('  out of scope, not refreshed: property:companies/yield_tier\n')
  expect(out.stdout).toContain('  out of scope, not refreshed: property:companies/lifecyclestage\n')
  const companies = text(dir, 'kalup/objects/companies.ts')
  expect(companies).toContain("label: 'Yield tier'")
  expect(companies).toContain("{ value: 'customer', label: 'Customer', as: 'paying' }")
  expect(companies).not.toContain('irrigation_notes')
})

test('a group name override reads the portal group under the override name and writes it under the address', async () => {
  const bodies = withProperties(orchard(), routes.companies, (p) =>
    p.groupName === 'orchard' ? { ...p, groupName: 'orchardinfo' } : p,
  )
  withProperties(bodies, routes.companyGroups, (g) => (g.name === 'orchard' ? { ...g, name: 'orchardinfo' } : g))
  portal(bodies)
  const dir = copy('pull')
  const override = "overrides: { 'group:companies/orchard': { name: 'orchardinfo' } },"
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace('credentials:', `${override}\n      credentials:`),
  )
  const out = await cli(dir, 'pull', '--target', 'sandbox')
  expect(out.exitCode).toBe(0)
  expect(text(dir, 'kalup/objects/companies.ts')).toBe(text(project('pulled'), 'kalup/objects/companies.ts'))
})

test('a 403 on the schemas list is a reported gap: the custom object is skipped, the standard one is written', async () => {
  const bodies = orchard()
  bodies[routes.schemas] = jsonResponse(403, fixture('errors/missing-scope.json'))
  portal(bodies)
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.issues.map((issue) => issue.code)).toContain('E_SCOPE')
  expect(env.data?.files).toEqual(['kalup/objects/companies.ts'])
  expect(Object.keys(env.data?.objects ?? {})).toEqual(['companies'])
  expect(text(dir, 'kalup/objects/harvest.ts')).toBe(before['kalup/objects/harvest.ts'])
})

test('portal text is escaped in the file and stripped from the change line; a long description is capped in output only', async () => {
  const label = 'Plot\u0007 total\u001b[31m\nnext'
  const description = 'Row '.repeat(50)
  portal(
    withProperties(orchard(), routes.companies, (p) => (p.name === 'plot_total' ? { ...p, label, description } : p)),
  )
  const dir = copy('pull')
  const human = await cli(dir, 'pull', '--target', 'sandbox')
  expect(human.exitCode).toBe(0)
  expect(human.stdout).toContain('  changed: property:companies/plot_total#label "Plot total" -> "Plot totalnext"\n')
  expect(human.stdout).toContain(`#description none -> "${description.slice(0, 119)}…"\n`)
  expect(human.stdout).not.toContain('\u0007')
  expect(human.stdout).not.toContain('\u001b')
  const file = text(dir, 'kalup/objects/companies.ts')
  expect(file).toContain("label: 'Plot\\u0007 total\\u001b[31m\\nnext',")
  expect(file).toContain(`description: '${description}',`)
  expect(validateProject(load(dir)).issues).toEqual([])
  const again = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(parseEnvelope<PullData>(again.stdout).data?.files).toEqual([])
})

test('an option value with a single quote is written in double quotes, reloads, and re-pulls byte-identical', async () => {
  const option = { label: "Grower's pick", value: "grower's", displayOrder: 2, hidden: false }
  portal(
    withProperties(orchard(), routes.companies, (p) =>
      p.name === 'yield_tier' ? { ...p, options: [...(p.options as unknown[]), option] } : p,
    ),
  )
  const dir = copy('pull')
  expect((await cli(dir, 'pull', '--target', 'sandbox')).exitCode).toBe(0)
  expect(text(dir, 'kalup/objects/companies.ts')).toContain(`{ value: "grower's", label: "Grower's pick" },`)
  const loaded = load(dir)
  expect(validateProject(loaded).issues).toEqual([])
  expect(loaded.ir.resources['property:companies/yield_tier']).toMatchObject({
    definition: { options: expect.arrayContaining([{ value: "grower's", label: "Grower's pick" }]) },
  })
  const again = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(parseEnvelope<PullData>(again.stdout).data?.files).toEqual([])
})

// The merge, rule by rule, on the pure function.

const lp = (
  name: string,
  kind: BuilderKind,
  definition?: Definition,
  more: Partial<LiveProperty> = {},
): LiveProperty => ({
  name,
  hubspotDefined: false,
  type: HUBSPOT_TYPES[kind],
  kind,
  reference: false,
  calculated: false,
  definition,
  ...more,
})

const prop = (
  propertyKey: string,
  kind: BuilderKind,
  name: string,
  definition?: Definition,
  more: Partial<Property> = {},
): Property => ({
  key: propertyKey,
  kind,
  name,
  definition,
  chain: { required: false, readonly: false, managed: true },
  comments: [],
  ...more,
})

const local = (
  properties: Property[],
  groups: Group[] = [{ name: 'orchard', label: 'Orchard', comments: [] }],
): ObjectExport => ({
  name: 'Company',
  builder: 'defineObject',
  object: 'companies',
  comments: [],
  groups,
  properties,
})

function merge(
  existing: ObjectExport | undefined,
  properties: LiveProperty[],
  options: {
    groups?: Record<string, string>
    only?: string
    scope?: { custom?: boolean; include?: string[] }
    custom?: LiveObject['custom']
  } = {},
) {
  const live: LiveObject = {
    object: 'companies',
    groups: new Map(Object.entries(options.groups ?? { orchard: 'Orchard' })),
    properties,
    custom: options.custom,
  }
  return mergeObject({
    live,
    scope: scopeOf(options.scope ?? {}),
    local: existing,
    fresh: { name: 'Company', builder: options.custom ? 'defineCustomObject' : 'defineObject' },
    only: addressMatcher(options.only),
  })
}

const full: Definition = { label: 'Plot count', group: 'orchard', fieldType: 'number' }

test('merge: the portal wins for label, group, fieldType, description, hasUniqueValue and formField', () => {
  const mine: Definition = {
    label: 'Plot notes',
    group: 'orchard',
    fieldType: 'text',
    description: 'old',
    hasUniqueValue: true,
  }
  const theirs: Definition = { label: 'Notes', group: 'plots', fieldType: 'textarea', formField: true }
  const out = merge(local([prop('plotNotes', 'string', 'plot_notes', mine)]), [lp('plot_notes', 'string', theirs)], {
    groups: { orchard: 'Orchard', plots: 'Plots' },
  })
  expect(out.export.properties[0]?.definition).toEqual(theirs)
  expect(out.changes.filter((c) => c.kind === 'changed').map((c) => c.field)).toEqual([
    'label',
    'group',
    'fieldType',
    'description',
    'hasUniqueValue',
    'formField',
  ])
  expect(out.counts).toEqual({ added: 1, changed: 1, unchanged: 1, missing: 0 })
  expect(out.export.groups.map((g) => g.name)).toEqual(['orchard', 'plots'])
})

test('merge: the file wins for key, kind, validator source, chain, comments, aliases and lifecycle', () => {
  const mine: Definition = {
    label: 'Row meta',
    group: 'orchard',
    fieldType: 'text',
    lifecycle: { ignoreChanges: ['description'] },
  }
  const theirs: Definition = { label: 'Row meta', group: 'orchard', fieldType: 'textarea' }
  const kept = prop('meta', 'json', 'row_meta', mine, {
    json: { validatorSource: 'rowMeta' },
    chain: { required: true, readonly: true, managed: false },
    comments: ['keep me'],
  })
  const tier = prop('tier', 'enum', 'plot_count', {
    ...full,
    fieldType: 'select',
    options: [{ value: 'a', label: 'A', as: 'alpha' }],
  })
  const out = merge(local([kept, tier]), [
    lp('row_meta', 'string', theirs),
    lp('plot_count', 'enum', { ...full, fieldType: 'select', options: [{ value: 'a', label: 'A' }] }),
  ])
  expect(out.export.properties[0]).toEqual({ ...kept, definition: { ...theirs, lifecycle: mine.lifecycle } })
  expect(out.export.properties[1]).toEqual(tier)
  expect(out.changes).toEqual([
    { kind: 'changed', address: 'property:companies/row_meta', field: 'fieldType', before: 'text', after: 'textarea' },
  ])
  expect(out.counts).toEqual({ added: 0, changed: 1, unchanged: 2, missing: 0 })
  expect(out.issues).toEqual([])
})

test('merge: a codec kind that conflicts with the portal type is kept as written, with a warning', () => {
  const kept = prop('meta', 'json', 'row_meta', full, { json: { validatorSource: 'rowMeta' } })
  const theirs: Definition = { ...full, fieldType: 'select', options: [{ value: 'a', label: 'A' }] }
  const out = merge(local([kept]), [lp('row_meta', 'enum', theirs)])
  expect(out.export.properties[0]).toEqual(kept)
  expect(out.changes).toEqual([])
  expect(out.counts).toEqual({ added: 0, changed: 0, unchanged: 2, missing: 0 })
  expect(out.issues).toEqual([
    {
      code: 'W_CODEC_MISMATCH',
      message:
        'property:companies/row_meta is p.json in the file but type enumeration in the portal; the file keeps p.json and nothing is refreshed',
      fix: 'change the builder to match the portal type, or keep it if the app relies on it',
    },
  ])
})

test('merge: options merge per value, shared members in portal order, portal-only added, local-only kept and noted', () => {
  const mine: Definition = {
    ...full,
    fieldType: 'select',
    options: [
      { value: 'a', label: 'A', as: 'alpha' },
      { value: 'b', label: 'B', description: 'old' },
      { value: 'c', label: 'C' },
    ],
  }
  const theirs: Definition = {
    ...full,
    fieldType: 'select',
    options: [
      { value: 'c', label: 'C', hidden: true },
      { value: 'b', label: 'Bee' },
      { value: 'd', label: 'D' },
    ],
  }
  const out = merge(local([prop('tier', 'enum', 'plot_count', mine)]), [lp('plot_count', 'enum', theirs)])
  expect(out.export.properties[0]?.definition?.options).toEqual([
    { value: 'c', label: 'C', hidden: true },
    { value: 'b', label: 'Bee' },
    { value: 'd', label: 'D' },
    { value: 'a', label: 'A', as: 'alpha' },
  ])
  expect(out.changes.map((c) => [c.kind, c.field])).toEqual([
    ['changed', 'options[c].hidden'],
    ['changed', 'options[b].label'],
    ['changed', 'options[b].description'],
    ['added', 'options[d]'],
    ['local-only', 'options[a]'],
  ])
  expect(out.counts.changed).toBe(1)
})

test('merge: a local-only option alone leaves the property unchanged', () => {
  const mine: Definition = {
    ...full,
    fieldType: 'select',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  }
  const theirs: Definition = { ...full, fieldType: 'select', options: [{ value: 'a', label: 'A' }] }
  const out = merge(local([prop('tier', 'enum', 'plot_count', mine)]), [lp('plot_count', 'enum', theirs)])
  expect(out.counts).toEqual({ added: 0, changed: 0, unchanged: 2, missing: 0 })
  expect(out.changes).toEqual([{ kind: 'local-only', address: 'property:companies/plot_count', field: 'options[b]' }])
})

test('merge: a property or group missing in the portal is reported and kept', () => {
  const out = merge(local([prop('plotCount', 'number', 'plot_count', full)]), [], { groups: {} })
  expect(out.export.properties.map((p) => p.name)).toEqual(['plot_count'])
  expect(out.export.groups.map((g) => g.name)).toEqual(['orchard'])
  expect(out.counts).toEqual({ added: 0, changed: 0, unchanged: 0, missing: 2 })
  expect(out.changes).toEqual([
    { kind: 'missing', address: 'property:companies/plot_count' },
    { kind: 'missing', address: 'group:companies/orchard' },
  ])
})

test('merge: a local property the scope excludes is kept as is and noted, an in-scope portal property is added', () => {
  const name = lp('name', 'string', undefined, { hubspotDefined: true, reference: true })
  const mine = prop('name', 'string', 'name')
  const out = merge(
    local([mine, prop('plotCount', 'number', 'plot_count', full)]),
    [name, lp('plot_count', 'number', full), lp('plot_size', 'number', full)],
    {
      scope: { include: [] },
    },
  )
  expect(out.export.properties.map((p) => p.key)).toEqual(['name', 'plotCount', 'plotSize'])
  expect(out.export.properties[0]).toEqual(mine)
  expect(out.changes).toEqual([
    { kind: 'out-of-scope', address: 'property:companies/name' },
    { kind: 'added', address: 'property:companies/plot_size' },
  ])
  expect(out.counts).toEqual({ added: 1, changed: 0, unchanged: 2, missing: 0 })
})

test('merge: reference and managed flip with the portal; a reference keeps its chain and aliases', () => {
  const enumRef = lp(
    'stage',
    'enum',
    {
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
    { hubspotDefined: true, reference: true },
  )
  const calc = lp('score', 'number', undefined, { calculated: true, reference: true })
  const managed = lp('plot_count', 'number', full)
  const legacy = lp('legacy_score', 'number', undefined, { calculated: true, reference: true })
  const notMine = prop('legacyScore', 'number', 'legacy_score', full, {
    chain: { required: false, readonly: false, managed: false },
  })
  const out = merge(
    local([
      prop(
        'stage',
        'enum',
        'stage',
        { ...full, fieldType: 'select', options: [{ value: 'a', label: 'Old', as: 'first' }] },
        { chain: { required: true, readonly: false, managed: true } },
      ),
      prop('score', 'number', 'score', full),
      prop('plotCount', 'number', 'plot_count', undefined, {
        chain: { required: false, readonly: true, managed: true },
      }),
      notMine,
    ]),
    [enumRef, calc, managed, legacy],
    { scope: { include: ['stage'] } },
  )
  const [stage, score, plotCount, legacyScore] = out.export.properties
  expect(stage).toMatchObject({
    definition: {
      options: [
        { value: 'a', label: 'A', as: 'first' },
        { value: 'b', label: 'B' },
      ],
    },
    chain: { required: true, readonly: false, managed: true },
  })
  expect(stage?.definition?.lifecycle).toBeUndefined()
  expect(score).toMatchObject({ definition: undefined, chain: { managed: true } })
  expect(plotCount).toMatchObject({ definition: full, chain: { readonly: true } })
  // Nothing owns a .managed(false) definition, so a portal reference leaves it as written.
  expect(legacyScore).toEqual(notMine)
  expect(out.changes.filter((c) => c.address === 'property:companies/legacy_score')).toEqual([])
  expect(out.changes.filter((c) => c.field === 'definition')).toEqual([
    {
      kind: 'changed',
      address: 'property:companies/stage',
      field: 'definition',
      before: 'managed',
      after: 'reference',
    },
    {
      kind: 'changed',
      address: 'property:companies/score',
      field: 'definition',
      before: 'managed',
      after: 'reference',
    },
    {
      kind: 'changed',
      address: 'property:companies/plot_count',
      field: 'definition',
      before: 'reference',
      after: 'managed',
    },
  ])
})

test('merge: a new property gets the camelCase key, or its internal name when that key is taken', () => {
  const out = merge(local([prop('plotCount', 'number', 'plot_total', full)]), [
    lp('plot_total', 'number', full),
    lp('plot_count', 'number', full),
    lp('soil_ph', 'number', undefined, { calculated: true, reference: true }),
  ])
  expect(out.export.properties.map((p) => [p.key, p.name])).toEqual([
    ['plotCount', 'plot_total'],
    ['plot_count', 'plot_count'],
    ['soilPh', 'soil_ph'],
  ])
  expect(out.export.properties[2]).toMatchObject({ chain: { readonly: true } })
  expect(out.issues).toEqual([
    {
      code: 'W_KEY_COLLISION',
      message: 'property:companies/plot_count: the key plotCount is taken, so its internal name is the key',
      fix: 'rename one of the two keys',
    },
  ])
})

test('merge: --only leaves other addresses untouched but still adds a group a merged property needs', () => {
  const stale = prop('tier', 'enum', 'tier', { ...full, fieldType: 'select', label: 'Old' })
  const out = merge(
    local([stale]),
    [
      lp('tier', 'enum', { ...full, fieldType: 'select', label: 'New' }),
      lp('plot_count', 'number', { ...full, group: 'plots' }),
    ],
    {
      groups: { orchard: 'Orchard details', plots: 'Plots' },
      only: 'property:companies/plot_*',
    },
  )
  expect(out.export.properties[0]).toEqual(stale)
  expect(out.export.groups).toEqual([
    { name: 'orchard', label: 'Orchard', comments: [] },
    { name: 'plots', label: 'Plots', comments: [] },
  ])
  expect(out.counts).toEqual({ added: 2, changed: 0, unchanged: 0, missing: 0 })
})

test('merge: a custom object takes labels and display fields from the schema', () => {
  const custom = {
    labels: { singular: 'Harvest', plural: 'Harvests' },
    primaryDisplayProperty: 'a',
    searchableProperties: ['a'],
  }
  const first = merge(undefined, [], { custom })
  expect(first.export).toMatchObject({ builder: 'defineCustomObject', ...custom })
  expect(first.changes).toEqual([{ kind: 'added', address: 'object:companies' }])
  const existing: ObjectExport = {
    ...local([]),
    builder: 'defineCustomObject',
    labels: custom.labels,
    primaryDisplayProperty: 'b',
    requiredProperties: ['b'],
  }
  const again = merge(existing, [], { custom })
  expect(again.export).toMatchObject({ ...custom, requiredProperties: undefined })
  expect(again.changes.filter((c) => c.address === 'object:companies').map((c) => c.field)).toEqual([
    'primaryDisplayProperty',
    'requiredProperties',
    'searchableProperties',
  ])
  expect(merge(again.export, [], { custom }).counts.changed).toBe(0)
})

test('the app-side name rules', () => {
  expect(camelCase('billing_status')).toBe('billingStatus')
  expect(camelCase('hs_lead_status')).toBe('hsLeadStatus')
  expect(camelCase('field_2')).toBe('field2')
  expect(camelCase('a__b')).toBe('aB')
  expect(camelCase('plain')).toBe('plain')
  expect(exportName('companies')).toBe('Company')
  expect(exportName('line_items')).toBe('LineItem')
  expect(exportName('subscription')).toBe('Subscription')
  expect(exportName('press_run')).toBe('PressRun')
  expect(addressMatcher('property:companies/*')('property:companies/a_b')).toBe(true)
  expect(addressMatcher('property:companies/*')('group:companies/a')).toBe(false)
  expect(addressMatcher('group:*')('group:harvest/x')).toBe(true)
  expect(addressMatcher('object:harvest')('object:harvest')).toBe(true)
  expect(addressMatcher('object:harvest')('object:harvests')).toBe(false)
  expect(addressMatcher(undefined)('anything')).toBe(true)
})
