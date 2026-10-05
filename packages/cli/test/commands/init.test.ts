import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Fetch } from '@kalup/engine'
import { validate as validateProject } from '@kalup/engine'
import { afterEach, expect, test, vi } from 'vitest'
import { fakeFetch, fixture, jsonResponse, portalBody, route } from '../../../engine/test/support/testing.js'
import type { InitData } from '../../src/commands/init.js'
import type { PullData } from '../../src/commands/pull.js'
import { cli, copy, empty, host, parseEnvelope, project } from '../../src/commands/testing.js'
import { load } from '../../src/lib/load.js'
import { envelope, type Issue, printEnvelope } from '../../src/lib/output.js'
import { agentsBlock } from '../../src/lib/templates/agents.js'

const key = 'kalup-test-secret-9f2c'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
/** What init writes for @kalup/core: a caret on the CLI's own version, which changesets keeps equal to core's. */
const coreRange = `^${(JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')) as { version: string }).version}`
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
  // pnpm sets it for the test run; init reads it for the package manager when there is no lockfile.
  vi.stubEnv('npm_config_user_agent', undefined)
  return { calls }
}

/** A Response as it is, a 404 for a path with no body, else the body as a 200 with the rate headers. */
function answer(body: unknown): Response {
  if (body instanceof Response) {
    return body
  }
  return body === undefined ? jsonResponse(404, { message: 'Not found' }) : jsonResponse(200, body, rate)
}

/** Stubs fetch so any request is recorded and fails: init sends none. No key is set, so init prints the key step. */
function offline(): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string | URL) => {
    calls.push(route(String(url)))
    throw new Error('init sent a request')
  })
  vi.stubEnv('HUBSPOT_SERVICE_KEY', undefined)
  vi.stubEnv('npm_config_user_agent', undefined)
  return { calls }
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

test('init sends no request and needs no key: it writes the project files and says what is left', async () => {
  const { calls } = offline()
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies,harvest', '--target', 'sandbox')
  expect(out.exitCode).toBe(0)
  expect(calls).toEqual([])
  expect(listing(dir)).toEqual(['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'hubspot/index.ts', 'kalup.config.ts'])
  for (const file of ['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'kalup.config.ts']) {
    expect(text(dir, file), file).toBe(text(project('inited'), file))
  }
  expect(text(dir, 'hubspot/index.ts')).toBe('export {}\n')
  expect(out.data).toEqual({
    target: 'sandbox',
    portalId: 1_111_111,
    keyVariable: 'HUBSPOT_SERVICE_KEY',
    objects: ['companies', 'harvest'],
    scopes: [
      { scope: 'crm.schemas.companies.read', neededFor: ['companies'] },
      { scope: 'crm.schemas.custom.read', neededFor: ['harvest'] },
    ],
    // Limits Tracking answered 403 to a key with crm.schemas scopes only (observed 2026-09-29): one more is recommended.
    recommended: { scope: 'crm.objects.companies.read', neededFor: ['the property limit check in plan'] },
    writeScopes: [
      { scope: 'crm.schemas.companies.write', neededFor: ['companies'] },
      { scope: 'crm.schemas.custom.write', neededFor: ['harvest'] },
    ],
    files: ['kalup.config.ts', 'hubspot/index.ts', '.gitignore', 'AGENTS.md', 'CLAUDE.md'],
    packageJson: { added: false, found: false, manager: 'npm' },
    next: [
      'Put the key in .env as HUBSPOT_SERVICE_KEY=<key>, or export it in the shell.',
      'No package.json here. The files under hubspot/ import @kalup/core: install it in your app with npm install @kalup/core.',
      'Run npx kalup pull to write the object files from the portal.',
    ],
  })
  expect(out.issues).toEqual([])
  // No formatter in an empty directory: no stray ignore file, one note.
  expect(out.text).toMatchInlineSnapshot(`
      "Target sandbox, portal 1111111: companies, harvest
      wrote kalup.config.ts
      wrote hubspot/index.ts
      wrote .gitignore
      wrote AGENTS.md
      wrote CLAUDE.md
      No biome.json or prettier config found. If you add a formatter, ignore hubspot/ and kalup.config.ts in it: the writer keeps those files in its own format.
      Read scopes the key in HUBSPOT_SERVICE_KEY needs (Development > Keys > Service keys, see https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys):
        crm.schemas.companies.read (companies)
        crm.schemas.custom.read (harvest)
        crm.objects.companies.read (recommended, for the property limit check in plan; kalup reads no records)
      For apply, the write key needs the read scopes and:
        crm.schemas.companies.write (companies)
        crm.schemas.custom.write (harvest)
      Next:
        Put the key in .env as HUBSPOT_SERVICE_KEY=<key>, or export it in the shell.
        No package.json here. The files under hubspot/ import @kalup/core: install it in your app with npm install @kalup/core.
        Run npx kalup pull to write the object files from the portal.
      "
    `)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
  expect(text(dir, 'AGENTS.md')).toBe(agentsBlock('hubspot'))
  expect(text(dir, 'CLAUDE.md')).toBe('@AGENTS.md\n')
  expect(validateProject(load(dir)).issues).toEqual([])
})

test('a pull right after the first pull is byte-identical and writes no history', async () => {
  portal()
  const dir = empty()
  expect(
    (await run(dir, '--portal', '1111111', '--objects', 'companies,harvest', '--target', 'sandbox')).exitCode,
  ).toBe(0)
  expect((await cli(dir, 'pull')).exitCode).toBe(0)
  const before = Object.fromEntries(listing(dir).map((file) => [file, text(dir, file)]))
  const again = await cli(dir, 'pull', '--target', 'sandbox', '--json')
  expect(again.exitCode).toBe(0)
  expect(parseEnvelope<PullData>(again.stdout).data?.files).toEqual([])
  expect(listing(dir)).toEqual(Object.keys(before))
  for (const [file, content] of Object.entries(before)) {
    expect(text(dir, file), file).toBe(content)
  }
})

test('the golden init: init, then the first pull, gives the inited fixture; only read paths are hit, all by the pull', async () => {
  const { calls } = portal()
  const dir = empty()
  expect(
    (await run(dir, '--portal', '1111111', '--objects', 'companies,harvest', '--target', 'sandbox')).exitCode,
  ).toBe(0)
  expect(calls).toEqual([])
  const pulled = await cli(dir, 'pull', '--json')
  expect(pulled.exitCode, pulled.stdout).toBe(0)
  const golden = project('inited')
  const files = listing(golden)
  expect(files).toEqual([
    '.gitignore',
    'AGENTS.md',
    'CLAUDE.md',
    'hubspot/index.ts',
    'hubspot/objects/companies.ts',
    'hubspot/objects/harvest.ts',
    'kalup.config.ts',
  ])
  // Besides the project files, the first pull records what the files and the portal agree on in state, and keeps the
  // empty barrel it replaced in history, as every overwrite does.
  expect(listing(dir).filter((file) => !file.startsWith('.kalup/history/'))).toEqual(
    [...files, '.kalup/state/portal-1111111.json'].sort(),
  )
  for (const file of files) {
    expect(text(dir, file), file).toBe(text(golden, file))
  }
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
  const { data } = parseEnvelope<PullData>(pulled.stdout)
  expect(data?.files).toEqual(['hubspot/index.ts', 'hubspot/objects/companies.ts', 'hubspot/objects/harvest.ts'])
  // The first state file of the portal: its path is in the data, and the text names it.
  expect(data?.state).toEqual({ path: join(dir, '.kalup/state/portal-1111111.json'), recorded: 15, serial: 1 })
  expect(biome(dir)).toBe('')
  expect(validateProject(load(dir)).issues).toEqual([])
})

test('the golden fixture passes biome and validates', () => {
  expect(biome(project('inited'))).toBe('')
  expect(validateProject(load(project('inited'))).issues).toEqual([])
})

test('init runs through run(): the binary reaches it and --json prints one envelope', async () => {
  offline()
  const dir = empty()
  const out = await cli(dir, 'init', '--portal', '1111111', '--objects', 'companies,harvest', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<InitData>(out.stdout)
  expect(env.ok).toBe(true)
  expect(env.data?.target).toBe('production')
  expect(out.stderr).toBe('')
})

test('without --portal the target is pending: validate warns, commands that need the portal refuse it, status lists it', async () => {
  const { calls } = offline()
  const dir = empty()
  const out = await run(dir, '--objects', 'companies')
  expect(out.exitCode).toBe(0)
  expect(out.data?.portalId).toBeUndefined()
  expect(text(dir, 'kalup.config.ts')).toBe(
    "import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({\n  objects: {\n    companies: {},\n  },\n  targets: {\n    production: {\n      credentials: { read: { env: 'HUBSPOT_SERVICE_KEY' } },\n    },\n  },\n})\n",
  )
  expect(out.data?.next[0]).toBe(
    'Set targets.production.portalId in kalup.config.ts to the Hub ID from the HubSpot account menu.',
  )
  expect(out.text.split('\n').slice(0, 2)).toEqual([
    'Target production: pending, no portal ID yet: companies',
    'Named the target production. Rename it in kalup.config.ts, or pass --target <name>, if you want another name.',
  ])

  const validated = await cli(dir, 'validate', '--json')
  expect(validated.exitCode).toBe(0)
  expect(parseEnvelope(validated.stdout).issues).toEqual([
    {
      code: 'W_PENDING_TARGET',
      message: "target 'production' has no portalId yet, so no command reads or writes its portal",
      file: 'kalup.config.ts',
      line: 8,
      configPath: 'targets.production',
      fix: 'set targets.production.portalId to the Hub ID from the HubSpot account menu',
      docs: 'errors/W_PENDING_TARGET.md',
    },
  ])
  // The IR holds no pending target: it pins no portal.
  const ir = parseEnvelope<{ targets: object }>((await cli(dir, 'ir', '--json')).stdout)
  expect(ir.data?.targets).toEqual({})
  for (const argv of [['pull'], ['plan'], ['snapshot'], ['compare', 'config', 'production'], ['apply', '--yes']]) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one command at a time as a person runs them
    const refused = await cli(dir, ...argv, '--json')
    expect(refused.exitCode, argv.join(' ')).toBe(3)
    const [issue] = parseEnvelope(refused.stdout).issues
    expect(issue, argv.join(' ')).toMatchObject({
      code: 'E_PENDING_TARGET',
      file: 'kalup.config.ts',
      configPath: 'targets.production',
      fix: 'set targets.production.portalId in kalup.config.ts to the Hub ID from the HubSpot account menu',
    })
  }
  const status = await cli(dir, 'status')
  expect(status.exitCode).toBe(0)
  expect(status.stdout).toContain(
    'Target production: pending, no portalId yet; set targets.production.portalId in kalup.config.ts\n',
  )
  expect(calls).toEqual([])
})

test('existing files: AGENTS.md and CLAUDE.md are appended, biome.json gets the ignores, .gitignore keeps its lines', async () => {
  offline()
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
  expect(out.data?.files).toEqual([
    'kalup.config.ts',
    'hubspot/index.ts',
    '.gitignore',
    'biome.json',
    'AGENTS.md',
    'CLAUDE.md',
  ])
  expect(text(dir, '.gitignore')).toBe('node_modules/\ndist/\n.kalup/\n.env\n')
  expect(JSON.parse(text(dir, 'biome.json'))).toEqual({
    $schema: 'https://biomejs.dev/schemas/2.5.4/schema.json',
    files: { includes: ['**', '!**/node_modules', '!hubspot', '!kalup.config.ts', '!.kalup'] },
    formatter: { indentStyle: 'space' },
  })
  expect(text(dir, 'biome.json').endsWith('\n')).toBe(true)
  expect(text(dir, 'AGENTS.md')).toBe(`# Agents\n\nRun the tests before you push.\n\n${agentsBlock('hubspot')}`)
  expect(text(dir, 'CLAUDE.md')).toBe('# Orchard CRM\n\nSee AGENTS.md for the house rules.\n@AGENTS.md\n')
  expect(existsSync(join(dir, '.prettierignore'))).toBe(false)

  // Run again from scratch in the same directory: everything is present already, so only the config is written.
  const before = Object.fromEntries(
    ['.gitignore', 'biome.json', 'AGENTS.md', 'CLAUDE.md'].map((f) => [f, text(dir, f)]),
  )
  rmSync(join(dir, 'kalup.config.ts'))
  rmSync(join(dir, 'hubspot'), { recursive: true })
  offline()
  const again = await run(dir, '--portal', '1111111', '--objects', 'companies,harvest')
  expect(again.exitCode).toBe(0)
  expect(again.data?.files).toEqual(['kalup.config.ts', 'hubspot/index.ts'])
  for (const [file, content] of Object.entries(before)) {
    expect(text(dir, file), file).toBe(content)
  }
})

test('a .gitignore with /.kalup/ and /.env and a .prettierignore with hubspot/** and /kalup.config.ts already cover the paths, so nothing is appended', async () => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, '.gitignore'), '/.kalup/\n/.env\n')
  writeFileSync(join(dir, '.prettierignore'), 'hubspot/**\n/kalup.config.ts\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toEqual(['kalup.config.ts', 'hubspot/index.ts', 'AGENTS.md', 'CLAUDE.md'])
  expect(text(dir, '.gitignore')).toBe('/.kalup/\n/.env\n')
  expect(text(dir, '.prettierignore')).toBe('hubspot/**\n/kalup.config.ts\n')
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
  offline()
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
  offline()
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
    offline()
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
      'hubspot/index.ts',
      'kalup.config.ts',
    ])
  },
)

test('history holds project files only: a pull and a fmt that overwrite files next to .env never copy it', async () => {
  portal()
  vi.stubEnv('HUBSPOT_SERVICE_KEY', undefined)
  const dir = empty()
  writeFileSync(join(dir, '.env'), `HUBSPOT_SERVICE_KEY=${key}\n`)
  expect((await run(dir, '--portal', '1111111', '--objects', 'companies', '--target', 'sandbox')).exitCode).toBe(0)
  expect((await cli(dir, 'pull')).exitCode).toBe(0)
  // A blank line pull's canonical text drops, then a blank line fmt removes. A label edit would be a config change
  // the pull keeps, since the first pull recorded the base.
  const companies = 'hubspot/objects/companies.ts'
  writeFileSync(join(dir, companies), text(dir, companies).replace('  properties: {\n', '  properties: {\n\n'))
  expect((await cli(dir, 'pull', '--target', 'sandbox')).exitCode).toBe(0)
  writeFileSync(join(dir, 'kalup.config.ts'), `${text(dir, 'kalup.config.ts')}\n`)
  expect((await cli(dir, 'fmt')).exitCode).toBe(0)
  const saved = listing(join(dir, '.kalup/history')).map((file) => file.slice(file.indexOf('/') + 1))
  // The empty barrel init wrote is in history too, from the first pull.
  expect(saved.sort()).toEqual(['hubspot/index.ts', companies, 'kalup.config.ts'])
})

// A monorepo: .git, a .gitignore and a formatter config at the top, and the project two folders down.
function monorepo(files: Record<string, string>): { top: string; dir: string } {
  const top = realpathSync(empty())
  git(top, 'init', '-q')
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(top, file), content)
  }
  const dir = join(top, 'apps', 'crm')
  mkdirSync(dir, { recursive: true })
  return { top, dir }
}

test('in a monorepo, init edits the top .gitignore and biome.json with paths from there, and adds none in the project', async () => {
  const { calls } = offline()
  const { top, dir } = monorepo({
    '.gitignore': 'node_modules/\n',
    'biome.json': '{ "files": { "includes": ["**", "!**/dist"] } }\n',
  })
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(0)
  expect(calls).toEqual([])
  expect(out.data?.files).toEqual([
    'kalup.config.ts',
    'hubspot/index.ts',
    '../../.gitignore',
    '../../biome.json',
    'AGENTS.md',
    'CLAUDE.md',
  ])
  expect(text(top, '.gitignore')).toBe('node_modules/\n/apps/crm/.kalup/\n/apps/crm/.env\n')
  expect(text(top, 'biome.json')).toBe(
    '{ "files": { "includes": ["**", "!**/dist", "!apps/crm/hubspot", "!apps/crm/kalup.config.ts", "!apps/crm/.kalup"] } }\n',
  )
  expect(listing(dir)).toEqual(['AGENTS.md', 'CLAUDE.md', 'hubspot/index.ts', 'kalup.config.ts'])
  // git ignores what init wrote the lines for, and biome, run from the top, leaves the project's files alone.
  writeFileSync(join(dir, '.env'), 'HUBSPOT_SERVICE_KEY=\n')
  mkdirSync(join(dir, '.kalup'))
  writeFileSync(join(dir, '.kalup', 'x.json'), '{}\n')
  expect(git(top, 'status', '--porcelain', '--untracked-files=all', 'apps').split('\n').filter(Boolean).sort()).toEqual(
    ['?? apps/crm/AGENTS.md', '?? apps/crm/CLAUDE.md', '?? apps/crm/hubspot/index.ts', '?? apps/crm/kalup.config.ts'],
  )
  // The app's own code is still checked; hubspot/ and kalup.config.ts, which the writer formats, are not.
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const app = 1;\n')
  writeFileSync(join(dir, 'hubspot', 'index.ts'), "export {} from 'x'   ;\n")
  expect(ownBiome(top, 'apps')).toBe('')
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const app   = 1;\n')
  expect(ownBiome(top, 'apps')).toContain('apps/crm/src/app.ts')
})

test('in a monorepo, a top .gitignore that already ignores .kalup/ and .env at any depth gets no line', async () => {
  offline()
  const { top, dir } = monorepo({ '.gitignore': '.kalup/\n.env*\n' })
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).not.toContain('../../.gitignore')
  expect(text(top, '.gitignore')).toBe('.kalup/\n.env*\n')
  expect(existsSync(join(dir, '.gitignore'))).toBe(false)
  // A top line anchored to the top does not cover the project: the project's own line is added.
  const anchored = monorepo({ '.gitignore': '/.kalup/\n/.env\n' })
  await run(anchored.dir, '--portal', '1111111', '--objects', 'companies')
  expect(text(anchored.top, '.gitignore')).toBe('/.kalup/\n/.env\n/apps/crm/.kalup/\n/apps/crm/.env\n')
})

test('in a monorepo, the nearest .gitignore gets the lines, and a prettier config at the top gets its .prettierignore', async () => {
  offline()
  const { top, dir } = monorepo({ '.gitignore': 'node_modules/\n', '.prettierrc': '{}\n' })
  writeFileSync(join(top, 'apps', '.gitignore'), 'dist/\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toEqual([
    'kalup.config.ts',
    'hubspot/index.ts',
    '../.gitignore',
    '../../.prettierignore',
    'AGENTS.md',
    'CLAUDE.md',
  ])
  expect(text(top, 'apps/.gitignore')).toBe('dist/\n/crm/.kalup/\n/crm/.env\n')
  expect(text(top, '.gitignore')).toBe('node_modules/\n')
  expect(text(top, '.prettierignore')).toBe('apps/crm/hubspot/\napps/crm/kalup.config.ts\n')
})

test('outside a repository init looks at no folder above the project: a .gitignore there is left alone', async () => {
  offline()
  const outer = empty()
  writeFileSync(join(outer, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(outer, 'biome.json'), '{ "files": { "includes": ["**"] } }\n')
  const dir = join(outer, 'crm')
  mkdirSync(dir)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toEqual(['kalup.config.ts', 'hubspot/index.ts', '.gitignore', 'AGENTS.md', 'CLAUDE.md'])
  expect(text(outer, '.gitignore')).toBe('node_modules/\n')
  expect(text(outer, 'biome.json')).toBe('{ "files": { "includes": ["**"] } }\n')
  expect(text(dir, '.gitignore')).toBe('node_modules/\n.kalup/\n.env\n')
})

test('the project name comes from config, else the nearest package.json up to the repository top, else the folder', async () => {
  offline()
  const { top, dir } = monorepo({ 'package.json': '{ "name": "orchard-monorepo", "private": true }\n' })
  expect((await run(dir, '--portal', '1111111', '--objects', 'companies')).exitCode).toBe(0)
  const projectName = async () =>
    parseEnvelope<{ project: string }>((await cli(dir, 'ir', '--json')).stdout).data?.project
  expect(await projectName()).toBe('orchard-monorepo')
  writeFileSync(join(dir, 'package.json'), '{ "name": "@orchard/crm" }\n')
  expect(await projectName()).toBe('@orchard/crm')
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    text(dir, 'kalup.config.ts').replace('defineConfig({\n', "defineConfig({\n  name: 'orchard-crm',\n"),
  )
  expect(await projectName()).toBe('orchard-crm')
  const plain = empty()
  expect((await run(plain, '--portal', '1111111', '--objects', 'companies')).exitCode).toBe(0)
  const folder = parseEnvelope<{ project: string }>((await cli(plain, 'ir', '--json')).stdout).data?.project
  expect(folder).toBe(plain.split('/').at(-1))
  expect(top).not.toBe(dir)
})

test('a .prettierignore that covers hubspot/ only gets the kalup.config.ts line', async () => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, '.prettierignore'), 'hubspot/\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toContain('.prettierignore')
  expect(text(dir, '.prettierignore')).toBe('hubspot/\nkalup.config.ts\n')
})

test('a biome.json with no files.includes gets ** and the ignores', async () => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), '{"formatter":{"enabled":true}}')
  await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(JSON.parse(text(dir, 'biome.json'))).toEqual({
    formatter: { enabled: true },
    files: { includes: ['**', '!hubspot', '!kalup.config.ts', '!.kalup'] },
  })
})

test.each([
  ['!hubspot', '"!kalup.config.ts", "!.kalup"'],
  ['!hubspot/**', '"!kalup.config.ts", "!.kalup"'],
  ['!!hubspot', '"!kalup.config.ts", "!.kalup"'],
  ['!!hubspot/**', '"!kalup.config.ts", "!.kalup"'],
  ['!kalup.config.ts', '"!hubspot", "!.kalup"'],
  ['!!kalup.config.ts', '"!hubspot", "!.kalup"'],
  ['!.kalup/**', '"!hubspot", "!kalup.config.ts"'],
])('a biome.json with %s already ignores that path, so only %s is added', async (present, added) => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), `{ "files": { "includes": ["**", "${present}"] } }\n`)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toContain('biome.json')
  expect(text(dir, 'biome.json')).toBe(`{ "files": { "includes": ["**", "${present}", ${added}] } }\n`)
})

test('a biome.json that ignores all three paths already is left as it was', async () => {
  offline()
  const dir = empty()
  const before = '{ "files": { "includes": ["**", "!!hubspot/**", "!kalup.config.ts", "!!.kalup"] } }\n'
  writeFileSync(join(dir, 'biome.json'), before)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).not.toContain('biome.json')
  expect(text(dir, 'biome.json')).toBe(before)
})

test('a biome.json that does not parse stops init before any request or write, and runs once fixed', async () => {
  const { calls } = offline()
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
  offline()
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
  expect(text(dir, 'biome.jsonc')).toBe(jsonc('"**", "!**/*.gen.ts", "!hubspot", "!kalup.config.ts", "!.kalup"'))
  expect(existsSync(join(dir, '.prettierignore'))).toBe(false)
  expect(out.text).not.toContain('No biome.json or prettier config found.')
})

// biome's own check, with the config in `dir`, on `path` there. The golden tests use the repo's config instead. A
// warning fails it too: biome warns on `!hubspot/**`, as it takes `!hubspot` for a folder. The real path, because biome
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
      '{\n\t"$schema": "https://biomejs.dev/schemas/2.5.4/schema.json",\n\t"files": {\n\t\t"ignoreUnknown": false,\n\t\t"includes": ["**", "!hubspot", "!kalup.config.ts", "!.kalup"]\n\t},\n\t"formatter": {\n\t\t"enabled": true,\n\t\t"indentStyle": "tab"\n\t}\n}\n',
  },
  {
    name: 'includes on one line',
    file: 'biome.jsonc',
    before: '{\n\t"files": { "includes": ["**"] }\n}\n',
    after: '{\n\t"files": { "includes": ["**", "!hubspot", "!kalup.config.ts", "!.kalup"] }\n}\n',
  },
  {
    name: 'a missing files',
    file: 'biome.json',
    before: '{\n\t"formatter": { "indentStyle": "tab" }\n}\n',
    after:
      '{\n\t"formatter": { "indentStyle": "tab" },\n\t"files": { "includes": ["**", "!hubspot", "!kalup.config.ts", "!.kalup"] }\n}\n',
  },
  // Each new entry gets its own line, after the comment on the last one's line.
  {
    name: 'one entry per line',
    file: 'biome.jsonc',
    before:
      '{\n  "formatter": { "indentStyle": "space" },\n  "files": {\n    "includes": [\n      "**",\n      "!**/dist" // the build output\n    ]\n  }\n}\n',
    after:
      '{\n  "formatter": { "indentStyle": "space" },\n  "files": {\n    "includes": [\n      "**",\n      "!**/dist", // the build output\n      "!hubspot",\n      "!kalup.config.ts",\n      "!.kalup"\n    ]\n  }\n}\n',
  },
  // The same with CRLF line breaks: each new entry gets its own \r\n line.
  {
    name: 'one entry per line, CRLF',
    file: 'biome.jsonc',
    before:
      '{\r\n  "formatter": { "indentStyle": "space", "lineEnding": "crlf" },\r\n  "files": {\r\n    "includes": [\r\n      "**",\r\n      "!**/dist" // the build output\r\n    ]\r\n  }\r\n}\r\n',
    after:
      '{\r\n  "formatter": { "indentStyle": "space", "lineEnding": "crlf" },\r\n  "files": {\r\n    "includes": [\r\n      "**",\r\n      "!**/dist", // the build output\r\n      "!hubspot",\r\n      "!kalup.config.ts",\r\n      "!.kalup"\r\n    ]\r\n  }\r\n}\r\n',
  },
])('the edited biome config passes its own biome check: $name', async ({ file, before, after }) => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, file), before)
  expect(ownBiome(dir, file), before).toBe('')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files, before).toContain(file)
  expect(text(dir, file)).toBe(after)
  expect(ownBiome(dir, file), after).toBe('')
})

test('a project on the biome init config passes its own biome check right after init: hubspot/ and kalup.config.ts are out', async () => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), biomeInit)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(0)
  expect(existsSync(join(dir, 'hubspot/index.ts'))).toBe(true)
  expect(ownBiome(dir, '.')).toBe('')
})

test('with biome.json and biome.jsonc both there, biome.json gets the ignores, as biome reads that one', async () => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), '{ "files": { "includes": ["**"] } }\n')
  writeFileSync(join(dir, 'biome.jsonc'), '{ "files": { "includes": ["**"] } }\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toEqual([
    'kalup.config.ts',
    'hubspot/index.ts',
    '.gitignore',
    'biome.json',
    'AGENTS.md',
    'CLAUDE.md',
  ])
  expect(text(dir, 'biome.json')).toBe(
    '{ "files": { "includes": ["**", "!hubspot", "!kalup.config.ts", "!.kalup"] } }\n',
  )
  expect(text(dir, 'biome.jsonc')).toBe('{ "files": { "includes": ["**"] } }\n')
})

test('a biome.json with a comment stops init before any request or write: biome reads biome.json as plain JSON', async () => {
  const { calls } = offline()
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
  const { calls } = offline()
  const dir = empty()
  writeFileSync(join(dir, file), content)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode, content).toBe(0)
  expect(out.data?.files, content).toEqual([
    'kalup.config.ts',
    'hubspot/index.ts',
    '.gitignore',
    'AGENTS.md',
    'CLAUDE.md',
  ])
  expect(text(dir, file)).toBe(content)
  expect(out.text).toContain(`${file} was left alone`)
  expect(out.text).toContain('!hubspot, !kalup.config.ts and !.kalup')
  expect(calls).toEqual([])
})

test.each([
  ['CLAUDE.md', 'AGENTS.md'],
  ['AGENTS.md', 'CLAUDE.md'],
])('a %s linked to %s stays a link and gets no pointer to itself', async (link, file) => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, file), '# House rules\n')
  symlinkSync(file, join(dir, link))
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode, link).toBe(0)
  expect(out.data?.files, link).toEqual(['kalup.config.ts', 'hubspot/index.ts', '.gitignore', 'AGENTS.md'])
  expect(text(dir, file), link).toBe(`# House rules\n\n${agentsBlock('hubspot')}`)
  expect(lstatSync(join(dir, link)).isSymbolicLink(), link).toBe(true)
})

test.each([
  ['.prettierrc', '{}\n'],
  ['.prettierrc.json', '{}\n'],
  ['prettier.config.mjs', 'export default {}\n'],
  ['package.json', '{"name":"orchard","prettier":{}}\n'],
])(
  'without biome.json, a prettier config in %s gets hubspot/ and kalup.config.ts in .prettierignore',
  async (file, content) => {
    offline()
    const dir = empty()
    writeFileSync(join(dir, file), content)
    const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
    expect(out.data?.files, file).toContain('.prettierignore')
    expect(text(dir, '.prettierignore'), file).toBe('hubspot/\nkalup.config.ts\n')
    expect(out.text, file).not.toContain('No biome.json or prettier config found.')
  },
)

test('without biome.json, an existing .prettierignore is appended to, and with no prettier config a note is printed', async () => {
  // An existing .prettierignore is the config, and is appended to.
  offline()
  const existing = empty()
  writeFileSync(join(existing, '.prettierignore'), 'dist')
  const out = await run(existing, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toContain('.prettierignore')
  expect(text(existing, '.prettierignore')).toBe('dist\nhubspot/\nkalup.config.ts\n')

  // A package.json without the key is not one: no stray file, the note.
  offline()
  const bare = empty()
  writeFileSync(join(bare, 'package.json'), '{"name":"orchard"}\n')
  const none = await run(bare, '--portal', '1111111', '--objects', 'companies')
  expect(none.exitCode).toBe(0)
  expect(existsSync(join(bare, '.prettierignore'))).toBe(false)
  expect(none.text).toContain('No biome.json or prettier config found.')
  expect(none.text).toContain('ignore hubspot/ and kalup.config.ts in it')
})

// The shape npm writes, a tab-indented file, a CRLF one, and one with no final line break and no dependencies yet.
test.each([
  {
    name: 'two spaces, dependencies out of order',
    before:
      '{\n  "name": "orchard-app",\n  "dependencies": {\n    "zebra-grid": "^2.0.0",\n    "@orchard/ui": "^1.0.0"\n  },\n  "scripts": {\n    "build": "tsc"\n  }\n}\n',
    after: `{\n  "name": "orchard-app",\n  "dependencies": {\n    "@kalup/core": "${coreRange}",\n    "@orchard/ui": "^1.0.0",\n    "zebra-grid": "^2.0.0"\n  },\n  "scripts": {\n    "build": "tsc"\n  }\n}\n`,
  },
  {
    name: 'tabs',
    before: '{\n\t"name": "orchard-app",\n\t"dependencies": {\n\t\t"zebra-grid": "^2.0.0"\n\t}\n}\n',
    after: `{\n\t"name": "orchard-app",\n\t"dependencies": {\n\t\t"@kalup/core": "${coreRange}",\n\t\t"zebra-grid": "^2.0.0"\n\t}\n}\n`,
  },
  {
    name: 'CRLF',
    before: '{\r\n    "name": "orchard-app",\r\n    "private": true\r\n}\r\n',
    after: `{\r\n    "name": "orchard-app",\r\n    "private": true,\r\n    "dependencies": {\r\n        "@kalup/core": "${coreRange}"\r\n    }\r\n}\r\n`,
  },
  {
    name: 'no dependencies and no final line break',
    before: '{"name":"orchard-app","devDependencies":{"kalup":"^0.1.0"}}',
    after: `{\n  "name": "orchard-app",\n  "devDependencies": {\n    "kalup": "^0.1.0"\n  },\n  "dependencies": {\n    "@kalup/core": "${coreRange}"\n  }\n}`,
  },
])(
  'a package.json without @kalup/core gets it in dependencies, in its own format: $name',
  async ({ before, after }) => {
    offline()
    const dir = empty()
    writeFileSync(join(dir, 'package.json'), before)
    const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
    expect(out.exitCode).toBe(0)
    expect(text(dir, 'package.json')).toBe(after)
    expect(out.data?.files).toEqual([
      'kalup.config.ts',
      'hubspot/index.ts',
      '.gitignore',
      'AGENTS.md',
      'CLAUDE.md',
      'package.json',
    ])
    expect(out.data?.packageJson).toEqual({ added: true, found: true, manager: 'npm' })
    expect(out.text.split('\n').filter((line) => line.includes('package.json'))).toMatchInlineSnapshot(`
    [
      "wrote package.json",
      "  Added @kalup/core to dependencies in package.json: run npm install.",
    ]
  `)
    // The install step comes right before the first pull, the last step.
    expect(out.data?.next.slice(-2)).toEqual([
      'Added @kalup/core to dependencies in package.json: run npm install.',
      'Run npx kalup pull to write the object files from the portal.',
    ])
  },
)

test.each(['dependencies', 'devDependencies', 'peerDependencies'])(
  'a package.json with @kalup/core in %s is left as it was, with no install step',
  async (list) => {
    offline()
    const dir = empty()
    const before = `{\n  "name": "orchard-app",\n  "${list}": {\n    "@kalup/core": "^0.1.0"\n  }\n}\n`
    writeFileSync(join(dir, 'package.json'), before)
    const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
    expect(out.exitCode).toBe(0)
    expect(text(dir, 'package.json')).toBe(before)
    expect(out.data?.files).not.toContain('package.json')
    expect(out.data?.packageJson).toEqual({ added: false, found: true, manager: 'npm' })
    expect(out.text).not.toContain('@kalup/core')
  },
)

test('with no package.json, init creates none and says to install @kalup/core in the app', async () => {
  offline()
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.exitCode).toBe(0)
  expect(existsSync(join(dir, 'package.json'))).toBe(false)
  expect(out.data?.packageJson).toEqual({ added: false, found: false, manager: 'npm' })
  expect(out.data?.next.at(-2)).toMatchInlineSnapshot(
    `"No package.json here. The files under hubspot/ import @kalup/core: install it in your app with npm install @kalup/core."`,
  )
})

test.each(['[]\n', '{"name": "orchard-app",}\n', '{"name": "orchard-app", "dependencies": ["@orchard/ui"]}\n'])(
  'a package.json init cannot read dependencies in is left alone, with the install step: %j',
  async (before) => {
    offline()
    const dir = empty()
    writeFileSync(join(dir, 'package.json'), before)
    const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
    expect(out.exitCode, before).toBe(0)
    expect(text(dir, 'package.json')).toBe(before)
    expect(out.data?.packageJson).toEqual({ added: false, found: true, manager: 'npm' })
    expect(out.data?.next.at(-2)).toMatchInlineSnapshot(
      `"package.json was left alone: init could not read its dependencies. Install @kalup/core in your app with npm install @kalup/core."`,
    )
  },
)

test.each([
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
])('a %s names the package manager in the install step: %s, whatever runs init', async (lockfile, manager) => {
  offline()
  vi.stubEnv('npm_config_user_agent', 'yarn/4.5.0 npm/? node/v22.13.1 darwin arm64')
  const dir = empty()
  writeFileSync(join(dir, 'package.json'), '{ "name": "orchard-app" }\n')
  writeFileSync(join(dir, lockfile), '')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.packageJson).toEqual({ added: true, found: true, manager })
  expect(out.text).toContain(`Added @kalup/core to dependencies in package.json: run ${manager} install.\n`)
})

test('in a workspace package, the lockfile at the workspace root names the manager, whatever runs init', async () => {
  offline()
  vi.stubEnv('npm_config_user_agent', 'npm/10.9.0 node/v22.13.1 darwin arm64')
  const workspace = empty()
  writeFileSync(join(workspace, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
  writeFileSync(join(workspace, 'pnpm-lock.yaml'), '')
  const dir = join(workspace, 'apps/web')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{ "name": "orchard-web" }\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.packageJson).toEqual({ added: true, found: true, manager: 'pnpm' })
  expect(out.text).toContain('Added @kalup/core to dependencies in package.json: run pnpm install.\n')
})

test('the search for a lockfile stops at the directory with .git', async () => {
  offline()
  const above = empty()
  writeFileSync(join(above, 'yarn.lock'), '')
  const dir = join(above, 'orchard-app')
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{ "name": "orchard-app" }\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.packageJson.manager).toBe('npm')
})

test('with no lockfile, the packageManager field in package.json names the manager before the user agent', async () => {
  offline()
  vi.stubEnv('npm_config_user_agent', 'npm/10.9.0 node/v22.13.1 darwin arm64')
  const dir = empty()
  writeFileSync(join(dir, 'package.json'), '{ "name": "orchard-app", "packageManager": "yarn@4.5.0" }\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.packageJson).toEqual({ added: true, found: true, manager: 'yarn' })
  expect(out.text).toContain('run yarn install.\n')
})

test.each([
  ['pnpm/9.12.0 npm/? node/v22.13.1 darwin arm64', 'pnpm', 'pnpm add @kalup/core'],
  ['bun/1.2.0 npm/? node/v22.13.1 darwin arm64', 'bun', 'bun add @kalup/core'],
  ['npm/10.9.0 node/v22.13.1 darwin arm64', 'npm', 'npm install @kalup/core'],
  ['deno/2.0.0 npm/? deno/2.0.0 darwin arm64', 'npm', 'npm install @kalup/core'],
  ['', 'npm', 'npm install @kalup/core'],
])('with no lockfile, npm_config_user_agent %j names the manager: %s', async (agent, manager, install) => {
  offline()
  vi.stubEnv('npm_config_user_agent', agent)
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.packageJson.manager).toBe(manager)
  expect(out.text).toContain(`install it in your app with ${install}.\n`)
})

test('--json: data.packageJson says what init did to package.json, and files lists it', async () => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, 'package.json'), '{ "name": "orchard-app" }\n')
  writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
  const out = await cli(dir, 'init', '--portal', '1111111', '--objects', 'companies', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<InitData>(out.stdout)
  expect(env.data?.packageJson).toEqual({ added: true, found: true, manager: 'pnpm' })
  expect(env.data?.files).toContain('package.json')
  expect(JSON.parse(text(dir, 'package.json'))).toEqual({
    name: 'orchard-app',
    dependencies: { '@kalup/core': coreRange },
  })
})

test('init --dir puts the object files, the barrel and the formatter ignores in that folder and records it in config', async () => {
  offline()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), '{ "files": { "includes": ["**"] } }\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies', '--dir', './lib/config/hubspot/')
  expect(out.exitCode).toBe(0)
  expect(text(dir, 'kalup.config.ts')).toContain("export default defineConfig({\n  dir: 'lib/config/hubspot',\n")
  expect(listing(dir).filter((file) => file.startsWith('lib/'))).toEqual(['lib/config/hubspot/index.ts'])
  expect(existsSync(join(dir, 'hubspot'))).toBe(false)
  expect(out.data?.files).toContain('lib/config/hubspot/index.ts')
  expect(text(dir, 'biome.json')).toBe(
    '{ "files": { "includes": ["**", "!lib/config/hubspot", "!kalup.config.ts", "!.kalup"] } }\n',
  )
  expect(text(dir, 'AGENTS.md')).toBe(agentsBlock('lib/config/hubspot'))
  // Every later command finds the folder through config.
  const status = await cli(dir, 'validate', '--json')
  expect(status.exitCode).toBe(0)
  expect(parseEnvelope(status.stdout).issues).toEqual([])
  portal()
  const pulled = await cli(dir, 'pull', '--json')
  expect(pulled.exitCode).toBe(0)
  expect(parseEnvelope<PullData>(pulled.stdout).data?.files).toContain('lib/config/hubspot/objects/companies.ts')

  offline()
  const prettier = empty()
  writeFileSync(join(prettier, '.prettierrc'), '{}\n')
  expect((await run(prettier, '--portal', '1111111', '--objects', 'companies', '--dir', 'config')).exitCode).toBe(0)
  expect(text(prettier, '.prettierignore')).toBe('config/\nkalup.config.ts\n')
})

test.each(['/srv/hubspot', '../shared', '.'])(
  'init --dir %s is a usage error before any request or write',
  async (given) => {
    const { calls } = offline()
    const dir = empty()
    const out = await run(dir, '--portal', '1111111', '--dir', given)
    expect(out.exitCode).toBe(1)
    expect(out.issues.map((issue) => issue.code)).toEqual(['E_USAGE'])
    expect(out.issues[0]?.message).toBe(
      `--dir needs a folder inside the project, such as lib/config/hubspot, not '${given}'`,
    )
    expect(calls).toEqual([])
    expect(listing(dir)).toEqual([])
  },
)

test("init refuses a folder holding files that are not Kalup's, and writes nothing", async () => {
  const { calls } = offline()
  const dir = empty()
  mkdirSync(join(dir, 'lib/config'), { recursive: true })
  writeFileSync(join(dir, 'lib/config/index.ts'), 'export const appConfig = { port: 3000 }\n')
  writeFileSync(join(dir, 'biome.json'), '{ "files": { "includes": ["**"] } }\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies', '--dir', 'lib/config')
  expect(out.exitCode).toBe(1)
  expect(out.issues).toEqual([
    {
      code: 'E_DIR_IN_USE',
      message:
        "lib/config/index.ts is not a kalup file, and lib/config/ must hold kalup's files only. Nothing was written.",
      file: 'lib/config/index.ts',
      fix: 'pass --dir with a folder of its own, such as lib/config/hubspot',
    },
  ])
  expect(calls).toEqual([])
  expect(listing(dir)).toEqual(['biome.json', 'lib/config/index.ts'])
  expect(text(dir, 'lib/config/index.ts')).toBe('export const appConfig = { port: 3000 }\n')
  expect(text(dir, 'biome.json')).toBe('{ "files": { "includes": ["**"] } }\n')

  // The default folder too: a module there, or a file named hubspot, is not Kalup's.
  const other = empty()
  mkdirSync(join(other, 'hubspot/src'), { recursive: true })
  writeFileSync(join(other, 'hubspot/src/card.ts'), 'export function card() {}\n')
  const refused = await run(other, '--portal', '1111111')
  expect(refused.issues).toMatchObject([
    {
      code: 'E_DIR_IN_USE',
      file: 'hubspot/src/card.ts',
      fix: 'pass --dir with a folder of its own, such as lib/config/hubspot',
    },
  ])
  const file = empty()
  writeFileSync(join(file, 'hubspot'), 'not a folder\n')
  expect((await run(file, '--portal', '1111111')).issues).toMatchObject([{ code: 'E_DIR_IN_USE', file: 'hubspot' }])
})

test('init keeps the object files and barrel a previous init and pull wrote', async () => {
  const dir = empty()
  offline()
  expect(
    (await run(dir, '--portal', '1111111', '--objects', 'companies,harvest', '--target', 'sandbox')).exitCode,
  ).toBe(0)
  portal()
  expect((await cli(dir, 'pull')).exitCode).toBe(0)
  const barrel = text(dir, 'hubspot/index.ts')
  expect(barrel).not.toBe('export {}\n')
  rmSync(join(dir, 'kalup.config.ts'))
  offline()
  const again = await run(dir, '--portal', '1111111', '--objects', 'companies,harvest', '--target', 'sandbox')
  expect(again.exitCode).toBe(0)
  expect(again.data?.files).toEqual(['kalup.config.ts'])
  expect(text(dir, 'hubspot/index.ts')).toBe(barrel)
})

test('init refuses when kalup.config.ts exists and sends nothing', async () => {
  const { calls } = offline()
  const dir = copy('valid')
  const before = listing(dir)
  const out = await run(dir, '--portal', '1111111')
  expect(out.exitCode).toBe(1)
  expect(out.issues[0]).toMatchObject({ code: 'E_CONFIG_EXISTS', file: 'kalup.config.ts' })
  expect(calls).toEqual([])
  expect(listing(dir)).toEqual(before)
})

test('the target is production unless --target names it; init writes no protected and no defaultTarget', async () => {
  offline()
  const plain = empty()
  const out = await run(plain, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.target).toBe('production')
  expect(text(plain, 'kalup.config.ts')).toContain('  targets: {\n    production: {\n      portalId: 1111111,\n')
  expect(out.text).toContain('Named the target production.')
  // Protection follows the account type when config is silent: plan finds it out, init cannot.
  expect(text(plain, 'kalup.config.ts')).not.toContain('protected')
  expect(text(plain, 'kalup.config.ts')).not.toContain('defaultTarget')

  const named = empty()
  const acme = await run(named, '--portal', '1111111', '--objects', 'companies,harvest', '--target', 'acme-prod')
  expect(acme.exitCode).toBe(0)
  expect(acme.data?.target).toBe('acme-prod')
  expect(text(named, 'kalup.config.ts')).toContain("  targets: {\n    'acme-prod': {\n      portalId: 1111111,\n")
  expect(acme.text).not.toContain('Named the target')
  // The first pull needs no flag: it is the only target.
  portal()
  const pulled = await cli(named, 'pull')
  expect(pulled.exitCode).toBe(0)
  expect(pulled.stdout.startsWith('Target acme-prod, portal 1111111 (the only target)\n')).toBe(true)
  expect(pulled.stdout).toContain('State for portal 1111111 is new: .kalup/state/portal-1111111.json\n')
})

test('the default objects are contacts, companies and deals, each with its own read scope', async () => {
  offline()
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
  expect(text(dir, 'kalup.config.ts')).toContain(
    '  objects: {\n    contacts: {},\n    companies: {},\n    deals: { pipelines: true },\n  },\n',
  )
})

test('the scope printed for products is one HubSpot lists: e-commerce, not crm.schemas.products.read', async () => {
  offline()
  const out = await run(empty(), '--portal', '1111111', '--objects', 'products')
  expect(out.exitCode).toBe(0)
  expect(out.data?.scopes.map((s) => s.scope)).toEqual(['e-commerce'])
  expect(out.text).toContain('  e-commerce (products)\n')
  expect(out.data?.writeScopes.map((s) => s.scope)).toEqual(['e-commerce'])
  // Products are not companies, contacts or deals, so the recommended scope falls back to companies.
  expect(out.data?.recommended.scope).toBe('crm.objects.companies.read')
})

test('the first pull writing more than 200 properties into a new file warns, pointing at include, and does not stop', async () => {
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
  expect((await run(dir, '--portal', '1111111', '--objects', 'companies')).exitCode).toBe(0)
  const out = parseEnvelope<PullData>((await cli(dir, 'pull', '--json')).stdout)
  expect(out.ok).toBe(true)
  expect(out.issues).toContainEqual({
    code: 'W_LARGE_SCOPE',
    message:
      'the pull wrote 201 properties into the new file for companies: every custom property is in the pull scope',
    configPath: 'objects.companies',
    fix: 'set objects.companies.custom to false, then delete the properties the app does not need from hubspot/objects/companies.ts',
    docs: 'errors/W_LARGE_SCOPE.md',
  })
  expect(existsSync(join(dir, 'hubspot/objects/companies.ts'))).toBe(true)
  // Once the file exists, a later pull does not warn again.
  const later = parseEnvelope((await cli(dir, 'pull', '--json')).stdout)
  expect(later.issues.map((issue) => issue.code)).not.toContain('W_LARGE_SCOPE')

  portal(orchard())
  const small = empty()
  expect((await run(small, '--portal', '1111111', '--objects', 'companies')).exitCode).toBe(0)
  const pulled = parseEnvelope((await cli(small, 'pull', '--json')).stdout)
  expect(pulled.issues.map((issue) => issue.code)).not.toContain('W_LARGE_SCOPE')
})

test.each([
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
  'usage errors: --portal is a positive integer, --objects names something, config is no target name: %j',
  async (argv, message) => {
    const { calls } = offline()
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
  const { calls } = offline()
  const dir = empty()
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies', '--target', '')
  expect(out.exitCode).toBe(1)
  expect(out.issues[0]).toMatchObject({ code: 'E_USAGE', message: 'Flag --target expects a value' })
  expect(calls).toEqual([])
  expect(listing(dir)).toEqual([])
})

test('a key in .env leaves the key step out, and init never prints it', async () => {
  const { calls } = offline()
  const dir = empty()
  writeFileSync(join(dir, '.env'), `HUBSPOT_SERVICE_KEY=${key}\n`)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies', '--json')
  expect(out.exitCode).toBe(0)
  expect(out.data?.next).toEqual([
    'No package.json here. The files under hubspot/ import @kalup/core: install it in your app with npm install @kalup/core.',
    'Run npx kalup pull to write the object files from the portal.',
  ])
  const printed: string[] = [out.text, JSON.stringify(out.data), JSON.stringify(out.issues)]
  printEnvelope(envelope(true, out.data, out.issues), { write: (line: string) => printed.push(line) })
  expect(printed.join('\n')).not.toContain(key)
  expect(calls).toEqual([])
})
