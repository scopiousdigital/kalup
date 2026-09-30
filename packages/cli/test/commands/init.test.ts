import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import type { Fetch } from '@kalup/engine'
import { validate as validateProject } from '@kalup/engine'
import { afterEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import { fakeFetch, fixture, jsonResponse, portalBody, route } from '../../../engine/test/support/testing.js'
import type { InitData } from '../../src/commands/init.js'
import type { PullData } from '../../src/commands/pull.js'
import { cli, copy, empty, host, parseEnvelope, project } from '../../src/commands/testing.js'
import { load } from '../../src/lib/load.js'
import { envelope, type Issue, printEnvelope } from '../../src/lib/output.js'
import { agentsBlock } from '../../src/lib/templates/agents.js'

const key = 'kalup-test-secret-9f2c'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const scopeThenPull = /crm\.schemas\.companies\.read.*npx kalup pull --target sandbox/
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

/**
 * A route answers with a body, one Response, or a queue of Responses handed out in order. A sensitive properties list
 * with none has no properties.
 */
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

/** Stubs fetch with a portal and sets the key. Every call goes through fakeFetch, so a write path throws. */
function portal(bodies: Bodies = orchard()): { calls: string[] } {
  const calls: string[] = []
  const fetch: Fetch = (url, options) => {
    calls.push(`${options.method ?? 'GET'} ${route(url)}`)
    const body = portalBody(bodies, url)
    const next = Array.isArray(body) ? (body.shift() as Response | undefined) : body
    return fakeFetch(answer(next)).fetch(url, options)
  }
  vi.stubGlobal('fetch', fetch)
  vi.stubEnv('HUBSPOT_SERVICE_KEY', key)
  return { calls }
}

/** A Response as it is, a 404 for a path with no body, else the body as a 200 with the rate headers. */
function answer(body: unknown): Response {
  if (body instanceof Response) {
    return body
  }
  return body === undefined ? jsonResponse(404, { message: 'Not found' }) : jsonResponse(200, body, rate)
}

function account(accountType: string): Bodies {
  return { ...orchard(), [routes.account]: { ...fixture('account-info.json'), accountType } }
}

interface Outcome {
  data?: InitData
  error?: Error
  exitCode: number
  issues: Issue[]
  text: string
}

// init through the host's parse and dispatch, without its printing. The envelope and printing are run()'s tests'.
async function run(dir: string, ...argv: string[]): Promise<Outcome> {
  try {
    const result = await host().execute(['init', ...argv], dir)
    return {
      exitCode: result.exitCode ?? 0,
      data: result.data as InitData | undefined,
      issues: result.issues ?? [],
      text: result.text ?? '',
    }
  } catch (error) {
    // The built host has its own copy of KalupError, so it is recognised by shape rather than by class.
    const { exitCode, issues } = error as { exitCode?: unknown; issues?: unknown }
    if (typeof exitCode !== 'number' || !Array.isArray(issues)) {
      throw error
    }
    return { exitCode, issues: issues as Issue[], text: '', error: error as Error }
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
    // The project's own files: .kalup holds state, which Kalup writes in its own format.
    const paths = ['kalup', 'kalup.config.ts'].map((path) => join(dir, path)).filter((path) => existsSync(path))
    execFileSync(join(root, 'node_modules/.bin/biome'), ['check', `--config-path=${root}`, ...paths], {
      encoding: 'utf8',
    })
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

test('init is a built command with its own flags in the help', async () => {
  const out = await cli(empty(), 'init', '--help')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toContain('--portal=<id>')
  expect(out.stdout).not.toContain('not implemented yet')
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
    'CLAUDE.md',
    'kalup.config.ts',
    'kalup/index.ts',
    'kalup/objects/companies.ts',
    'kalup/objects/harvest.ts',
  ])
  // Besides the project files, the first pull records what the files and the portal agree on in state.
  expect(listing(dir)).toEqual([...files, '.kalup/state/portal-1111111.json'].sort())
  for (const file of files) {
    expect(text(dir, file), file).toBe(text(golden, file))
  }
  expect(text(dir, 'AGENTS.md')).toBe(agentsBlock)
  // init checks the portal before it writes, then the pull checks it again and reads the scope once.
  expect(calls).toEqual([
    'GET /account-info/2026-09/details',
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
  expect(out.data).toMatchObject({
    target: 'sandbox',
    portalId: 1_111_111,
    account: {
      portalId: 1_111_111,
      accountType: 'SANDBOX',
      uiDomain: 'app-eu1.hubspot.com',
      timeZone: 'Europe/Ljubljana',
    },
    objects: ['companies', 'harvest'],
    scopes: [
      { scope: 'crm.schemas.companies.read', neededFor: ['companies'] },
      { scope: 'crm.schemas.custom.read', neededFor: ['harvest'] },
    ],
    files: ['kalup.config.ts', '.gitignore', 'AGENTS.md', 'CLAUDE.md'],
  })
  expect(out.data?.pull?.files).toEqual(['kalup/index.ts', 'kalup/objects/companies.ts', 'kalup/objects/harvest.ts'])
  expect(out.issues.map((issue) => issue.code)).toEqual(['W_UNSUPPORTED_TYPE'])
  // Limits Tracking answered 403 to a key with crm.schemas scopes only (observed 2026-09-29): one more is recommended.
  expect(out.data?.recommended).toEqual({
    scope: 'crm.objects.companies.read',
    neededFor: ['the property limit check in plan'],
  })
  expect(out.data?.writeScopes).toEqual([
    { scope: 'crm.schemas.companies.write', neededFor: ['companies'] },
    { scope: 'crm.schemas.custom.write', neededFor: ['harvest'] },
  ])
  // No formatter in an empty directory: no stray ignore file, one note.
  expect(normalise(out.text)).toMatchInlineSnapshot(`
    "Portal 1111111: SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana
    Target sandbox: companies, harvest
    Named the target sandbox from the account type. Rename it in kalup.config.ts if you want another name.
    Read scopes the key in HUBSPOT_SERVICE_KEY needs (Development > Keys > Service keys, see https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys):
      crm.schemas.companies.read (companies)
      crm.schemas.custom.read (harvest)
      crm.objects.companies.read (recommended, for the property limit check in plan; kalup reads no records)
    For apply, the write key needs the read scopes and:
      crm.schemas.companies.write (companies)
      crm.schemas.custom.write (harvest)
    wrote kalup.config.ts
    wrote .gitignore
    wrote AGENTS.md
    wrote CLAUDE.md
    No biome.json or prettier config found. If you add a formatter, ignore kalup/ and kalup.config.ts in it: the writer keeps those files in its own format.
    Target sandbox, portal 1111111
    companies: 11 added, 0 changed, 0 unchanged, 0 missing in portal
      added: property:companies/irrigation_notes
      added: property:companies/plot_count
      added: property:companies/plot_shape
      added: property:companies/plot_tags
      added: property:companies/plot_total
      added: property:companies/pruned
      added: property:companies/row_meta
      added: property:companies/soil_ph
      added: property:companies/yield_tier
      added: group:companies/orchard
      added: group:companies/plots
    harvest: 6 added, 0 changed, 0 unchanged, 0 missing in portal
      added: object:harvest
      added: property:harvest/batch_code
      added: property:harvest/orchard_ref
      added: property:harvest/picked_on
      added: property:harvest/weight_kg
      added: group:harvest/harvest_details
    wrote kalup/index.ts
    wrote kalup/objects/companies.ts
    wrote kalup/objects/harvest.ts
    Recorded the agreed values of 15 resources in state
    "
  `)
  // Nothing existed before, so no history was written. CLAUDE.md is created from nothing, as the one pointer line.
  expect(existsSync(join(dir, '.kalup', 'history'))).toBe(false)
  expect(text(dir, 'CLAUDE.md')).toBe('@AGENTS.md\n')
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
  for (const [file, content] of Object.entries(before)) {
    expect(text(dir, file), file).toBe(content)
  }
})

test('existing files: AGENTS.md and CLAUDE.md are appended, biome.json gets the ignores, .gitignore keeps its lines', async () => {
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
  expect(text(dir, '.gitignore')).toBe('node_modules/\ndist/\n.kalup/\n.env\n')
  expect(JSON.parse(text(dir, 'biome.json'))).toEqual({
    $schema: 'https://biomejs.dev/schemas/2.5.4/schema.json',
    files: { includes: ['**', '!**/node_modules', '!kalup', '!kalup.config.ts', '!.kalup'] },
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
  for (const [file, content] of Object.entries(before)) {
    expect(text(dir, file), file).toBe(content)
  }
})

test('a .gitignore with /.kalup/ and /.env and a .prettierignore with kalup/** and /kalup.config.ts already cover the paths, so nothing is appended', async () => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, '.gitignore'), '/.kalup/\n/.env\n')
  writeFileSync(join(dir, '.prettierignore'), 'kalup/**\n/kalup.config.ts\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toEqual(['kalup.config.ts', 'AGENTS.md', 'CLAUDE.md'])
  expect(text(dir, '.gitignore')).toBe('/.kalup/\n/.env\n')
  expect(text(dir, '.prettierignore')).toBe('kalup/**\n/kalup.config.ts\n')
})

test.each(
  [
    '.env',
    '/.env',
    '**/.env',
    '.env*',
    '/.env*',
    '*.env',
    '/*.env',
    '*.env*',
    '.env  ',
    '!.env\n.env',
    '.env*\n!.env.example',
  ].flatMap((line) => [`.kalup/\n${line}\n`, `.kalup/\r\n${line}\r\n`]),
)('a .gitignore that already ignores .env gets no line: %j', async (before) => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, '.gitignore'), before)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).not.toContain('.gitignore')
  expect(text(dir, '.gitignore')).toBe(before)
})

// Each of these ignores something else: git reads ' .env' with its leading space, and '.env/' matches only a folder.
// The last line that matches .env decides, so a later !.env un-ignores it and the appended .env line ignores it again.
test.each([
  '.env.local',
  '.envrc',
  '.env/',
  ' .env',
  '# .env',
  '.env\t',
  '!.env',
  '.env*\n!.env',
  '.env\n!.env',
  '*.env\n!/.env',
])('a .gitignore line %j does not ignore .env, so init appends the .env line', async (line) => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, '.gitignore'), `.kalup/\n${line}`)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toContain('.gitignore')
  expect(text(dir, '.gitignore')).toBe(`.kalup/\n${line}\n.env\n`)
})

// git with no global or system config, so an excludesFile on the machine cannot stand in for the line init writes, and
// no GIT_ variable from the caller (a hook sets GIT_DIR) points it at another repository.
function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    stdio: 'pipe',
  })
}

test.each([undefined, '.env*\n!.env\n'])(
  'git add -A right after init in a new repository stages no .env, with a .gitignore of %j before',
  async (before) => {
    portal()
    vi.stubEnv('HUBSPOT_SERVICE_KEY', undefined)
    const dir = empty()
    git(dir, 'init', '-q')
    writeFileSync(join(dir, '.env'), `HUBSPOT_SERVICE_KEY=${key}\n`)
    if (before !== undefined) {
      writeFileSync(join(dir, '.gitignore'), before)
    }
    expect((await run(dir, '--portal', '1111111', '--objects', 'companies')).exitCode).toBe(0)
    git(dir, 'add', '-A')
    expect(git(dir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean)).toEqual([
      '.gitignore',
      'AGENTS.md',
      'CLAUDE.md',
      'kalup.config.ts',
      'kalup/index.ts',
      'kalup/objects/companies.ts',
    ])
  },
)

test('history holds project files only: a pull and a fmt that overwrite files next to .env never copy it', async () => {
  portal()
  vi.stubEnv('HUBSPOT_SERVICE_KEY', undefined)
  const dir = empty()
  writeFileSync(join(dir, '.env'), `HUBSPOT_SERVICE_KEY=${key}\n`)
  expect((await run(dir, '--portal', '1111111', '--objects', 'companies')).exitCode).toBe(0)
  // A blank line pull's canonical text drops, then a blank line fmt removes. A label edit would be a config change
  // the pull keeps, since the first pull recorded the base.
  const companies = 'kalup/objects/companies.ts'
  writeFileSync(join(dir, companies), text(dir, companies).replace('  properties: {\n', '  properties: {\n\n'))
  expect((await cli(dir, 'pull', '--target', 'sandbox')).exitCode).toBe(0)
  writeFileSync(join(dir, 'kalup.config.ts'), `${text(dir, 'kalup.config.ts')}\n`)
  expect((await cli(dir, 'fmt')).exitCode).toBe(0)
  const saved = listing(join(dir, '.kalup/history')).map((file) => file.slice(file.indexOf('/') + 1))
  expect(saved.sort()).toEqual(['kalup.config.ts', companies])
})

test('a .prettierignore that covers kalup/ only gets the kalup.config.ts line', async () => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, '.prettierignore'), 'kalup/\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toContain('.prettierignore')
  expect(text(dir, '.prettierignore')).toBe('kalup/\nkalup.config.ts\n')
})

test('a biome.json with no files.includes gets ** and the ignores', async () => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), '{"formatter":{"enabled":true}}')
  await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(JSON.parse(text(dir, 'biome.json'))).toEqual({
    formatter: { enabled: true },
    files: { includes: ['**', '!kalup', '!kalup.config.ts', '!.kalup'] },
  })
})

test.each([
  ['!kalup', '"!kalup.config.ts", "!.kalup"'],
  ['!kalup/**', '"!kalup.config.ts", "!.kalup"'],
  ['!!kalup', '"!kalup.config.ts", "!.kalup"'],
  ['!!kalup/**', '"!kalup.config.ts", "!.kalup"'],
  ['!kalup.config.ts', '"!kalup", "!.kalup"'],
  ['!!kalup.config.ts', '"!kalup", "!.kalup"'],
  ['!.kalup/**', '"!kalup", "!kalup.config.ts"'],
])('a biome.json with %s already ignores that path, so only %s is added', async (present, added) => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), `{ "files": { "includes": ["**", "${present}"] } }\n`)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toContain('biome.json')
  expect(text(dir, 'biome.json')).toBe(`{ "files": { "includes": ["**", "${present}", ${added}] } }\n`)
})

test('a biome.json that ignores all three paths already is left as it was', async () => {
  portal()
  const dir = empty()
  const before = '{ "files": { "includes": ["**", "!!kalup/**", "!kalup.config.ts", "!!.kalup"] } }\n'
  writeFileSync(join(dir, 'biome.json'), before)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).not.toContain('biome.json')
  expect(text(dir, 'biome.json')).toBe(before)
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

test('a biome.jsonc keeps every comment: the ignore goes in as a text edit, and the rest of the file is as it was', async () => {
  portal()
  const dir = empty()
  const jsonc = (includes: string) =>
    [
      '{',
      '  "$schema": "https://biomejs.dev/schemas/2.5.4/schema.json", // trailing "quote',
      '  /* block with "quote and // inside */',
      `  "files": { "includes": [${includes}] },`,
      '  "formatter": { "indentStyle": "space" } /* end */',
      '}',
      '',
    ].join('\n')
  writeFileSync(join(dir, 'biome.jsonc'), jsonc('"**", "!**/*.gen.ts"'))
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(0)
  expect(out.data?.files).toContain('biome.jsonc')
  expect(text(dir, 'biome.jsonc')).toBe(jsonc('"**", "!**/*.gen.ts", "!kalup", "!kalup.config.ts", "!.kalup"'))
  expect(existsSync(join(dir, '.prettierignore'))).toBe(false)
  expect(out.text).not.toContain('No biome.json or prettier config found.')
})

// biome's own check, with the config in `dir`, on `path` there. The golden tests use the repo's config instead. A
// warning fails it too: biome warns on `!kalup/**`, as it takes `!kalup` for a folder. The real path, because biome
// matches no files.includes entry when the config path goes through a symlink, as the macOS temp directory does.
function ownBiome(dir: string, path: string): string {
  const real = realpathSync(dir)
  try {
    execFileSync(
      join(root, 'node_modules/.bin/biome'),
      ['check', '--error-on-warnings', `--config-path=${real}`, path],
      {
        cwd: real,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    )
    return ''
  } catch (e) {
    const { stdout, stderr } = e as { stdout: string; stderr: string }
    return `${stdout}\n${stderr}`
  }
}

// The shape `biome init` writes: tabs, and files with no includes.
const biomeInit =
  '{\n\t"$schema": "https://biomejs.dev/schemas/2.5.4/schema.json",\n\t"files": {\n\t\t"ignoreUnknown": false\n\t},\n\t"formatter": {\n\t\t"enabled": true,\n\t\t"indentStyle": "tab"\n\t}\n}\n'

test.each([
  {
    name: 'the biome init shape',
    file: 'biome.json',
    before: biomeInit,
    after:
      '{\n\t"$schema": "https://biomejs.dev/schemas/2.5.4/schema.json",\n\t"files": {\n\t\t"ignoreUnknown": false,\n\t\t"includes": ["**", "!kalup", "!kalup.config.ts", "!.kalup"]\n\t},\n\t"formatter": {\n\t\t"enabled": true,\n\t\t"indentStyle": "tab"\n\t}\n}\n',
  },
  {
    name: 'includes on one line',
    file: 'biome.jsonc',
    before: '{\n\t"files": { "includes": ["**"] }\n}\n',
    after: '{\n\t"files": { "includes": ["**", "!kalup", "!kalup.config.ts", "!.kalup"] }\n}\n',
  },
  {
    name: 'a missing files',
    file: 'biome.json',
    before: '{\n\t"formatter": { "indentStyle": "tab" }\n}\n',
    after:
      '{\n\t"formatter": { "indentStyle": "tab" },\n\t"files": { "includes": ["**", "!kalup", "!kalup.config.ts", "!.kalup"] }\n}\n',
  },
  // Each new entry gets its own line, after the comment on the last one's line.
  {
    name: 'one entry per line',
    file: 'biome.jsonc',
    before:
      '{\n  "formatter": { "indentStyle": "space" },\n  "files": {\n    "includes": [\n      "**",\n      "!**/dist" // the build output\n    ]\n  }\n}\n',
    after:
      '{\n  "formatter": { "indentStyle": "space" },\n  "files": {\n    "includes": [\n      "**",\n      "!**/dist", // the build output\n      "!kalup",\n      "!kalup.config.ts",\n      "!.kalup"\n    ]\n  }\n}\n',
  },
  // The same with CRLF line breaks: each new entry gets its own \r\n line.
  {
    name: 'one entry per line, CRLF',
    file: 'biome.jsonc',
    before:
      '{\r\n  "formatter": { "indentStyle": "space", "lineEnding": "crlf" },\r\n  "files": {\r\n    "includes": [\r\n      "**",\r\n      "!**/dist" // the build output\r\n    ]\r\n  }\r\n}\r\n',
    after:
      '{\r\n  "formatter": { "indentStyle": "space", "lineEnding": "crlf" },\r\n  "files": {\r\n    "includes": [\r\n      "**",\r\n      "!**/dist", // the build output\r\n      "!kalup",\r\n      "!kalup.config.ts",\r\n      "!.kalup"\r\n    ]\r\n  }\r\n}\r\n',
  },
])('the edited biome config passes its own biome check: $name', async ({ file, before, after }) => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, file), before)
  expect(ownBiome(dir, file), before).toBe('')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files, before).toContain(file)
  expect(text(dir, file)).toBe(after)
  expect(ownBiome(dir, file), after).toBe('')
})

test('a project on the biome init config passes its own biome check right after init: kalup/ and kalup.config.ts are out', async () => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), biomeInit)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(0)
  expect(existsSync(join(dir, 'kalup/objects/companies.ts'))).toBe(true)
  expect(ownBiome(dir, '.')).toBe('')
})

test('with biome.json and biome.jsonc both there, biome.json gets the ignores, as biome reads that one', async () => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), '{ "files": { "includes": ["**"] } }\n')
  writeFileSync(join(dir, 'biome.jsonc'), '{ "files": { "includes": ["**"] } }\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toEqual(['kalup.config.ts', '.gitignore', 'biome.json', 'AGENTS.md', 'CLAUDE.md'])
  expect(text(dir, 'biome.json')).toBe('{ "files": { "includes": ["**", "!kalup", "!kalup.config.ts", "!.kalup"] } }\n')
  expect(text(dir, 'biome.jsonc')).toBe('{ "files": { "includes": ["**"] } }\n')
})

test('a biome.json with a comment stops init before any request or write: biome reads biome.json as plain JSON', async () => {
  const { calls } = portal()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), '{\n  // keep dist out\n  "files": { "includes": ["**", "!dist"] }\n}\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(1)
  expect(out.issues[0]).toMatchObject({ code: 'E_BIOME_CONFIG', file: 'biome.json' })
  expect(calls).toEqual([])
  expect(listing(dir)).toEqual(['biome.json'])
})

test.each([
  [
    'biome.jsonc',
    '{\n  // biome allows the trailing commas, JSON.parse does not\n  "files": { "includes": ["**"], },\n}\n',
  ],
  ['biome.json', '{ "files": { "includes": "**" } }\n'],
  ['biome.json', '{ "files": { "includes": { "all": "**" } } }\n'],
])('a %s init cannot read files.includes in is left alone, with a note and no stop: %j', async (file, content) => {
  const { calls } = portal()
  const dir = empty()
  writeFileSync(join(dir, file), content)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode, content).toBe(0)
  expect(out.data?.files, content).toEqual(['kalup.config.ts', '.gitignore', 'AGENTS.md', 'CLAUDE.md'])
  expect(text(dir, file)).toBe(content)
  expect(out.text).toContain(`${file} was left alone`)
  expect(out.text).toContain('!kalup, !kalup.config.ts and !.kalup')
  expect(calls.length).toBeGreaterThan(0)
})

test.each([
  ['CLAUDE.md', 'AGENTS.md'],
  ['AGENTS.md', 'CLAUDE.md'],
])('a %s linked to %s stays a link and gets no pointer to itself', async (link, file) => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, file), '# House rules\n')
  symlinkSync(file, join(dir, link))
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode, link).toBe(0)
  expect(out.data?.files, link).toEqual(['kalup.config.ts', '.gitignore', 'AGENTS.md'])
  expect(text(dir, file), link).toBe(`# House rules\n\n${agentsBlock}`)
  expect(lstatSync(join(dir, link)).isSymbolicLink(), link).toBe(true)
})

test.each([
  ['.prettierrc', '{}\n'],
  ['.prettierrc.json', '{}\n'],
  ['prettier.config.mjs', 'export default {}\n'],
  ['package.json', '{"name":"orchard","prettier":{}}\n'],
])(
  'without biome.json, a prettier config in %s gets kalup/ and kalup.config.ts in .prettierignore',
  async (file, content) => {
    portal()
    const dir = empty()
    writeFileSync(join(dir, file), content)
    const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
    expect(out.data?.files, file).toContain('.prettierignore')
    expect(text(dir, '.prettierignore'), file).toBe('kalup/\nkalup.config.ts\n')
    expect(out.text, file).not.toContain('No biome.json or prettier config found.')
  },
)

test('without biome.json, an existing .prettierignore is appended to, and with no prettier config a note is printed', async () => {
  // An existing .prettierignore is the config, and is appended to.
  portal()
  const existing = empty()
  writeFileSync(join(existing, '.prettierignore'), 'dist')
  const out = await run(existing, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toContain('.prettierignore')
  expect(text(existing, '.prettierignore')).toBe('dist\nkalup/\nkalup.config.ts\n')

  // A package.json without the key is not one: no stray file, the note.
  portal()
  const bare = empty()
  writeFileSync(join(bare, 'package.json'), '{"name":"orchard"}\n')
  const none = await run(bare, '--portal', '1111111', '--objects', 'companies')
  expect(none.exitCode).toBe(0)
  expect(existsSync(join(bare, '.prettierignore'))).toBe(false)
  expect(none.text).toContain('No biome.json or prettier config found.')
  expect(none.text).toContain('ignore kalup/ and kalup.config.ts in it')
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

test.each([
  ['SANDBOX', [], 'sandbox'],
  ['DEVELOPER_TEST', [], 'sandbox'],
  ['STANDARD', [], 'production'],
  ['STANDARD', ['--target', 'staging'], 'staging'],
])(
  'the target is named by the account type, a STANDARD portal is protected, and --target wins: %s %j is %s',
  async (type, extra, name) => {
    portal(account(type))
    const dir = empty()
    const out = await run(dir, '--portal', '1111111', '--objects', 'companies', ...extra)
    expect(out.exitCode, type).toBe(0)
    expect(out.data?.target, type).toBe(name)
    const config = text(dir, 'kalup.config.ts')
    expect(config, type).toContain(`  targets: {\n    ${name}: {\n      portalId: 1111111,\n`)
    expect(config.includes('protected: true,'), type).toBe(type === 'STANDARD')
    expect(out.text.includes(`Target ${name} (protected)`), type).toBe(type === 'STANDARD')
    // The account type only suggests the name, and the text says so; init never writes defaultTarget.
    const named = `Named the target ${name} from the account type.`
    expect(out.text.includes(named), type).toBe(extra.length === 0)
    expect(config, type).not.toContain('defaultTarget')
  },
)

test('init --target acme-prod names the target, and the next pull needs no flag: it is the only target', async () => {
  const { calls } = portal()
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies,harvest', '--target', 'acme-prod')
  expect(out.exitCode).toBe(0)
  expect(out.data?.target).toBe('acme-prod')
  expect(text(dir, 'kalup.config.ts')).toContain("  targets: {\n    'acme-prod': {\n      portalId: 1111111,\n")
  expect(out.text).not.toContain('Named the target')
  // The first pull ran against the new target by name.
  expect(out.text).toContain('Target acme-prod, portal 1111111\n')
  const first = calls.length
  const again = await cli(dir, 'pull')
  expect(again.exitCode).toBe(0)
  expect(again.stdout.startsWith('Target acme-prod, portal 1111111 (the only target)\n')).toBe(true)
  expect(again.stdout).toContain('Files are up to date\n')
  expect(calls.slice(first)).toEqual(calls.slice(1, first))
})

test('the default objects are contacts, companies and deals, each with its own read scope', async () => {
  const bodies = orchard()
  for (const path of [routes.contacts, routes.deals]) {
    bodies[path] = fixture('api/orchard/companies.properties.json')
  }
  for (const path of [routes.contactGroups, routes.dealGroups]) {
    bodies[path] = fixture('api/orchard/companies.groups.json')
  }
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
  expect(out.data?.recommended.scope).toBe('crm.objects.contacts.read')
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
  expect(out.data?.writeScopes.map((s) => s.scope)).toEqual(['e-commerce'])
  // Products are not companies, contacts or deals, so the recommended scope falls back to companies.
  expect(out.data?.recommended.scope).toBe('crm.objects.companies.read')
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
    message: expect.stringContaining('201 properties'),
    configPath: 'objects.companies',
    fix: expect.stringContaining('objects.companies.include'),
  })
  expect(existsSync(join(dir, 'kalup/objects/companies.ts'))).toBe(true)

  portal(orchard())
  const small = await run(empty(), '--portal', '1111111', '--objects', 'companies')
  expect(small.issues.map((issue) => issue.code)).not.toContain('W_LARGE_SCOPE')
})

test('a portal mismatch exits 4 after the first request and writes nothing', async () => {
  const { calls } = portal({ ...orchard(), [routes.account]: { ...fixture('account-info.json'), portalId: 2_222_222 } })
  const dir = empty()
  const out = await run(dir, '--portal', '1111111')
  expect(out.exitCode).toBe(4)
  expect(out.issues).toEqual([
    {
      code: 'E_TARGET_PORTAL_MISMATCH',
      message: expect.stringContaining('portal 2222222, not portal 1111111'),
      fix: expect.stringContaining('--portal'),
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
  expect(out.issues[1]?.fix).toContain('npx kalup pull --target sandbox')
  expect(listing(dir)).toEqual(['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'kalup.config.ts', 'kalup/index.ts'])
})

test('a 403 on every object in scope is an incomplete first pull, as in pull: exit 1 with E_SCOPE and E_INCOMPLETE, only the empty barrel written', async () => {
  portal({ ...orchard(), [routes.companies]: jsonResponse(403, fixture('errors/missing-scope.json')) })
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(1)
  expect(out.issues.map((issue) => issue.code)).toEqual(['E_SCOPE', 'E_INCOMPLETE'])
  expect(out.issues[0]?.fix).toContain('crm.schemas.companies.read')
  expect(out.issues[1]?.fix).toMatch(scopeThenPull)
  expect(out.data?.pull?.objects).toEqual({})
  expect(text(dir, 'kalup/index.ts')).toBe('export {}\n')
  expect(existsSync(join(dir, 'kalup/objects'))).toBe(false)
  expect(out.text).toContain('wrote kalup/index.ts\n')
})

test.each([
  [[], 'kalup init needs --portal <id>'],
  [['--portal', 'abc'], "not 'abc'"],
  [['--portal', '0'], "not '0'"],
  [['--portal'], 'Flag --portal expects a value'],
  [['--portal', '1111111', '--objects', ','], '--objects needs'],
  [['--portal', '1111111', '--target', 'config'], "a target may not be named 'config'"],
  // A flag init does not declare is unknown to it: oclif rejects it before the handler runs.
  [['--portal', '1111111', '--check'], 'unknown flag --check'],
  [['--portal', '1111111', '--discover'], 'unknown flag --discover'],
  [['--portal', '1111111', '--exit-code'], 'unknown flag --exit-code'],
  [['--portal', '1111111', '--only', 'property:*'], 'unknown flag --only'],
])(
  'usage errors: --portal is required and a positive integer, --objects names something, config is no target name: %j',
  async (argv, message) => {
    const { calls } = portal()
    const dir = empty()
    const out = await run(dir, ...argv)
    expect(out.exitCode, argv.join(' ')).toBe(1)
    expect(out.issues[0]?.code, argv.join(' ')).toBe('E_USAGE')
    expect(out.issues[0]?.message, argv.join(' ')).toContain(message)
    expect(listing(dir), argv.join(' ')).toEqual([])
    expect(calls).toEqual([])
  },
)

test('an empty --target (an unset shell variable) is a usage error, not a target named the empty string', async () => {
  const { calls } = portal()
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies', '--target', '')
  expect(out.exitCode).toBe(1)
  expect(out.issues[0]).toMatchObject({ code: 'E_USAGE', message: 'Flag --target expects a value' })
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
  expect(out.issues[1]?.fix).toContain('npx kalup pull --target sandbox')
  expect(out.data?.pull).toBeUndefined()
  expect(out.data?.files).toEqual(['kalup.config.ts', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'kalup/index.ts'])
  expect(text(dir, 'kalup/index.ts')).toBe('export {}\n')
  expect(out.text).toContain('wrote kalup/index.ts\n')
  expect(existsSync(join(dir, 'kalup/objects'))).toBe(false)
})

const failing: Record<string, () => Bodies> = {
  '401 on account-info': () => ({ [routes.account]: jsonResponse(401, fixture('errors/unauthorized.json')) }),
  '403 on account-info': () => ({ [routes.account]: jsonResponse(403, fixture('errors/missing-scope.json')) }),
  'portal mismatch': () => ({ [routes.account]: { ...fixture('account-info.json'), portalId: 2_222_222 } }),
  'not JSON': () => ({ ...orchard(), [routes.companies]: new Response('<html>', { status: 200 }) }),
  'nothing answers': () => ({}),
  'unknown object': () => ({ ...orchard(), [routes.schemas]: { results: [] } }),
  'pull fails after the write': () => ({
    ...orchard(),
    [routes.companyGroups]: jsonResponse(401, fixture('errors/unauthorized.json')),
  }),
}

test.each(Object.entries(failing))('key hygiene: no failing path prints the key: %s', async (name, bodies) => {
  portal(bodies())
  vi.stubEnv('HUBSPOT_SERVICE_KEY', undefined)
  const dir = empty()
  writeFileSync(join(dir, '.env'), `HUBSPOT_SERVICE_KEY=${key}\n`)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies,harvest')
  expect(out.exitCode, name).not.toBe(0)
  const printed: string[] = [out.text, JSON.stringify(out.data), JSON.stringify(out.issues)]
  printEnvelope(envelope(false, out.data, out.issues), { write: (line: string) => printed.push(line) })
  if (out.error) {
    printed.push(String(out.error), out.error.stack ?? '', inspect(out.error, { depth: null }))
  }
  expect(printed.join('\n'), name).not.toContain(key)
  expect(printed.join('\n').length, name).toBeGreaterThan(0)
})
