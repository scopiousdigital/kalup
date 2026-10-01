import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Definition } from '@kalup/core'
import type { Fetch, LiveObject, LiveProperty } from '@kalup/engine'
import {
  addressMatcher,
  type BuilderKind,
  camelCase,
  DEFAULT_DIR,
  exportName,
  FIELD_TYPES,
  type Group,
  HUBSPOT_TYPES,
  layout,
  mergeObject,
  type ObjectExport,
  type Plan,
  type Property,
  scopeOf,
  validate as validateProject,
} from '@kalup/engine'
import { afterEach, expect, test, vi } from 'vitest'
import { fakeFetch, fixture, jsonResponse, portalBody, route } from '../../../engine/test/support/testing.js'
import { canonical } from '../../src/commands/fmt.js'
import type { DiscoverData, PullData } from '../../src/commands/pull.js'
import { cli, copy, empty, parseEnvelope, project } from '../../src/commands/testing.js'
import { load, readProjectFiles } from '../../src/lib/load.js'
import { printed } from '../support/printed.js'

const key = 'kalup-test-secret-9f2c'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const files = ['hubspot/objects/companies.ts', 'hubspot/objects/harvest.ts', 'hubspot/index.ts']
const scopeThenPull = /crm\.schemas\.custom\.read.*kalup pull --target sandbox/
const UNWRITABLE = /grove|grower|hubspot_owner|plot_shape/
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

/** The orchard portal: the API fixtures under packages/engine/test/fixtures/api/orchard, keyed by path. */
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
 * Stubs fetch with a portal and the key. Each route answers with its body, or its Response; a sensitive properties
 * list with none has no properties, and anything else is a 404. Every call goes through fakeFetch, so a request
 * outside the read-tagged registry paths throws.
 */
function portal(bodies: Bodies = orchard()): { calls: string[] } {
  const calls: string[] = []
  const fetch: Fetch = (url, init) => {
    calls.push(`${init.method ?? 'GET'} ${route(url)}`)
    return fakeFetch(answer(portalBody(bodies, url))).fetch(url, init)
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

function withProperties(bodies: Bodies, path: string, edit: (p: Record<string, unknown>) => Record<string, unknown>) {
  const list = bodies[path] as { results: Record<string, unknown>[] }
  bodies[path] = { results: list.results.map(edit) }
  return bodies
}

function text(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(['kalup.config.ts', ...files].map((file) => [file, text(dir, file)]))
}

/** A project whose files agree with the orchard portal: the pull fixture's config, pulled into an empty directory. */
async function inSync(): Promise<string> {
  portal()
  const dir = empty()
  writeFileSync(join(dir, 'kalup.config.ts'), text(project('pull'), 'kalup.config.ts'))
  const out = await cli(dir, 'pull', '--target', 'sandbox')
  if (out.exitCode !== 0) {
    throw new Error(`the first pull failed: ${out.stderr}`)
  }
  return dir
}

function biome(dir: string): string {
  try {
    // The project's own files: .kalup holds state, which Kalup writes in its own format.
    const paths = ['hubspot', 'kalup.config.ts'].map((path) => join(dir, path)).filter((path) => existsSync(path))
    execFileSync(join(root, 'node_modules/.bin/biome'), ['check', `--config-path=${root}`, ...paths], {
      encoding: 'utf8',
    })
    return ''
  } catch (e) {
    const { stdout, stderr } = e as { stdout: string; stderr: string }
    return `${stdout}\n${stderr}`
  }
}

// tsc on a project directory, its output when it reports anything, else ''.
function tsc(dir: string): string {
  try {
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', dir], { encoding: 'utf8' })
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
    'GET /crm/properties/2026-09/companies?dataSensitivity=sensitive',
    'GET /crm/properties/2026-09/companies?dataSensitivity=highly_sensitive',
    'GET /crm/properties/2026-09/companies/groups',
    'GET /crm/properties/2026-09/2-4242001',
    'GET /crm/properties/2026-09/2-4242001?dataSensitivity=sensitive',
    'GET /crm/properties/2026-09/2-4242001?dataSensitivity=highly_sensitive',
    'GET /crm/properties/2026-09/2-4242001/groups',
  ])
  const [stamp] = readdirSync(join(dir, '.kalup', 'history'))
  const history = join(dir, '.kalup', 'history', stamp ?? '')
  for (const file of ['hubspot/objects/companies.ts', 'hubspot/objects/harvest.ts']) {
    expect(text(history, file)).toBe(before[file])
  }
  // The barrel did not change, so it was neither written nor copied.
  expect(existsSync(join(history, 'hubspot/index.ts'))).toBe(false)
})

test('the summary: counts per object, one line per change, the warnings, the same data with --json', async () => {
  portal()
  const dir = copy('pull')
  const human = await cli(dir, 'pull', '--target', 'sandbox')
  expect(human.exitCode).toBe(0)
  expect(printed(human)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111
    companies: 6 added, 4 changed, 3 unchanged, 2 missing in portal
      missing in portal: property:companies/harvest_window
      added: property:companies/lifecyclestage#options[subscriber]
      changed: property:companies/row_meta#description none -> "Row layout as JSON"
      changed: property:companies/yield_tier#label "Yield tier" -> "Yield band"
      changed: property:companies/yield_tier#description none -> "Set by the yield sync"
      added: property:companies/yield_tier#options[peak]
      only in config: property:companies/yield_tier#options[trial]
      added: property:companies/irrigation_notes
      added: property:companies/plot_count
      added: property:companies/plot_shape
      added: property:companies/pruned
      added: property:companies/soil_ph
      missing in portal: group:companies/legacy
      changed: group:companies/orchard#label "Orchard" -> "Orchard details"
      added: group:companies/plots
    harvest: 2 added, 2 changed, 2 unchanged, 0 missing in portal
      changed: object:harvest#searchableProperties none -> ["batch_code","orchard_ref"]
      changed: object:harvest#secondaryDisplayProperties none -> ["picked_on"]
      changed: property:harvest/batch_code#hasUniqueValue none -> true
      added: property:harvest/orchard_ref
      added: property:harvest/weight_kg
    wrote hubspot/objects/companies.ts
    wrote hubspot/objects/harvest.ts
    Recorded the agreed values of 15 resources in state
    State for portal 1111111 is new: .kalup/state/portal-1111111.json
    --- stderr
    W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which Kalup does not write; read as a p.string reference (docs: errors/W_UNSUPPORTED_TYPE.md)
    W_KEY_COLLISION: property:companies/plot_count: the key plotCount is taken, so its internal name is the key (fix: rename one of the two keys) (docs: errors/W_KEY_COLLISION.md)
    "
  `)

  portal()
  const json = await cli(copy('pull'), 'pull', '--target', 'sandbox', '--json')
  expect(json.stderr).toBe('')
  const env = parseEnvelope<PullData>(json.stdout)
  expect(env.ok).toBe(true)
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_UNSUPPORTED_TYPE', 'W_KEY_COLLISION'])
  expect(env.data?.target).toBe('sandbox')
  expect(env.data?.portalId).toBe(1_111_111)
  expect(env.data?.files).toEqual(['hubspot/objects/companies.ts', 'hubspot/objects/harvest.ts'])
  expect(env.data?.objects.companies).toMatchObject({ added: 6, changed: 4, unchanged: 3, missing: 2 })
  expect(env.data?.objects.harvest).toMatchObject({ added: 2, changed: 2, unchanged: 2, missing: 0 })
  const changes = env.data?.objects.companies?.changes ?? []
  expect(changes).toContainEqual({
    kind: 'added',
    address: 'property:companies/lifecyclestage',
    field: 'options[subscriber]',
  })
  expect(changes).toContainEqual({ kind: 'added', address: 'property:companies/plot_count' })
  expect(changes).toContainEqual({ kind: 'added', address: 'property:companies/soil_ph' })
  // Kalup does not write its type: added as a p.string reference, with the warning.
  expect(changes).toContainEqual({ kind: 'added', address: 'property:companies/plot_shape' })
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
  // No file changed, so none went to history; state records what the files and the portal agree on.
  expect(existsSync(join(golden, '.kalup', 'history'))).toBe(false)
  expect(existsSync(join(golden, '.kalup', 'state', 'portal-1111111.json'))).toBe(true)
})

test('the golden files pass biome, are canonical, validate, and load into the same IR as the pull output', async () => {
  expect(biome(project('pulled'))).toBe('')
  for (const name of ['pull', 'pulled']) {
    const project_ = readProjectFiles(project(name))
    for (const [file, canon] of canonical(project_, layout(DEFAULT_DIR))) {
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

// NodeNext is the strictest resolution an app uses: an ESM relative import needs its extension. What passes here also
// resolves under Bundler resolution, Vite, Next.js and plain Node running tsc output.
test('a pulled project and an app importing its barrel compile under NodeNext', async () => {
  portal()
  const dir = copy('pull')
  expect((await cli(dir, 'pull', '--target', 'sandbox')).exitCode).toBe(0)
  mkdirSync(join(dir, 'src'))
  // The validator the hand-written import in companies.ts names.
  writeFileSync(
    join(dir, 'src', 'row-meta.ts'),
    [
      "import type { StandardSchema } from '@kalup/core'",
      '',
      'export const rowMeta: StandardSchema<{ rows: number }> = {',
      "  '~standard': { version: 1, vendor: 'orchard', validate: (value) => ({ value: value as { rows: number } }) },",
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    [
      "import { propertyNames } from '@kalup/core'",
      "import { Company, type CompanyData, Harvest, type HarvestData } from '../hubspot/index.js'",
      '',
      'export const names: string[] = [...propertyNames(Company), ...propertyNames(Harvest)]',
      "export function tier(properties: Record<string, string | null>): CompanyData['yieldTier'] {",
      '  return Company.properties.yieldTier.get(properties)',
      '}',
      'export type Row = HarvestData',
      '',
    ].join('\n'),
  )
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
  const compilerOptions = { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true }
  const tsconfig = { compilerOptions, include: ['kalup.config.ts', 'hubspot', 'src'] }
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig))
  mkdirSync(join(dir, 'node_modules', '@kalup'), { recursive: true })
  symlinkSync(join(root, 'packages', 'core'), join(dir, 'node_modules', '@kalup', 'core'), 'dir')
  expect(tsc(dir)).toBe('')
})

test('--check writes nothing and lists the files that would change; exit 2 only with --exit-code', async () => {
  portal()
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--check')
  expect(out.exitCode).toBe(0)
  expect(printed(out)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111
    companies: 6 added, 4 changed, 3 unchanged, 2 missing in portal
      missing in portal: property:companies/harvest_window
      added: property:companies/lifecyclestage#options[subscriber]
      changed: property:companies/row_meta#description none -> "Row layout as JSON"
      changed: property:companies/yield_tier#label "Yield tier" -> "Yield band"
      changed: property:companies/yield_tier#description none -> "Set by the yield sync"
      added: property:companies/yield_tier#options[peak]
      only in config: property:companies/yield_tier#options[trial]
      added: property:companies/irrigation_notes
      added: property:companies/plot_count
      added: property:companies/plot_shape
      added: property:companies/pruned
      added: property:companies/soil_ph
      missing in portal: group:companies/legacy
      changed: group:companies/orchard#label "Orchard" -> "Orchard details"
      added: group:companies/plots
    harvest: 2 added, 2 changed, 2 unchanged, 0 missing in portal
      changed: object:harvest#searchableProperties none -> ["batch_code","orchard_ref"]
      changed: object:harvest#secondaryDisplayProperties none -> ["picked_on"]
      changed: property:harvest/batch_code#hasUniqueValue none -> true
      added: property:harvest/orchard_ref
      added: property:harvest/weight_kg
    would write hubspot/objects/companies.ts
    would write hubspot/objects/harvest.ts
    --- stderr
    W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which Kalup does not write; read as a p.string reference (docs: errors/W_UNSUPPORTED_TYPE.md)
    W_KEY_COLLISION: property:companies/plot_count: the key plotCount is taken, so its internal name is the key (fix: rename one of the two keys) (docs: errors/W_KEY_COLLISION.md)
    "
  `)
  expect(snapshot(dir)).toEqual(before)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
  const pending = await cli(dir, 'pull', '--target', 'sandbox', '--check', '--exit-code', '--json')
  expect(pending.exitCode).toBe(2)
  expect(parseEnvelope<PullData>(pending.stdout)).toMatchObject({
    ok: true,
    data: { files: ['hubspot/objects/companies.ts', 'hubspot/objects/harvest.ts'] },
  })
  expect(snapshot(dir)).toEqual(before)
  // The pulled files need no rewrite, but they still differ from the portal: a property and a group missing there, an
  // option only in config.
  const held = await cli(copy('pulled'), 'pull', '--target', 'sandbox', '--check', '--exit-code', '--json')
  expect(held.exitCode).toBe(2)
  expect(parseEnvelope<PullData>(held.stdout).data?.files).toEqual([])
  const clean = await cli(await inSync(), 'pull', '--target', 'sandbox', '--check', '--exit-code')
  expect(clean.exitCode).toBe(0)
})

// Each portal edit leaves the in-sync files as they are, yet the portal and the files differ.
const semantic: [name: string, edit: (p: Record<string, unknown>) => Record<string, unknown>, evidence: object][] = [
  [
    'a property missing in the portal',
    (p) => (p.name === 'plot_total' ? { ...p, archived: true } : p),
    { kind: 'missing', address: 'property:companies/plot_total' },
  ],
  [
    'an option only in config',
    (p) =>
      p.name === 'yield_tier'
        ? { ...p, options: (p.options as { value: string }[]).filter((o) => o.value !== 'peak') }
        : p,
    // The pull that put the files in sync recorded peak in the base, so HubSpot removed it.
    { kind: 'removed-in-hubspot', address: 'property:companies/yield_tier', field: 'options[peak]' },
  ],
  [
    'a portal fieldType the builder refuses',
    (p) => (p.name === 'yield_tier' ? { ...p, fieldType: 'checkbox' } : p),
    { code: 'W_CODEC_MISMATCH' },
  ],
]

test.each(semantic)(
  '--check --exit-code exits 2 on a difference that changes no file: %s',
  async (_, edit, evidence) => {
    const dir = await inSync()
    const before = snapshot(dir)
    portal(withProperties(orchard(), routes.companies, edit))
    const out = await cli(dir, 'pull', '--target', 'sandbox', '--check', '--exit-code', '--json')
    expect(out.exitCode).toBe(2)
    const env = parseEnvelope<PullData>(out.stdout)
    expect(env.ok).toBe(true)
    expect(env.data?.files).toEqual([])
    expect([...(env.data?.objects.companies?.changes ?? []), ...env.issues]).toContainEqual(
      expect.objectContaining(evidence),
    )
    expect(snapshot(dir)).toEqual(before)
    expect((await cli(dir, 'pull', '--target', 'sandbox', '--check')).exitCode).toBe(0)
  },
)

// Owner, externalOptions, rich text and phone properties, with invented names: companies.unwritable.json.
function unwritable(): Bodies {
  const bodies = orchard()
  const listed = bodies[routes.companies] as { results: unknown[] }
  const more = fixture('api/orchard/companies.unwritable.json') as { results: unknown[] }
  bodies[routes.companies] = { results: [...listed.results, ...more.results] }
  return bodies
}

test('pull writes owner, rich text and phone properties with their builders, each property Kalup does not write as a p.string reference, and plan leaves those', async () => {
  const dir = empty()
  const config = text(project('pull'), 'kalup.config.ts').replace(
    "include: ['name', 'lifecyclestage']",
    "include: ['name', 'lifecyclestage', 'hubspot_owner_id']",
  )
  writeFileSync(join(dir, 'kalup.config.ts'), config)
  portal(unwritable())
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.issues.filter((i) => i.code === 'W_UNSUPPORTED_TYPE').map((i) => i.message.split(' ')[0])).toEqual([
    'property:companies/plot_shape',
    'property:companies/grove_crew',
    'property:companies/grove_stewards',
  ])
  expect(env.issues.map((i) => i.code)).not.toContain('W_CODEC_MISMATCH')
  const written = text(dir, 'hubspot/objects/companies.ts')
  expect(written.split('\n').filter((line) => UNWRITABLE.test(line) && line.endsWith('),'))).toEqual([
    "    groveCrew: p.string('grove_crew').readonly(),",
    "    groveStewards: p.string('grove_stewards'),",
    "    hubspotOwnerId: p.owner('hubspot_owner_id'),",
    "    plotShape: p.string('plot_shape'),",
  ])
  expect(written).toContain(
    "    groveManager: p.owner('grove_manager', {\n      label: 'Grove manager',\n      group: 'orchard',\n      fieldType: 'select',\n      formField: true,\n    }),",
  )
  expect(written).toContain("    groveNotes: p.string('grove_notes', {\n      label: 'Grove notes',")
  expect(written).toContain("      fieldType: 'html',")
  expect(written).toContain(
    "    growerPhone: p.phoneNumber('grower_phone', {\n      label: 'Grower phone',\n      group: 'orchard',\n      fieldType: 'phonenumber',",
  )
  // A second pull changes nothing; plan adopts the three it manages and has no step for the rest.
  portal(unwritable())
  expect((await cli(dir, 'pull', '--target', 'sandbox', '--check', '--exit-code')).exitCode).toBe(0)
  portal(unwritable())
  const planned = parseEnvelope<Plan>((await cli(dir, 'plan', '--target', 'sandbox', '--json')).stdout).data
  const names = ['grove_crew', 'grove_stewards', 'hubspot_owner_id', 'plot_shape']
  expect(planned?.steps.filter((step) => names.some((n) => step.address.endsWith(`/${n}`)))).toEqual([])
  const managed = ['grove_manager', 'grove_notes', 'grower_phone'].map((n) => `property:companies/${n}`)
  expect(planned?.steps.filter((step) => managed.includes(step.address)).map((s) => [s.action, s.risk])).toEqual([
    ['adopt', 'safe'],
    ['adopt', 'safe'],
    ['adopt', 'safe'],
  ])
})

test('--check --exit-code exits 0 with custom off: the files keep their own properties in scope', async () => {
  const dir = await inSync()
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace('harvest: {}', 'harvest: { custom: false }'),
  )
  portal()
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--check', '--exit-code', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<PullData>(out.stdout).data?.objects.harvest?.changes).toEqual([])
})

test('--only limits the merge to the matching addresses and leaves the rest untouched', async () => {
  portal()
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--only', 'property:companies/yield_*', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.data?.files).toEqual(['hubspot/objects/companies.ts'])
  expect(env.data?.objects.companies).toMatchObject({ added: 0, changed: 1, unchanged: 0, missing: 0 })
  expect(env.data?.objects.harvest).toMatchObject({ added: 0, changed: 0, unchanged: 0, missing: 0 })
  const companies = text(dir, 'hubspot/objects/companies.ts')
  expect(companies).toContain("label: 'Yield band'")
  expect(companies).toContain("orchard: { label: 'Orchard' }")
  expect(companies).not.toContain('irrigation_notes')
  expect(text(dir, 'hubspot/objects/harvest.ts')).toBe(before['hubspot/objects/harvest.ts'])
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
  expect(printed(human)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111
    Outside the pull scope of target sandbox (portal 1111111):
      object:press_run  (custom object; add press_run: {} under objects)
      property:companies/domain  (HubSpot-defined; add 'domain' to objects.companies.include)
      property:companies/hs_lastmodifieddate  (HubSpot-defined; add 'hs_lastmodifieddate' to objects.companies.include)
      property:harvest/hs_object_id  (HubSpot-defined; add 'hs_object_id' to objects.harvest.include)
    Nothing written.
    --- stderr
    W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which Kalup does not write; read as a p.string reference (docs: errors/W_UNSUPPORTED_TYPE.md)
    "
  `)
  // With custom off, the custom properties harvest.ts lacks are outside the scope; the ones it defines never are.
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace('harvest: {}', 'harvest: { custom: false }'),
  )
  const off = await cli(dir, 'pull', '--target', 'sandbox', '--discover', '--json')
  expect(parseEnvelope<DiscoverData>(off.stdout).data?.properties.harvest).toEqual([
    'hs_object_id',
    'orchard_ref',
    'weight_kg',
  ])
})

// The companies entry of the pull fixture's config, with any exclude a test wrote.
const COMPANIES_SCOPE = /companies: \{ (exclude: \[[^\]]*\], )?include:/

// validate refuses a name include and exclude both list, so the hint takes a listed name out of exclude.
test('--discover names exclude for what it leaves out: take a listed name out of it, or include past a pattern', async () => {
  portal()
  const dir = copy('pull')
  const scoped = (exclude: string) =>
    writeFileSync(
      join(dir, 'kalup.config.ts'),
      text(dir, 'kalup.config.ts').replace(COMPANIES_SCOPE, `companies: { exclude: [${exclude}], include:`),
    )
  const lines = async () =>
    printed(await cli(dir, 'pull', '--target', 'sandbox', '--discover'))
      .split('\n')
      .filter((line) => line.startsWith('  property:companies/'))
  scoped("'irrigation_notes', 'domain'")
  expect(await lines()).toMatchInlineSnapshot(`
    [
      "  property:companies/domain  (HubSpot-defined; remove 'domain' from objects.companies.exclude and add it to objects.companies.include)",
      "  property:companies/hs_lastmodifieddate  (HubSpot-defined; add 'hs_lastmodifieddate' to objects.companies.include)",
      "  property:companies/irrigation_notes  (custom, excluded by objects.companies.exclude; remove 'irrigation_notes' from objects.companies.exclude)",
    ]
  `)
  scoped("'irrigation_*'")
  expect(await lines()).toMatchInlineSnapshot(`
    [
      "  property:companies/domain  (HubSpot-defined; add 'domain' to objects.companies.include)",
      "  property:companies/hs_lastmodifieddate  (HubSpot-defined; add 'hs_lastmodifieddate' to objects.companies.include)",
      "  property:companies/irrigation_notes  (custom, excluded by objects.companies.exclude; add 'irrigation_notes' to objects.companies.include)",
    ]
  `)
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
  const harvest = text(dir, 'hubspot/objects/harvest.ts')
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
  expect(text(dir, 'hubspot/objects/companies.ts')).toContain("plotCount: p.number('plot_total', {")
})

test('a 403 on one object is an incomplete read: the other objects are still written, and the exit is 1', async () => {
  const bodies = orchard()
  bodies[routes.harvest] = jsonResponse(403, fixture('errors/missing-scope.json'))
  portal(bodies)
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues.find((issue) => issue.code === 'E_SCOPE')?.message).toContain('crm.schemas.custom.read')
  expect(env.issues.at(-1)).toEqual({
    code: 'E_INCOMPLETE',
    message: expect.stringContaining('the properties list of harvest'),
    fix: expect.stringMatching(scopeThenPull),
    docs: 'errors/E_INCOMPLETE.md',
  })
  expect(env.data?.files).toEqual(['hubspot/objects/companies.ts'])
  expect(Object.keys(env.data?.objects ?? {})).toEqual(['companies'])
  expect(text(dir, 'hubspot/objects/companies.ts')).toBe(text(project('pulled'), 'hubspot/objects/companies.ts'))
  expect(text(dir, 'hubspot/objects/harvest.ts')).toBe(before['hubspot/objects/harvest.ts'])
})

test('pull reads the sensitive properties lists too: a sensitive custom property in scope is written', async () => {
  portal({
    ...orchard(),
    [`${routes.companies}?dataSensitivity=sensitive`]: fixture('api/orchard/companies.sensitive.json'),
  })
  const dir = copy('pulled')
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.data?.files).toEqual(['hubspot/objects/companies.ts'])
  expect(env.data?.objects.companies?.changes).toContainEqual({
    kind: 'added',
    address: 'property:companies/grower_tax_ref',
  })
  expect(text(dir, 'hubspot/objects/companies.ts')).toContain(
    "growerTaxRef: p.string('grower_tax_ref', {\n      label: 'Grower tax reference',\n      group: 'orchard',\n      fieldType: 'text',\n      dataSensitivity: 'sensitive',\n    }),",
  )
})

test('a 403 on a sensitive properties list is an incomplete read of that object: exit 1 with E_INCOMPLETE', async () => {
  const bodies = orchard()
  bodies[`${routes.harvest}?dataSensitivity=sensitive`] = jsonResponse(403, fixture('errors/missing-scope.json'))
  const { calls } = portal(bodies)
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.issues.at(-1)).toMatchObject({
    code: 'E_INCOMPLETE',
    message: expect.stringContaining('the properties list of harvest'),
  })
  expect(Object.keys(env.data?.objects ?? {})).toEqual(['companies'])
  expect(text(dir, 'hubspot/objects/harvest.ts')).toBe(before['hubspot/objects/harvest.ts'])
  expect(calls).not.toContain(`GET ${routes.harvestGroups}`)
})

test('a custom object config defines and the portal lacks is E_UNKNOWN_OBJECT, exit 3, and nothing is written', async () => {
  const schemas = fixture('api/orchard/schemas.json').results as { name: string }[]
  portal({ ...orchard(), [routes.schemas]: { results: schemas.filter((s) => s.name !== 'harvest') } })
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(3)
  expect(parseEnvelope(out.stdout).issues).toEqual([
    {
      code: 'E_UNKNOWN_OBJECT',
      message: expect.stringContaining('(custom objects: press_run)'),
      file: 'kalup.config.ts',
      line: 7,
      configPath: 'objects.harvest',
      fix: expect.any(String),
      docs: 'errors/E_UNKNOWN_OBJECT.md',
    },
  ])
  expect(snapshot(dir)).toEqual(before)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
})

test('a schema missing a label is an issue, never a crash: the merged file would not load, so nothing is written', async () => {
  portal(
    withProperties(orchard(), routes.schemas, (s) =>
      s.name === 'harvest' ? { ...s, labels: { plural: 'Harvests' } } : s,
    ),
  )
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(3)
  const { issues } = parseEnvelope(out.stdout)
  expect(issues.map((i) => i.code).slice(0, 2)).toEqual(['E_PULL_INVALID', 'E_NOT_DATA'])
  expect(issues[1]).toMatchObject({ file: 'hubspot/objects/harvest.ts', message: "missing field 'singular'" })
  expect(snapshot(dir)).toEqual(before)
})

test('skip overrides: skipped resources are kept as written and noted, never a difference for --exit-code', async () => {
  const dir = await inSync()
  const overrides = "overrides: { 'object:harvest': { skip: true }, 'property:companies/plot_tags': { skip: true } },"
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace('credentials:', `${overrides}\n      credentials:`),
  )
  const before = snapshot(dir)
  // The portal edits the skipped property; nothing on it is read or refreshed.
  const { calls } = portal(
    withProperties(orchard(), routes.companies, (p) => (p.name === 'plot_tags' ? { ...p, label: 'Tags' } : p)),
  )
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--check', '--exit-code', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.data?.files).toEqual([])
  expect(env.data?.objects.harvest).toEqual({
    added: 0,
    changed: 0,
    unchanged: 0,
    missing: 0,
    changes: [{ kind: 'excluded', address: 'object:harvest' }],
  })
  expect(env.data?.objects.companies?.changes).toEqual([{ kind: 'excluded', address: 'property:companies/plot_tags' }])
  expect(calls.filter((call) => call.includes('2-4242001') || call.includes('schemas'))).toEqual([])
  const human = await cli(dir, 'pull', '--target', 'sandbox')
  expect(printed(human)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111
    companies: 0 added, 0 changed, 12 unchanged, 0 missing in portal
      skipped on this target, kept as written: property:companies/plot_tags
    harvest: 0 added, 0 changed, 0 unchanged, 0 missing in portal
      skipped on this target, kept as written: object:harvest
    Files are up to date
    --- stderr
    W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which Kalup does not write; read as a p.string reference (docs: errors/W_UNSUPPORTED_TYPE.md)
    "
  `)
  expect(snapshot(dir)).toEqual(before)
})

// The irrigationNotes entry of the in-sync companies file, the newline before it included.
const IRRIGATION_NOTES = /\n {4}irrigationNotes: p\.string\('irrigation_notes', \{\n[^)]*\}\),/

test('a property in hubspot/removed.ts is never written back, is reported removed, and is no difference for --exit-code', async () => {
  const dir = await inSync()
  const companies = text(dir, 'hubspot/objects/companies.ts')
  expect(companies).toMatch(IRRIGATION_NOTES)
  writeFileSync(join(dir, 'hubspot/objects/companies.ts'), companies.replace(IRRIGATION_NOTES, ''))
  const removed =
    "import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n  'property:companies/irrigation_notes': { action: 'release' },\n})\n"
  writeFileSync(join(dir, 'hubspot/removed.ts'), removed)
  const before = snapshot(dir)
  portal()
  const check = await cli(dir, 'pull', '--target', 'sandbox', '--check', '--exit-code', '--json')
  expect(check.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(check.stdout)
  expect(env.data?.files).toEqual([])
  const notes = env.data?.objects.companies?.changes.filter((c) => c.address.includes('irrigation_notes'))
  expect(notes).toEqual([{ kind: 'removed', address: 'property:companies/irrigation_notes' }])
  const out = await cli(dir, 'pull', '--target', 'sandbox')
  expect(out.exitCode).toBe(0)
  expect(snapshot(dir)).toEqual(before)
  expect(text(dir, 'hubspot/removed.ts')).toBe(removed)
})

test('a name override whose portal name is missing: the address is missing in portal, its own name is not read', async () => {
  portal()
  const dir = copy('pulled')
  const override = "overrides: { 'property:harvest/picked_on': { name: 'pickedon' } },"
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace('credentials:', `${override}\n      credentials:`),
  )
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.data?.objects.harvest?.changes).toContainEqual({ kind: 'missing', address: 'property:harvest/picked_on' })
  expect(env.data?.files).toEqual([])
})

function withOverride(dir: string, override: string): void {
  const config = text(dir, 'kalup.config.ts')
  writeFileSync(join(dir, 'kalup.config.ts'), config.replace('credentials:', `${override}\n      credentials:`))
}

test('a property in a group a name override shadows is never written under the renamed group, and differs', async () => {
  const dir = await inSync()
  withOverride(dir, "overrides: { 'group:companies/orchard': { name: 'orchard_v2' } },")
  const before = snapshot(dir)
  // The portal keeps its group orchard, which on this target is no config group, and adds a property to it.
  const bodies = orchard()
  const frost = { name: 'frost_risk', label: 'Frost risk', type: 'string', fieldType: 'text', groupName: 'orchard' }
  ;(bodies[routes.companies] as { results: unknown[] }).results.push(frost)
  portal(bodies)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const companies = parseEnvelope<PullData>(out.stdout).data?.objects.companies
  expect(companies?.added).toBe(0)
  expect(companies?.changes).toEqual(
    expect.arrayContaining([
      { kind: 'shadowed', address: 'property:companies/frost_risk' },
      { kind: 'shadowed', address: 'property:companies/plot_total' },
      { kind: 'missing', address: 'group:companies/orchard' },
    ]),
  )
  expect(snapshot(dir)).toEqual(before)
  expect(text(dir, 'hubspot/objects/companies.ts')).not.toContain('shadowed:')

  // pull --check --exit-code and compare agree that the files and the portal differ.
  portal(bodies)
  expect((await cli(dir, 'pull', '--target', 'sandbox', '--check', '--exit-code')).exitCode).toBe(2)
  portal(bodies)
  const compare = await cli(dir, 'compare', 'config', 'sandbox', '--exit-code')
  expect(compare.exitCode).toBe(2)
  expect(compare.stdout).toContain('differs: property:companies/plot_total')
  portal(bodies)
  const human = await cli(dir, 'pull', '--target', 'sandbox')
  expect(printed(human)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111
    companies: 0 added, 0 changed, 6 unchanged, 1 missing in portal
      refers to a shadowed portal name, not written: property:companies/irrigation_notes
      refers to a shadowed portal name, not written: property:companies/plot_tags
      refers to a shadowed portal name, not written: property:companies/plot_total
      refers to a shadowed portal name, not written: property:companies/pruned
      refers to a shadowed portal name, not written: property:companies/row_meta
      refers to a shadowed portal name, not written: property:companies/yield_tier
      refers to a shadowed portal name, not written: property:companies/frost_risk
      missing in portal: group:companies/orchard
    harvest: 0 added, 0 changed, 6 unchanged, 0 missing in portal
    Files are up to date
    --- stderr
    W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which Kalup does not write; read as a p.string reference (docs: errors/W_UNSUPPORTED_TYPE.md)
    "
  `)
})

test('a custom object schema that names a shadowed property keeps the file values, and differs', async () => {
  const dir = await inSync()
  withOverride(dir, "overrides: { 'property:harvest/batch_code': { name: 'batch_id' } },")
  const before = snapshot(dir)
  portal()
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--check', '--exit-code', '--json')
  expect(out.exitCode).toBe(2)
  expect(parseEnvelope<PullData>(out.stdout).data?.objects.harvest?.changes).toEqual(
    expect.arrayContaining([
      { kind: 'shadowed', address: 'object:harvest' },
      { kind: 'missing', address: 'property:harvest/batch_code' },
    ]),
  )
  portal()
  expect((await cli(dir, 'pull', '--target', 'sandbox')).exitCode).toBe(0)
  expect(snapshot(dir)).toEqual(before)
  expect(text(dir, 'hubspot/objects/harvest.ts')).toContain("primaryDisplayProperty: 'batch_code'")
  portal()
  expect((await cli(dir, 'compare', 'config', 'sandbox', '--exit-code')).exitCode).toBe(2)
  // plan holds what differs there with no pull command, since this pull wrote nothing.
  portal()
  const planned = parseEnvelope<Plan>((await cli(dir, 'plan', '--target', 'sandbox', '--json')).stdout).data
  const held = planned?.steps.find((s) => s.address === 'object:harvest')?.held ?? []
  expect(held.length).toBeGreaterThan(0)
  expect(held.filter((h) => h.resolve !== undefined)).toEqual([])
})

test.each([[['--check']], [['--check', '--exit-code']]])(
  'an incomplete read with %j is exit 1 as well, never a clean result',
  async (flags) => {
    const dir = await inSync()
    const before = snapshot(dir)
    portal({ ...orchard(), [routes.harvestGroups]: jsonResponse(403, fixture('errors/missing-scope.json')) })
    const out = await cli(dir, 'pull', '--target', 'sandbox', ...flags)
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('E_INCOMPLETE: ')
    expect(out.stderr).toContain('the groups list of harvest')
    expect(snapshot(dir)).toEqual(before)
  },
)

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
      message: expect.stringContaining('(custom objects: harvest, press_run)'),
      file: 'kalup.config.ts',
      line: 8,
      configPath: 'objects.presses',
      fix: expect.any(String),
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
    message: expect.stringContaining('nope, never'),
    configPath: 'objects.companies.include',
  })
})

test('with several targets and none selected pull names them, and a missing key names the variable and never its value', async () => {
  const { calls } = portal()
  const several = copy('pull')
  const config = text(several, 'kalup.config.ts').replace(
    '  targets: {\n',
    '  targets: {\n    production: { portalId: 2222222 },\n',
  )
  writeFileSync(join(several, 'kalup.config.ts'), config)
  const required = await cli(several, 'pull')
  expect(required.exitCode).toBe(1)
  expect(required.stdout).toBe('')
  expect(printed(required)).toMatchInlineSnapshot(`
    "--- stderr
    E_TARGET_REQUIRED: kalup.config.ts declares 2 targets and none is selected: production (portal 2222222), sandbox (portal 1111111) (fix: pass --target <name>, or set defaultTarget in kalup.config.ts. An agent should ask the user which portal to use.) (docs: errors/E_TARGET_REQUIRED.md)
    "
  `)
  expect(calls).toEqual([])
  expect(existsSync(join(several, '.kalup'))).toBe(false)
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
      "import { defineConfig } from '@kalup/core'",
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
  expect(env.data?.files).toEqual(['hubspot/index.ts', 'hubspot/objects/press_run.ts'])
  expect(env.data?.objects.press_run).toMatchObject({ added: 6, changed: 0, unchanged: 0, missing: 0 })
  const file = text(dir, 'hubspot/objects/press_run.ts')
  expect(file.startsWith("import { defineCustomObject, type InferProperties, p } from '@kalup/core'\n")).toBe(true)
  expect(file).not.toContain('1111111')
  expect(file).toContain("export const PressRun = defineCustomObject('press_run', {")
  expect(file).toContain("labels: { singular: 'Press run', plural: 'Press runs' },")
  expect(file).toContain("primaryDisplayProperty: 'run_code',")
  expect(text(dir, 'hubspot/index.ts')).toBe(
    "export type { PressRunData } from './objects/press_run.js'\nexport { PressRun } from './objects/press_run.js'\n",
  )
  expect(existsSync(join(dir, '.kalup', 'history'))).toBe(false)
  expect(biome(dir)).toBe('')
  expect(validateProject(load(dir)).issues).toEqual([])
})

test('the barrel is regenerated from every object file', async () => {
  portal()
  const dir = copy('pull')
  rmSync(join(dir, 'hubspot', 'index.ts'))
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(parseEnvelope<PullData>(out.stdout).data?.files).toContain('hubspot/index.ts')
  expect(text(dir, 'hubspot/index.ts')).toBe(text(project('pulled'), 'hubspot/index.ts'))
})

test('an object shares its file with another: the file stays their home', async () => {
  portal()
  const dir = copy('pull')
  const companies = text(dir, 'hubspot/objects/companies.ts')
  const harvest = text(dir, 'hubspot/objects/harvest.ts')
  rmSync(join(dir, 'hubspot', 'objects', 'harvest.ts'))
  mkdirSync(join(dir, 'hubspot', 'crm'))
  writeFileSync(
    join(dir, 'hubspot', 'crm', 'all.ts'),
    `${companies
      .replace(
        "import { defineObject, type InferProperties, p } from '@kalup/core'",
        "import { defineCustomObject, defineObject, type InferProperties, p } from '@kalup/core'",
      )
      .replace(
        "from '../../src/row-meta.js'",
        "from '../../src/row-meta.js'",
      )}\n${harvest.split('\n').slice(2).join('\n')}`,
  )
  rmSync(join(dir, 'hubspot', 'objects', 'companies.ts'))
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<PullData>(out.stdout).data?.files).toEqual(['hubspot/crm/all.ts', 'hubspot/index.ts'])
  expect(readdirSync(join(dir, 'hubspot', 'objects'))).toEqual([])
  expect(text(dir, 'hubspot/index.ts')).toBe(
    "export type { CompanyData, HarvestData } from './crm/all.js'\nexport { Company, Harvest } from './crm/all.js'\n",
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
  expect(text(dir, 'hubspot/objects/companies.ts')).toContain(
    "plotTags: p.stringArray('plot_tags', {\n      label: 'Plot tags',\n      group: 'orchard',\n      fieldType: 'text',\n    }),",
  )
  expect(validateProject(load(dir)).issues).toEqual([])
  expect((await cli(dir, 'pull', '--target', 'sandbox', '--json')).exitCode).toBe(0)
})

test('a portal fieldType the file builder refuses is a codec mismatch: the file stays as written and valid', async () => {
  portal(
    withProperties(orchard(), routes.companies, (p) => (p.name === 'yield_tier' ? { ...p, fieldType: 'checkbox' } : p)),
  )
  const dir = copy('pulled')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.issues.find((i) => i.code === 'W_CODEC_MISMATCH')).toEqual({
    code: 'W_CODEC_MISMATCH',
    message: expect.stringContaining('property:companies/yield_tier'),
    fix: expect.stringContaining('p.multiEnum'),
    docs: 'errors/W_CODEC_MISMATCH.md',
  })
  expect(env.data?.files).toEqual([])
  expect(snapshot(dir)).toEqual(before)
  expect(validateProject(load(dir)).issues).toEqual([])
})

// Custom properties under the prefixes HubSpot reserves: hs_ (HubSpot's own, here not flagged hubspotDefined) and
// a<appId>_ (an integration's). Pull writes both as references (observed 2026-10-01: HubSpot refuses a create with
// either prefix, so Kalup never manages one).
function scored(): Bodies {
  const bodies = withProperties(orchard(), routes.companies, (p) => p)
  const list = bodies[routes.companies] as { results: Record<string, unknown>[] }
  list.results.push(
    { name: 'hs_orchard_score', label: 'Orchard score', type: 'number', fieldType: 'number', groupName: 'orchard' },
    { name: 'a12345_rank', label: 'App rank', type: 'string', fieldType: 'text', groupName: 'orchard' },
  )
  return bodies
}

test.each([[[]], [['--check']]])(
  'a custom property under a prefix HubSpot reserves is pulled as a reference, never as a managed property, with %j too',
  async (flags) => {
    portal(scored())
    const dir = copy('pull')
    const before = snapshot(dir)
    const out = await cli(dir, 'pull', '--target', 'sandbox', '--json', ...flags)
    expect(out.exitCode, out.stdout).toBe(0)
    const env = parseEnvelope<PullData>(out.stdout)
    expect(env.ok).toBe(true)
    expect(env.issues.map((i) => i.code)).not.toContain('E_HS_PREFIX')
    if (flags.length > 0) {
      expect(snapshot(dir)).toEqual(before)
      return
    }
    const file = text(dir, 'hubspot/objects/companies.ts')
    expect(file).toContain("p.number('hs_orchard_score')")
    expect(file).toContain("p.string('a12345_rank')")
    expect(file).not.toContain('Orchard score')
    expect(file).not.toContain('App rank')
    expect(validateProject(load(dir)).issues).toEqual([])
  },
)

test('a new property whose key is taken twice is a loader error in the merged files, and nothing is written', async () => {
  portal()
  const dir = copy('pull')
  const companies = text(dir, 'hubspot/objects/companies.ts')
  writeFileSync(
    join(dir, 'hubspot/objects/companies.ts'),
    companies.replace(
      '    plotCount: p.number(',
      "    plot_count: p.number('plot_sum', { label: 'Plot sum', group: 'orchard', fieldType: 'number' }),\n    plotCount: p.number(",
    ),
  )
  expect(validateProject(load(dir)).issues).toEqual([])
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(3)
  const { issues } = parseEnvelope(out.stdout)
  expect(issues.map((i) => i.code).slice(0, 2)).toEqual(['E_PULL_INVALID', 'E_DUPLICATE_KEY'])
  expect(issues[1]).toMatchObject({ file: 'hubspot/objects/companies.ts', message: "duplicate key 'plot_count'" })
  expect(snapshot(dir)).toEqual(before)
})

// The issues after E_PULL_INVALID quote the merged text, which holds what the portal sent.
test('the issues after E_PULL_INVALID quote portal text with no control characters, and cut a long value', async () => {
  const value = `x\u001b]0;owned\u0007\u001b[2J\u001b[31mRED${'A'.repeat(600)}`
  const twice = [0, 1].map((i) => ({ label: `Twice ${i}`, value, displayOrder: 5 + i, hidden: false }))
  const bodies = withProperties(orchard(), routes.companies, (p) =>
    p.name === 'yield_tier' ? { ...p, options: [...(p.options as unknown[]), ...twice] } : p,
  )
  portal(bodies)
  const dir = copy('pull')
  const human = await cli(dir, 'pull', '--target', 'sandbox')
  const json = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect([human.exitCode, json.exitCode]).toEqual([3, 3])
  const { issues } = parseEnvelope(json.stdout)
  expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['E_PULL_INVALID', 'E_DUPLICATE_OPTION']))
  const shown = [human.stdout, human.stderr, ...issues.map((i) => `${i.message} ${i.fix} ${i.configPath}`)]
  for (const char of ['\u001b', '\u0007', '\u009b']) {
    expect(shown.join('\n')).not.toContain(char)
  }
  const start = "option value 'x]0;ownedRED"
  expect(issues.find((i) => i.code === 'E_DUPLICATE_OPTION')?.message).toBe(
    `${start}${'A'.repeat(499 - start.length)}…`,
  )
})

test('a re-pull keeps the defaults a file states: their fields stay owned and the file byte-identical', async () => {
  portal()
  const dir = copy('pulled')
  const file = 'hubspot/objects/companies.ts'
  const stated = text(dir, file)
    .replace(
      "fieldType: 'number',\n    }),\n    pruned",
      "fieldType: 'number',\n      description: '',\n      hasUniqueValue: false,\n      formField: false,\n    }),\n    pruned",
    )
    .replace("{ value: 'low', label: 'Low' },", "{ value: 'low', label: 'Low', hidden: false, description: '' },")
  expect(stated).toContain("description: '',\n      hasUniqueValue: false,\n      formField: false,")
  writeFileSync(join(dir, file), stated)
  const owned = load(dir).ir.resources['property:companies/plot_total']
  expect(owned).toMatchObject({ definition: { description: '', hasUniqueValue: false, formField: false } })

  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.data?.files).toEqual([])
  const changes = env.data?.objects.companies?.changes ?? []
  expect(changes.filter((c) => c.address === 'property:companies/plot_total')).toEqual([])
  expect(changes.filter((c) => c.address === 'property:companies/yield_tier' && c.kind === 'changed')).toEqual([])
  expect(text(dir, file)).toBe(stated)
  expect(load(dir).ir.resources['property:companies/plot_total']).toEqual(owned)

  // The portal's value replaces a stated default, and a stated field the portal empties keeps its place.
  portal(
    withProperties(orchard(), routes.companies, (p) =>
      p.name === 'plot_total' ? { ...p, description: 'Plots on the estate', formField: true } : p,
    ),
  )
  await cli(dir, 'pull', '--target', 'sandbox')
  expect(text(dir, file)).toContain(
    "description: 'Plots on the estate',\n      hasUniqueValue: false,\n      formField: true,",
  )
  portal()
  await cli(dir, 'pull', '--target', 'sandbox')
  expect(text(dir, file)).toBe(stated)
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
  const harvest = text(dir, 'hubspot/objects/harvest.ts')
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
  rmSync(join(dir, 'hubspot/objects/harvest.ts'))
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--only', 'property:companies/yield_*', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<PullData>(out.stdout).data?.files).toEqual(['hubspot/index.ts', 'hubspot/objects/companies.ts'])
  expect(existsSync(join(dir, 'hubspot/objects/harvest.ts'))).toBe(false)
  expect(validateProject(load(dir)).issues).toEqual([])
})

test('--only object:<name> refreshes the schema fields alone; --only group:* refreshes the groups alone', async () => {
  portal()
  const dir = copy('pull')
  const before = snapshot(dir)
  const object = await cli(dir, 'pull', '--target', 'sandbox', '--only', 'object:harvest', '--json')
  expect(object.exitCode).toBe(0)
  const objectEnv = parseEnvelope<PullData>(object.stdout)
  expect(objectEnv.data?.files).toEqual(['hubspot/objects/harvest.ts'])
  expect(objectEnv.data?.objects.harvest).toMatchObject({ added: 0, changed: 1, unchanged: 0, missing: 0 })
  expect(objectEnv.data?.objects.companies).toMatchObject({ added: 0, changed: 0, unchanged: 0, missing: 0 })
  const harvest = text(dir, 'hubspot/objects/harvest.ts')
  expect(harvest).toContain("searchableProperties: ['batch_code', 'orchard_ref'],")
  expect(harvest).toContain("secondaryDisplayProperties: ['picked_on'],")
  expect(harvest).not.toContain('weight_kg')
  expect(text(dir, 'hubspot/objects/companies.ts')).toBe(before['hubspot/objects/companies.ts'])
  expect(validateProject(load(dir)).issues).toEqual([])

  portal()
  const groups = copy('pull')
  const group = await cli(groups, 'pull', '--target', 'sandbox', '--only', 'group:*', '--json')
  expect(group.exitCode).toBe(0)
  const groupEnv = parseEnvelope<PullData>(group.stdout)
  expect(groupEnv.data?.files).toEqual(['hubspot/objects/companies.ts'])
  expect(groupEnv.data?.objects.companies).toMatchObject({ added: 0, changed: 1, unchanged: 0, missing: 1 })
  expect(groupEnv.data?.objects.harvest).toMatchObject({ added: 0, changed: 0, unchanged: 1, missing: 0 })
  const companies = text(groups, 'hubspot/objects/companies.ts')
  expect(companies).toContain("orchard: { label: 'Orchard details' }")
  expect(companies).toContain("label: 'Yield tier'")
  expect(companies).not.toContain('irrigation_notes')
  expect(text(groups, 'hubspot/objects/harvest.ts')).toBe(before['hubspot/objects/harvest.ts'])
})

test('custom off: the files keep their own properties in scope and get no new ones; include may name a file property', async () => {
  portal()
  const dir = copy('pull')
  // harvest_window is in companies.ts and not in the portal: no E_UNKNOWN_INCLUDE, it is missing in the portal.
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace(
      "include: ['name', 'lifecyclestage'] }",
      "include: ['name', 'harvest_window'], custom: false }",
    ),
  )
  const out = await cli(dir, 'pull', '--target', 'sandbox')
  expect(out.exitCode).toBe(0)
  expect(printed(out)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111
    companies: 0 added, 4 changed, 3 unchanged, 2 missing in portal
      missing in portal: property:companies/harvest_window
      added: property:companies/lifecyclestage#options[subscriber]
      changed: property:companies/row_meta#description none -> "Row layout as JSON"
      changed: property:companies/yield_tier#label "Yield tier" -> "Yield band"
      changed: property:companies/yield_tier#description none -> "Set by the yield sync"
      added: property:companies/yield_tier#options[peak]
      only in config: property:companies/yield_tier#options[trial]
      missing in portal: group:companies/legacy
      changed: group:companies/orchard#label "Orchard" -> "Orchard details"
    harvest: 2 added, 2 changed, 2 unchanged, 0 missing in portal
      changed: object:harvest#searchableProperties none -> ["batch_code","orchard_ref"]
      changed: object:harvest#secondaryDisplayProperties none -> ["picked_on"]
      changed: property:harvest/batch_code#hasUniqueValue none -> true
      added: property:harvest/orchard_ref
      added: property:harvest/weight_kg
    wrote hubspot/objects/companies.ts
    wrote hubspot/objects/harvest.ts
    Recorded the agreed values of 11 resources in state
    State for portal 1111111 is new: .kalup/state/portal-1111111.json
    "
  `)
  const companies = text(dir, 'hubspot/objects/companies.ts')
  expect(companies).toContain("label: 'Yield band'")
  expect(companies).toContain("{ value: 'customer', label: 'Customer', as: 'paying' }")
  expect(companies).toContain("harvestWindow: p.string('harvest_window'")
  expect(companies).not.toContain('irrigation_notes')
  // plan creates what the files define and the portal lacks, custom off or not.
  portal()
  const plan = parseEnvelope<Plan>((await cli(dir, 'plan', '--target', 'sandbox', '--json')).stdout).data
  expect(plan?.steps.find((step) => step.address === 'property:companies/harvest_window')?.action).toBe('create')
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
  expect(text(dir, 'hubspot/objects/companies.ts')).toBe(text(project('pulled'), 'hubspot/objects/companies.ts'))
})

test('a 403 on the schemas list is an incomplete read: the custom object is skipped, the standard one is written', async () => {
  const bodies = orchard()
  bodies[routes.schemas] = jsonResponse(403, fixture('errors/missing-scope.json'))
  portal(bodies)
  const dir = copy('pull')
  const before = snapshot(dir)
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope<PullData>(out.stdout)
  expect(env.issues.map((issue) => issue.code)).toEqual([
    'E_SCOPE',
    'W_UNSUPPORTED_TYPE',
    'W_KEY_COLLISION',
    'E_INCOMPLETE',
  ])
  expect(env.issues.at(-1)).toMatchObject({
    message: expect.stringContaining('the custom object schemas list'),
    fix: expect.stringMatching(scopeThenPull),
  })
  expect(env.data?.files).toEqual(['hubspot/objects/companies.ts'])
  expect(Object.keys(env.data?.objects ?? {})).toEqual(['companies'])
  expect(text(dir, 'hubspot/objects/harvest.ts')).toBe(before['hubspot/objects/harvest.ts'])
})

test('--discover on an incomplete read exits 1 and does not claim the scope holds everything', async () => {
  portal({ ...orchard(), [routes.schemas]: jsonResponse(403, fixture('errors/missing-scope.json')) })
  const dir = copy('pull')
  // Every companies property is in scope, and the schemas list that would name other custom objects is refused.
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace("'lifecyclestage'", "'lifecyclestage', 'domain', 'hs_lastmodifieddate'"),
  )
  const out = await cli(dir, 'pull', '--target', 'sandbox', '--discover')
  expect(out.exitCode).toBe(1)
  expect(out.stdout).not.toContain('Everything the portal holds')
  expect(printed(out)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111
    Nothing outside the pull scope of target sandbox in the lists the key could read.
    Nothing written.
    --- stderr
    E_SCOPE: HubSpot refused GET /crm-object-schemas/2026-09/schemas (403). The key likely lacks the scope crm.schemas.custom.read. HubSpot said: This app hasn't been granted all required scopes (fix: Add the scope crm.schemas.custom.read to the key.) (docs: errors/E_SCOPE.md)
    W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which Kalup does not write; read as a p.string reference (docs: errors/W_UNSUPPORTED_TYPE.md)
    E_INCOMPLETE: pull did not read everything in scope: the custom object schemas list, so no custom object. Nothing there was compared or written. (fix: add the scope crm.schemas.custom.read to the key, then run npx kalup pull --target sandbox) (docs: errors/E_INCOMPLETE.md)
    "
  `)
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
  const file = text(dir, 'hubspot/objects/companies.ts')
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
  expect(text(dir, 'hubspot/objects/companies.ts')).toContain(`{ value: "grower's", label: "Grower's pick" },`)
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
  fieldType: definition?.fieldType ?? FIELD_TYPES[kind][0] ?? '',
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
    unsupported?: LiveObject['unsupported']
    excluded?: string[]
    /** Names whose value HubSpot marks read-only. */
    readOnly?: string[]
  } = {},
) {
  const live: LiveObject = {
    object: 'companies',
    groups: new Map(Object.entries(options.groups ?? { orchard: 'Orchard' })),
    meta: new Map(
      (options.readOnly ?? []).map((name) => [
        name,
        { sensitivity: 'non_sensitive', modificationMetadata: { readOnlyValue: true } },
      ]),
    ),
    members: new Map(),
    properties,
    unsupported: options.unsupported ?? [],
    custom: options.custom,
  }
  return mergeObject({
    live,
    scope: scopeOf(options.scope ?? {}),
    local: existing,
    fresh: { name: 'Company', builder: options.custom ? 'defineCustomObject' : 'defineObject' },
    only: addressMatcher(options.only),
    excluded: new Set(options.excluded),
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
  // The file states description and hasUniqueValue, so they stay, with the default for the value the portal omits.
  expect(out.export.properties[0]?.definition).toEqual({ ...theirs, description: '', hasUniqueValue: false })
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
      message: expect.stringContaining('property:companies/row_meta'),
      fix: expect.any(String),
    },
  ])
})

test('merge: a portal fieldType of another builder is a codec mismatch; one no builder takes says nothing', () => {
  const tier = prop('tier', 'enum', 'yield_tier', { ...full, fieldType: 'select' })
  const tags = prop('tags', 'multiEnum', 'plot_tags', { ...full, fieldType: 'checkbox' })
  const score = prop('score', 'number', 'soil_ph')
  const out = merge(local([tier, tags, score]), [
    lp('yield_tier', 'multiEnum', { ...full, fieldType: 'checkbox' }),
    lp('plot_tags', 'enum', { ...full, fieldType: 'radio' }),
    // A calculated property's fieldType no builder takes: the reference still merges.
    lp('soil_ph', 'number', undefined, { calculated: true, reference: true, fieldType: 'calculation_equation' }),
  ])
  expect(out.export.properties).toEqual([tier, tags, score])
  expect(out.changes).toEqual([])
  expect(out.issues).toEqual([
    {
      code: 'W_CODEC_MISMATCH',
      message: expect.stringContaining('property:companies/yield_tier'),
      fix: expect.stringContaining('p.multiEnum'),
    },
    {
      code: 'W_CODEC_MISMATCH',
      message: expect.stringContaining('property:companies/plot_tags'),
      fix: expect.stringContaining('p.enum'),
    },
  ])
})

test('merge: a field or option attribute the file states stays, with the portal value or else the default', () => {
  const mine: Definition = {
    ...full,
    fieldType: 'select',
    description: '',
    options: [
      { value: 'a', label: 'A', hidden: false, description: '' },
      { value: 'b', label: 'B', as: 'bee', hidden: false },
    ],
    hasUniqueValue: false,
    formField: false,
  }
  const theirs: Definition = {
    ...full,
    fieldType: 'select',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', hidden: true, description: 'Second' },
    ],
    formField: true,
  }
  const none: Definition = { ...full, fieldType: 'select', options: [] }
  const out = merge(local([prop('tier', 'enum', 'plot_count', mine), prop('band', 'enum', 'plot_band', none)]), [
    lp('plot_count', 'enum', theirs),
    lp('plot_band', 'enum', { ...full, fieldType: 'select' }),
  ])
  expect(out.export.properties[0]?.definition).toEqual({
    ...full,
    fieldType: 'select',
    description: '',
    options: [
      { value: 'a', label: 'A', hidden: false, description: '' },
      { value: 'b', label: 'B', as: 'bee', hidden: true, description: 'Second' },
    ],
    hasUniqueValue: false,
    formField: true,
  })
  expect(out.export.properties[1]?.definition).toEqual(none)
  // A stated default equals the portal leaving the field out: only real differences are changes, each with the value
  // the file states and the one pull writes.
  expect(out.changes.map((c) => [c.field, c.before, c.after])).toEqual([
    ['formField', false, true],
    ['options[b].hidden', false, true],
    ['options[b].description', undefined, 'Second'],
  ])
  // The next pull from the same portal changes nothing.
  const again = merge(out.export, [
    lp('plot_count', 'enum', theirs),
    lp('plot_band', 'enum', { ...full, fieldType: 'select' }),
  ])
  expect(again.export).toEqual(out.export)
  expect(again.changes).toEqual([])
})

test('merge: a stated field the portal set back to its default is reported as the default pull writes', () => {
  const mine: Definition = {
    ...full,
    numberDisplayHint: 'percentage',
    options: [{ value: 'a', label: 'A', hidden: true }],
  }
  const theirs: Definition = { ...full, options: [{ value: 'a', label: 'A' }] }
  const out = merge(local([prop('discountRate', 'number', 'discount_rate', mine)]), [
    lp('discount_rate', 'number', theirs),
  ])
  expect(out.export.properties[0]?.definition).toMatchObject({
    numberDisplayHint: 'formatted',
    options: [{ value: 'a', label: 'A', hidden: false }],
  })
  expect(out.changes.map((c) => [c.field, c.before, c.after])).toEqual([
    ['numberDisplayHint', 'percentage', 'formatted'],
    ['options[a].hidden', true, false],
  ])
})

test('merge: a property Kalup does not write is a p.string reference; a file reference keeps its builder', () => {
  const at = { group: 'orchard', fieldType: 'text', hubspotDefined: false }
  const unsupported: LiveObject['unsupported'] = [
    { name: 'plot_shape', label: 'Plot shape', type: 'object_coordinates', ...at },
    { name: 'grove_manager', label: 'Grove manager', type: 'enumeration', ...at, referencedObjectType: 'OWNER' },
    { name: 'grove_notes', label: 'Grove notes', type: 'string', ...at, fieldType: 'html' },
    { name: 'grower_phone', label: 'Grower phone', type: 'phone_number', ...at, fieldType: 'phonenumber' },
    { name: 'domain', label: 'Domain', type: 'object_coordinates', ...at, hubspotDefined: true },
  ]
  const manager = prop(
    'groveManager',
    'enum',
    'grove_manager',
    { ...full, fieldType: 'select' },
    { chain: { strict: true, required: true, readonly: false, managed: true }, comments: ['Kept.'] },
  )
  const shape = prop('plotShape', 'stringArray', 'plot_shape')
  const domain = prop('domain', 'string', 'domain')
  const options = { unsupported, scope: { include: [] }, readOnly: ['grove_notes', 'plot_shape'] }
  const out = merge(local([manager, shape, domain]), [], options)
  expect(out.export.properties).toEqual([
    // A managed entry becomes a p.string reference: plan cannot manage it. .strict() goes with p.enum.
    {
      key: 'groveManager',
      kind: 'string',
      name: 'grove_manager',
      chain: { required: true, readonly: false, managed: true },
      comments: ['Kept.'],
    },
    // A reference keeps its builder, and gains .readonly() where HubSpot marks the value read-only.
    { ...shape, chain: { ...shape.chain, readonly: true } },
    domain,
    // New ones are written in name order, as references.
    prop('groveNotes', 'string', 'grove_notes', undefined, {
      chain: { required: false, readonly: true, managed: true },
    }),
    prop('growerPhone', 'string', 'grower_phone'),
  ])
  const grove = 'property:companies/grove_manager'
  expect(out.changes).toEqual([
    { kind: 'changed', address: grove, field: 'definition', before: 'managed', after: 'reference' },
    { kind: 'changed', address: grove, field: 'builder', before: 'p.enum', after: 'p.string' },
    { kind: 'changed', address: 'property:companies/plot_shape', field: 'readonly', before: false, after: true },
    { kind: 'added', address: 'property:companies/grove_notes' },
    { kind: 'added', address: 'property:companies/grower_phone' },
  ])
  expect(out.counts).toEqual({ added: 2, changed: 2, unchanged: 2, missing: 0 })
  // The next pull from the same portal changes nothing.
  const again = merge(out.export, [], options)
  expect(again.export).toEqual(out.export)
  expect(again.counts).toMatchObject({ added: 0, changed: 0 })
})

test('merge: .readonly() is added where HubSpot marks the value read-only, never taken away; .strict() stays', () => {
  const select = { ...full, fieldType: 'select', options: [{ value: 'a', label: 'A' }] }
  const tier = prop('tier', 'enum', 'tier', select, {
    chain: { strict: true, required: false, readonly: false, managed: true },
  })
  const code = prop('code', 'string', 'code', undefined, { chain: { required: false, readonly: true, managed: true } })
  const out = merge(
    local([tier, code]),
    [
      lp('tier', 'enum', select),
      lp('code', 'string', undefined, { hubspotDefined: true, reference: true }),
      lp('hs_object_id', 'number', undefined, { hubspotDefined: true, reference: true }),
    ],
    { scope: { include: ['code', 'hs_object_id'] }, readOnly: ['tier', 'hs_object_id'] },
  )
  const [merged, kept, added] = out.export.properties
  expect(merged?.chain).toEqual({ strict: true, required: false, readonly: true, managed: true })
  expect(kept).toMatchObject({ chain: { readonly: true } })
  expect(added).toMatchObject({ name: 'hs_object_id', chain: { readonly: true } })
  expect(out.changes.filter((c) => c.field === 'readonly').map((c) => c.address)).toEqual(['property:companies/tier'])
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
    { value: 'b', label: 'Bee', description: '' },
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

test('merge: a file property is in scope whatever the settings say, an in-scope portal property is added', () => {
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
  expect(out.changes).toEqual([{ kind: 'added', address: 'property:companies/plot_size' }])
  expect(out.counts).toEqual({ added: 1, changed: 0, unchanged: 3, missing: 0 })
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
      message: expect.stringContaining('property:companies/plot_count'),
      fix: expect.any(String),
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

test('merge: an excluded property or group is kept as written and noted, whatever the portal holds', () => {
  const mine = prop('plotCount', 'number', 'plot_count', full)
  const out = merge(local([mine]), [lp('plot_count', 'number', { ...full, label: 'Plots' })], {
    groups: { orchard: 'Orchard details' },
    excluded: ['property:companies/plot_count', 'group:companies/orchard'],
  })
  expect(out.export.properties).toEqual([mine])
  expect(out.export.groups).toEqual([{ name: 'orchard', label: 'Orchard', comments: [] }])
  expect(out.changes).toEqual([
    { kind: 'excluded', address: 'property:companies/plot_count' },
    { kind: 'excluded', address: 'group:companies/orchard' },
  ])
  expect(out.counts).toEqual({ added: 0, changed: 0, unchanged: 0, missing: 0 })
})

test('merge: a reference writes value and label alone, however much of each option the portal returns', () => {
  const stage = lp(
    'stage',
    'enum',
    { options: [{ value: 'a', label: 'A', hidden: true, description: 'First' }] },
    { hubspotDefined: true, reference: true },
  )
  const kept = merge(local([prop('stage', 'enum', 'stage', { options: [{ value: 'a', label: 'A' }] })]), [stage], {
    scope: { include: ['stage'] },
  })
  expect(kept.export.properties[0]?.definition).toEqual({ options: [{ value: 'a', label: 'A' }] })
  expect(kept.changes).toEqual([])
  const added = merge(local([]), [stage], { scope: { include: ['stage'] } })
  expect(added.export.properties[0]?.definition).toEqual({ options: [{ value: 'a', label: 'A' }] })
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
