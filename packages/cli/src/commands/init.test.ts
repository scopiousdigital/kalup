import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import { validate as validateProject } from '@kalup/core'
import { afterEach, expect, test, vi } from 'vitest'
import { envelope, type Fetch, type Issue, KalupError, load, printEnvelope } from '../lib/index.js'
import { STANDARD_OBJECTS } from '../lib/pull/index.js'
import { agentsBlock } from '../lib/templates/agents.js'
import { fakeFetch, fixture, jsonResponse } from '../lib/testing.js'
import { built } from '../usage.js'
import { parseArgs } from './args.js'
import { type InitData, init, readScope } from './init.js'
import type { PullData } from './pull.js'
import { cli, copy, empty, parseEnvelope, project } from './testing.js'

const key = 'kalup-test-secret-9f2c'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const rate = {
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}

const routes = {
  account: '/account-info/2026-09/details',
  schemas: '/crm-object-schemas/2026-09/schemas',
  contacts: '/crm/properties/2026-09/contacts',
  contactGroups: '/crm/properties/2026-09/contacts/groups',
  companies: '/crm/properties/2026-09/companies',
  companyGroups: '/crm/properties/2026-09/companies/groups',
  deals: '/crm/properties/2026-09/deals',
  dealGroups: '/crm/properties/2026-09/deals/groups',
  harvest: '/crm/properties/2026-09/2-4242001',
  harvestGroups: '/crm/properties/2026-09/2-4242001/groups',
}

/** A path answers with a body, one Response, or a queue of Responses handed out in order. */
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

/** Stubs fetch with a portal and sets the key. Every call goes through fakeFetch, so a write path throws. */
function portal(bodies: Bodies = orchard()): { calls: string[] } {
  const calls: string[] = []
  const fetch: Fetch = (url, init) => {
    const { pathname } = new URL(url)
    calls.push(`${init.method ?? 'GET'} ${pathname}`)
    const body = bodies[pathname]
    const next = Array.isArray(body) ? (body.shift() as Response | undefined) : body
    const response =
      next instanceof Response
        ? next
        : next === undefined
          ? jsonResponse(404, { message: 'Not found' })
          : jsonResponse(200, next, rate)
    return fakeFetch(response).fetch(url, init)
  }
  vi.stubGlobal('fetch', fetch)
  vi.stubEnv('HUBSPOT_SERVICE_KEY', key)
  return { calls }
}

function account(accountType: string): Bodies {
  return { ...orchard(), [routes.account]: { ...fixture('account-info.json'), accountType } }
}

interface Outcome {
  exitCode: number
  data?: InitData
  issues: Issue[]
  text: string
  error?: KalupError
}

// init through the parser and the command, as run() calls them. The runner's envelope and printing are its own tests'.
async function run(dir: string, ...argv: string[]): Promise<Outcome> {
  try {
    const { flags } = parseArgs(['init', ...argv])
    const result = await init({ cwd: dir, flags })
    return { exitCode: result.exitCode ?? 0, data: result.data, issues: result.issues ?? [], text: result.text ?? '' }
  } catch (error) {
    if (!(error instanceof KalupError)) throw error
    return { exitCode: error.exitCode, issues: error.issues, text: '', error }
  }
}

function text(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

function listing(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort()
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

// The read scopes on HubSpot's 2026-09 properties reference (crm/properties/get-properties), the sensitive-data
// variants left out. communications and postal_mail are not on it; their API guides name crm.objects.contacts.read.
const hubspotReadScopes = new Set([
  'automation',
  'e-commerce',
  'media_bridge.read',
  'tickets',
  'timeline',
  'crm.pipelines.orders.read',
  ...[
    'appointments',
    'calls',
    'carts',
    'companies',
    'contacts',
    'courses',
    'custom',
    'deals',
    'emails',
    'feedback_submissions',
    'goals',
    'invoices',
    'leads',
    'line_items',
    'listings',
    'marketing_events',
    'meetings',
    'notes',
    'orders',
    'owners',
    'projects',
    'quotes',
    'services',
    'subscriptions',
    'tasks',
    'users',
  ].map((o) => `crm.objects.${o}.read`),
  ...[
    'appointments',
    'calls',
    'carts',
    'commercepayments',
    'companies',
    'contacts',
    'courses',
    'custom',
    'deals',
    'emails',
    'invoices',
    'line_items',
    'listings',
    'meetings',
    'notes',
    'orders',
    'projects',
    'quotes',
    'services',
    'subscriptions',
    'tasks',
    'tickets',
  ].map((o) => `crm.schemas.${o}.read`),
])

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('init is a built command', () => {
  expect(built).toContain('init')
})

test('the golden init: every written file equals the inited fixture, only read paths are hit, every file is listed', async () => {
  const { calls } = portal()
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies,harvest')
  expect(out.exitCode).toBe(0)
  const golden = project('inited')
  const files = listing(golden)
  expect(files).toEqual([
    '.gitignore',
    'AGENTS.md',
    'kalup.config.ts',
    'kalup/index.ts',
    'kalup/objects/companies.ts',
    'kalup/objects/harvest.ts',
  ])
  expect(listing(dir)).toEqual(files)
  for (const file of files) expect(text(dir, file), file).toBe(text(golden, file))
  expect(text(dir, 'AGENTS.md')).toBe(agentsBlock)
  // init checks the portal before it writes, then the pull checks it again and reads the scope once.
  expect(calls).toEqual([
    'GET /account-info/2026-09/details',
    'GET /account-info/2026-09/details',
    'GET /crm-object-schemas/2026-09/schemas',
    'GET /crm/properties/2026-09/companies',
    'GET /crm/properties/2026-09/companies/groups',
    'GET /crm/properties/2026-09/2-4242001',
    'GET /crm/properties/2026-09/2-4242001/groups',
  ])
  expect(out.data).toMatchObject({
    target: 'sandbox',
    portalId: 1111111,
    account: {
      portalId: 1111111,
      accountType: 'SANDBOX',
      uiDomain: 'app-eu1.hubspot.com',
      timeZone: 'Europe/Ljubljana',
    },
    objects: ['companies', 'harvest'],
    scopes: [
      { scope: 'crm.schemas.companies.read', neededFor: ['companies'] },
      { scope: 'crm.schemas.custom.read', neededFor: ['harvest'] },
    ],
    files: ['kalup.config.ts', '.gitignore', 'AGENTS.md'],
  })
  expect(out.data?.pull?.files).toEqual(['kalup/index.ts', 'kalup/objects/companies.ts', 'kalup/objects/harvest.ts'])
  expect(out.issues.map((issue) => issue.code)).toEqual(['W_UNSUPPORTED_TYPE'])
  expect(out.text).toContain('Portal 1111111: SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana\n')
  expect(out.text).toContain('Target sandbox: companies, harvest\n')
  expect(out.text).toContain(
    'Read scopes the key in HUBSPOT_SERVICE_KEY needs (Development > Keys > Service keys, see https://',
  )
  expect(out.text).toContain('  crm.schemas.companies.read (companies)\n  crm.schemas.custom.read (harvest)\n')
  for (const file of files) expect(out.text).toContain(`wrote ${file}\n`)
  // No formatter in an empty directory: no stray ignore file, one note.
  expect(out.text).toContain('No biome.json or prettier config found.')
  expect(out.text).toContain('companies: 10 added, 0 changed, 0 unchanged, 0 missing in portal\n')
  // Nothing existed before, so no history was written, and no CLAUDE.md is created from nothing.
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
  expect(biome(dir)).toBe('')
  expect(validateProject(load(dir)).issues).toEqual([])
})

test('the golden fixture passes biome and validates', () => {
  expect(biome(project('inited'))).toBe('')
  expect(validateProject(load(project('inited'))).issues).toEqual([])
})

test('init runs through run(): the binary reaches it and --json prints one envelope', async () => {
  portal()
  const dir = empty()
  const out = await cli(dir, 'init', '--portal', '1111111', '--objects', 'companies,harvest', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<InitData>(out.stdout)
  expect(env.ok).toBe(true)
  expect(env.data?.target).toBe('sandbox')
  expect(out.stderr).toBe('')
})

test('a pull right after init is byte-identical and writes no history', async () => {
  portal()
  const dir = empty()
  expect((await run(dir, '--portal', '1111111', '--objects', 'companies,harvest')).exitCode).toBe(0)
  const before = Object.fromEntries(listing(dir).map((file) => [file, text(dir, file)]))
  const again = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(again.exitCode).toBe(0)
  expect(parseEnvelope<PullData>(again.stdout).data?.files).toEqual([])
  expect(listing(dir)).toEqual(Object.keys(before))
  for (const [file, content] of Object.entries(before)) expect(text(dir, file), file).toBe(content)
})

test('existing files: AGENTS.md and CLAUDE.md are appended, biome.json gets the ignore, .gitignore keeps its lines', async () => {
  portal()
  const dir = copy('init-existing')
  // Written here, not in the fixture: biome reads a second biome.json in the repo as a nested root and stops.
  writeFileSync(
    join(dir, 'biome.json'),
    `${JSON.stringify(
      {
        $schema: 'https://biomejs.dev/schemas/2.5.4/schema.json',
        files: { includes: ['**', '!**/node_modules'] },
        formatter: { indentStyle: 'space' },
      },
      null,
      2,
    )}\n`,
  )
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies,harvest')
  expect(out.exitCode).toBe(0)
  expect(out.data?.files).toEqual(['kalup.config.ts', '.gitignore', 'biome.json', 'AGENTS.md', 'CLAUDE.md'])
  expect(text(dir, '.gitignore')).toBe('node_modules/\ndist/\n.kalup/\n')
  expect(JSON.parse(text(dir, 'biome.json'))).toEqual({
    $schema: 'https://biomejs.dev/schemas/2.5.4/schema.json',
    files: { includes: ['**', '!**/node_modules', '!kalup/**'] },
    formatter: { indentStyle: 'space' },
  })
  expect(text(dir, 'biome.json').endsWith('\n')).toBe(true)
  expect(text(dir, 'AGENTS.md')).toBe(`# Agents\n\nRun the tests before you push.\n\n${agentsBlock}`)
  expect(text(dir, 'CLAUDE.md')).toBe('# Orchard CRM\n\nSee AGENTS.md for the house rules.\n@AGENTS.md\n')
  expect(existsSync(join(dir, '.prettierignore'))).toBe(false)

  // Run again from scratch in the same directory: everything is present already, so only the config is written.
  const before = Object.fromEntries(
    ['.gitignore', 'biome.json', 'AGENTS.md', 'CLAUDE.md'].map((f) => [f, text(dir, f)]),
  )
  rmSync(join(dir, 'kalup.config.ts'))
  rmSync(join(dir, 'kalup'), { recursive: true })
  portal()
  const again = await run(dir, '--portal', '1111111', '--objects', 'companies,harvest')
  expect(again.exitCode).toBe(0)
  expect(again.data?.files).toEqual(['kalup.config.ts'])
  for (const [file, content] of Object.entries(before)) expect(text(dir, file), file).toBe(content)
})

test('a .gitignore with /.kalup/ and a .prettierignore with kalup/** already cover the paths, so nothing is appended', async () => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, '.gitignore'), '/.kalup/\n')
  writeFileSync(join(dir, '.prettierignore'), 'kalup/**\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toEqual(['kalup.config.ts', 'AGENTS.md'])
  expect(text(dir, '.gitignore')).toBe('/.kalup/\n')
  expect(text(dir, '.prettierignore')).toBe('kalup/**\n')
})

test('a biome.json with no files.includes gets ** and the ignore', async () => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), '{"formatter":{"enabled":true}}')
  await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(JSON.parse(text(dir, 'biome.json'))).toEqual({
    formatter: { enabled: true },
    files: { includes: ['**', '!kalup/**'] },
  })
})

test('a biome.json that does not parse stops init before any request or write, and runs once fixed', async () => {
  const { calls } = portal()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), '{"files": {"includes": ["**"],}}')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(1)
  expect(out.issues[0]).toMatchObject({ code: 'E_BIOME_CONFIG', file: 'biome.json' })
  expect(calls).toEqual([])
  expect(listing(dir)).toEqual(['biome.json'])
  writeFileSync(join(dir, 'biome.json'), '{"files": {"includes": ["**"]}}')
  const again = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(again.exitCode).toBe(0)
  expect(again.data?.files).toContain('biome.json')
})

test('without biome.json, .prettierignore gets kalup/ only when a prettier config exists, else a note is printed', async () => {
  const configs: [string, string][] = [
    ['.prettierrc', '{}\n'],
    ['.prettierrc.json', '{}\n'],
    ['prettier.config.mjs', 'export default {}\n'],
    ['package.json', '{"name":"orchard","prettier":{}}\n'],
  ]
  for (const [file, content] of configs) {
    portal()
    const dir = empty()
    writeFileSync(join(dir, file), content)
    const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
    expect(out.data?.files, file).toContain('.prettierignore')
    expect(text(dir, '.prettierignore'), file).toBe('kalup/\n')
    expect(out.text, file).not.toContain('No biome.json or prettier config found.')
  }

  // An existing .prettierignore is the config, and is appended to.
  portal()
  const existing = empty()
  writeFileSync(join(existing, '.prettierignore'), 'dist')
  const out = await run(existing, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toContain('.prettierignore')
  expect(text(existing, '.prettierignore')).toBe('dist\nkalup/\n')

  // A package.json without the key is not one: no stray file, the note.
  portal()
  const bare = empty()
  writeFileSync(join(bare, 'package.json'), '{"name":"orchard"}\n')
  const none = await run(bare, '--portal', '1111111', '--objects', 'companies')
  expect(none.exitCode).toBe(0)
  expect(existsSync(join(bare, '.prettierignore'))).toBe(false)
  expect(none.text).toContain('No biome.json or prettier config found.')
})

test('init refuses when kalup.config.ts exists and sends nothing', async () => {
  const { calls } = portal()
  const dir = copy('valid')
  const before = listing(dir)
  const out = await run(dir, '--portal', '1111111')
  expect(out.exitCode).toBe(1)
  expect(out.issues[0]).toMatchObject({ code: 'E_CONFIG_EXISTS', file: 'kalup.config.ts' })
  expect(calls).toEqual([])
  expect(listing(dir)).toEqual(before)
})

test('the target is named by the account type, a STANDARD portal is protected, and --target wins', async () => {
  const cases: [string, string[], string][] = [
    ['SANDBOX', [], 'sandbox'],
    ['DEVELOPER_TEST', [], 'sandbox'],
    ['STANDARD', [], 'production'],
    ['STANDARD', ['--target', 'staging'], 'staging'],
  ]
  for (const [type, extra, name] of cases) {
    portal(account(type))
    const dir = empty()
    const out = await run(dir, '--portal', '1111111', '--objects', 'companies', ...extra)
    expect(out.exitCode, type).toBe(0)
    expect(out.data?.target, type).toBe(name)
    const config = text(dir, 'kalup.config.ts')
    expect(config, type).toContain(`  targets: {\n    ${name}: {\n      portalId: 1111111,\n`)
    expect(config.includes('protected: true,'), type).toBe(type === 'STANDARD')
    expect(out.text.includes(`Target ${name} (protected)`), type).toBe(type === 'STANDARD')
  }
})

test('the default objects are contacts, companies and deals, each with its own read scope', async () => {
  const bodies = orchard()
  for (const route of [routes.contacts, routes.deals]) bodies[route] = fixture('api/orchard/companies.properties.json')
  for (const route of [routes.contactGroups, routes.dealGroups])
    bodies[route] = fixture('api/orchard/companies.groups.json')
  const { calls } = portal(bodies)
  const dir = empty()
  const out = await run(dir, '--portal', '1111111')
  expect(out.exitCode).toBe(0)
  expect(out.data?.objects).toEqual(['contacts', 'companies', 'deals'])
  expect(out.data?.scopes.map((s) => s.scope)).toEqual([
    'crm.schemas.contacts.read',
    'crm.schemas.companies.read',
    'crm.schemas.deals.read',
  ])
  expect(calls).not.toContain('GET /crm-object-schemas/2026-09/schemas')
  expect(text(dir, 'kalup.config.ts')).toContain(
    '  objects: {\n    contacts: {},\n    companies: {},\n    deals: {},\n  },\n',
  )
  expect(listing(join(dir, 'kalup/objects'))).toEqual(['companies.ts', 'contacts.ts', 'deals.ts'])
})

test('the scope printed for products is one HubSpot lists: e-commerce, not crm.schemas.products.read', async () => {
  const bodies = orchard()
  bodies['/crm/properties/2026-09/products'] = fixture('api/orchard/companies.properties.json')
  bodies['/crm/properties/2026-09/products/groups'] = fixture('api/orchard/companies.groups.json')
  portal(bodies)
  const out = await run(empty(), '--portal', '1111111', '--objects', 'products')
  expect(out.exitCode).toBe(0)
  expect(out.data?.scopes.map((s) => s.scope)).toEqual(['e-commerce'])
  expect(out.text).toContain('  e-commerce (products)\n')
})

test('every standard object prints a read scope on HubSpot list, the crm.schemas one wherever it exists', () => {
  const exceptions: Record<string, string> = {}
  for (const object of STANDARD_OBJECTS) {
    const scope = readScope(object)
    expect(hubspotReadScopes.has(scope), `${object}: ${scope}`).toBe(true)
    const schemas = `crm.schemas.${object}.read`
    if (hubspotReadScopes.has(schemas)) expect(scope, object).toBe(schemas)
    else exceptions[object] = scope
  }
  expect(exceptions).toEqual({
    commerce_payments: 'crm.schemas.commercepayments.read',
    communications: 'crm.objects.contacts.read',
    feedback_submissions: 'crm.objects.feedback_submissions.read',
    goals: 'crm.objects.goals.read',
    leads: 'crm.objects.leads.read',
    marketing_events: 'crm.objects.marketing_events.read',
    postal_mail: 'crm.objects.contacts.read',
    products: 'e-commerce',
    users: 'crm.objects.users.read',
  })
})

test('more than 200 properties written for one object is a warning that points at include, not a stop', async () => {
  const results = Array.from({ length: 201 }, (_, i) => ({
    name: `field_${i}`,
    label: `Field ${i}`,
    type: 'string',
    fieldType: 'text',
    groupName: 'orchard',
    hubspotDefined: false,
  }))
  portal({ ...orchard(), [routes.companies]: { results } })
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(0)
  expect(out.issues).toContainEqual({
    code: 'W_LARGE_SCOPE',
    message: 'the first pull wrote 201 properties for companies: every custom property is in the pull scope',
    configPath: 'objects.companies',
    fix: 'set objects.companies.custom to false and list the properties the app needs under objects.companies.include',
  })
  expect(existsSync(join(dir, 'kalup/objects/companies.ts'))).toBe(true)

  portal(orchard())
  const small = await run(empty(), '--portal', '1111111', '--objects', 'companies')
  expect(small.issues.map((issue) => issue.code)).not.toContain('W_LARGE_SCOPE')
})

test('a portal mismatch exits 4 after the first request and writes nothing', async () => {
  const { calls } = portal({ ...orchard(), [routes.account]: { ...fixture('account-info.json'), portalId: 2222222 } })
  const dir = empty()
  const out = await run(dir, '--portal', '1111111')
  expect(out.exitCode).toBe(4)
  expect(out.issues).toEqual([
    {
      code: 'E_TARGET_PORTAL_MISMATCH',
      message:
        'The key in HUBSPOT_SERVICE_KEY belongs to portal 2222222, not portal 1111111 given by --portal. Nothing was written.',
      fix: 'Ask the user to check the key in HUBSPOT_SERVICE_KEY and the Hub ID in --portal.',
      humanRequired: true,
    },
  ])
  expect(calls).toEqual(['GET /account-info/2026-09/details'])
  expect(listing(dir)).toEqual([])
})

test('an unknown object: the files are written, then the first pull exits 3 naming the config line', async () => {
  portal()
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies,press')
  expect(out.exitCode).toBe(3)
  expect(out.issues.map((issue) => issue.code)).toEqual(['E_UNKNOWN_OBJECT', 'E_FIRST_PULL'])
  expect(out.issues[0]).toMatchObject({ file: 'kalup.config.ts', line: 6, configPath: 'objects.press' })
  expect(out.issues[0]?.message).toContain('custom objects: harvest, press_run')
  expect(out.issues[1]?.fix).toBe('fix the issue above, then run npx kalup pull --target sandbox')
  expect(listing(dir)).toEqual(['.gitignore', 'AGENTS.md', 'kalup.config.ts', 'kalup/index.ts'])
})

test('a 403 on every object in scope is a gap, as in pull: exit 0 with E_SCOPE and only the empty barrel written', async () => {
  portal({ ...orchard(), [routes.companies]: jsonResponse(403, fixture('errors/missing-scope.json')) })
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(0)
  expect(out.issues.map((issue) => issue.code)).toEqual(['E_SCOPE'])
  expect(out.issues[0]?.fix).toBe('Add the scope crm.schemas.companies.read to the key.')
  expect(out.data?.pull?.objects).toEqual({})
  expect(text(dir, 'kalup/index.ts')).toBe('export {}\n')
  expect(existsSync(join(dir, 'kalup/objects'))).toBe(false)
  expect(out.text).toContain('wrote kalup/index.ts\n')
})

test('usage errors: --portal is required and a positive integer, --objects names something, config is no target name', async () => {
  const { calls } = portal()
  const cases: [string[], string][] = [
    [[], 'kalup init needs --portal <id>'],
    [['--portal', 'abc'], "--portal needs the Hub ID, a positive integer, not 'abc'"],
    [['--portal', '0'], "--portal needs the Hub ID, a positive integer, not '0'"],
    [['--portal'], '--portal needs the Hub ID'],
    [['--portal', '1111111', '--objects', ','], '--objects needs at least one object name'],
    [['--portal', '1111111', '--target', 'config'], "a target may not be named 'config'"],
    [['--portal', '1111111', '--check'], 'kalup init takes only --portal, --objects, --target and --json'],
    [['--portal', '1111111', '--discover'], 'kalup init takes only --portal, --objects, --target and --json'],
    [['--portal', '1111111', '--exit-code'], 'kalup init takes only --portal, --objects, --target and --json'],
    [['--portal', '1111111', '--only', 'property:*'], 'kalup init takes only --portal, --objects, --target and --json'],
  ]
  for (const [argv, message] of cases) {
    const dir = empty()
    const out = await run(dir, ...argv)
    expect(out.exitCode, argv.join(' ')).toBe(1)
    expect(out.issues[0]?.code, argv.join(' ')).toBe('E_USAGE')
    expect(out.issues[0]?.message, argv.join(' ')).toContain(message)
    expect(listing(dir), argv.join(' ')).toEqual([])
  }
  expect(calls).toEqual([])
})

test('an empty --target (an unset shell variable) is a usage error, not a target named the empty string', async () => {
  const { calls } = portal()
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies', '--target', '')
  expect(out.exitCode).toBe(1)
  expect(out.issues[0]).toMatchObject({ code: 'E_USAGE', message: '--target needs a target name' })
  expect(calls).toEqual([])
  expect(listing(dir)).toEqual([])
})

test('a missing key names the variable and never its value, and reads .env', async () => {
  portal()
  vi.stubEnv('HUBSPOT_SERVICE_KEY', undefined)
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(1)
  expect(out.issues[0]).toMatchObject({ code: 'E_MISSING_KEY', message: 'HUBSPOT_SERVICE_KEY is not set.' })
  expect(listing(dir)).toEqual([])
  writeFileSync(join(dir, '.env'), `HUBSPOT_SERVICE_KEY=${key}\n`)
  const again = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(again.exitCode).toBe(0)
})

test('the first pull failing after the write keeps the files, the empty barrel and says how to finish', async () => {
  portal({ ...orchard(), [routes.companies]: jsonResponse(401, fixture('errors/unauthorized.json')) })
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(1)
  expect(out.issues.map((issue) => issue.code)).toEqual(['E_AUTH', 'E_FIRST_PULL'])
  expect(out.issues[1]?.fix).toBe('fix the issue above, then run npx kalup pull --target sandbox')
  expect(out.data?.pull).toBeUndefined()
  expect(out.data?.files).toEqual(['kalup.config.ts', '.gitignore', 'AGENTS.md', 'kalup/index.ts'])
  expect(text(dir, 'kalup/index.ts')).toBe('export {}\n')
  expect(out.text).toContain('wrote kalup/index.ts\n')
  expect(existsSync(join(dir, 'kalup/objects'))).toBe(false)
})

test('key hygiene: no failing path prints the key', async () => {
  const failing: Record<string, () => Bodies> = {
    '401 on account-info': () => ({ [routes.account]: jsonResponse(401, fixture('errors/unauthorized.json')) }),
    '403 on account-info': () => ({ [routes.account]: jsonResponse(403, fixture('errors/missing-scope.json')) }),
    'portal mismatch': () => ({ [routes.account]: { ...fixture('account-info.json'), portalId: 2222222 } }),
    'not JSON': () => ({ ...orchard(), [routes.companies]: new Response('<html>', { status: 200 }) }),
    'nothing answers': () => ({}),
    'unknown object': () => ({ ...orchard(), [routes.schemas]: { results: [] } }),
    'pull fails after the write': () => ({
      ...orchard(),
      [routes.companyGroups]: jsonResponse(401, fixture('errors/unauthorized.json')),
    }),
  }
  for (const [name, bodies] of Object.entries(failing)) {
    portal(bodies())
    vi.stubEnv('HUBSPOT_SERVICE_KEY', undefined)
    const dir = empty()
    writeFileSync(join(dir, '.env'), `HUBSPOT_SERVICE_KEY=${key}\n`)
    const out = await run(dir, '--portal', '1111111', '--objects', 'companies,harvest')
    expect(out.exitCode, name).not.toBe(0)
    const printed: string[] = [out.text, JSON.stringify(out.data), JSON.stringify(out.issues)]
    printEnvelope(envelope(false, out.data, out.issues), { write: (text: string) => printed.push(text) })
    if (out.error) printed.push(String(out.error), out.error.stack ?? '', inspect(out.error, { depth: null }))
    expect(printed.join('\n'), name).not.toContain(key)
    expect(printed.join('\n').length, name).toBeGreaterThan(0)
  }
})
