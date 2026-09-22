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
import { validate as validateProject } from '@kalup/core'
import { afterEach, expect, test, vi } from 'vitest'
import { parseArgs } from '../../src/commands/args.js'
import { type InitData, init } from '../../src/commands/init.js'
import type { PullData } from '../../src/commands/pull.js'
import { cli, copy, empty, parseEnvelope, project } from '../../src/commands/testing.js'
import type { Fetch } from '../../src/lib/http.js'
import { load } from '../../src/lib/load.js'
import { envelope, type Issue, KalupError, printEnvelope } from '../../src/lib/output.js'
import { agentsBlock } from '../../src/lib/templates/agents.js'
import { fakeFetch, fixture, jsonResponse } from '../../src/lib/testing.js'
import { built } from '../../src/usage.js'

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
  const fetch: Fetch = (url, options) => {
    const { pathname } = new URL(url)
    calls.push(`${options.method ?? 'GET'} ${pathname}`)
    const body = bodies[pathname]
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
  error?: KalupError
  exitCode: number
  issues: Issue[]
  text: string
}

// init through the parser and the command, as run() calls them. The runner's envelope and printing are its own tests'.
async function run(dir: string, ...argv: string[]): Promise<Outcome> {
  try {
    const { flags } = parseArgs(['init', ...argv])
    const result = await init({ cwd: dir, flags })
    return { exitCode: result.exitCode ?? 0, data: result.data, issues: result.issues ?? [], text: result.text ?? '' }
  } catch (error) {
    if (!(error instanceof KalupError)) {
      throw error
    }
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
    'CLAUDE.md',
    'kalup.config.ts',
    'kalup/index.ts',
    'kalup/objects/companies.ts',
    'kalup/objects/harvest.ts',
  ])
  expect(listing(dir)).toEqual(files)
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
    'GET /crm/properties/2026-09/companies/groups',
    'GET /crm/properties/2026-09/2-4242001',
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
  expect(out.text).toContain('Portal 1111111: SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana\n')
  expect(out.text).toContain('Target sandbox: companies, harvest\n')
  expect(out.text).toContain(
    'Read scopes the key in HUBSPOT_SERVICE_KEY needs (Development > Keys > Service keys, see https://',
  )
  expect(out.text).toContain('  crm.schemas.companies.read (companies)\n  crm.schemas.custom.read (harvest)\n')
  for (const file of files) {
    expect(out.text).toContain(`wrote ${file}\n`)
  }
  // No formatter in an empty directory: no stray ignore file, one note.
  expect(out.text).toContain('No biome.json or prettier config found.')
  expect(out.text).toContain('companies: 10 added, 0 changed, 0 unchanged, 0 missing in portal\n')
  // Nothing existed before, so no history was written. CLAUDE.md is created from nothing, as the one pointer line.
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
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
  expect(text(dir, '.gitignore')).toBe('node_modules/\ndist/\n.kalup/\n')
  expect(JSON.parse(text(dir, 'biome.json'))).toEqual({
    $schema: 'https://biomejs.dev/schemas/2.5.4/schema.json',
    files: { includes: ['**', '!**/node_modules', '!kalup', '!kalup.config.ts'] },
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

test('a .gitignore with /.kalup/ and a .prettierignore with kalup/** and /kalup.config.ts already cover the paths, so nothing is appended', async () => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, '.gitignore'), '/.kalup/\n')
  writeFileSync(join(dir, '.prettierignore'), 'kalup/**\n/kalup.config.ts\n')
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toEqual(['kalup.config.ts', 'AGENTS.md', 'CLAUDE.md'])
  expect(text(dir, '.gitignore')).toBe('/.kalup/\n')
  expect(text(dir, '.prettierignore')).toBe('kalup/**\n/kalup.config.ts\n')
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
    files: { includes: ['**', '!kalup', '!kalup.config.ts'] },
  })
})

test.each([
  ['!kalup', '"!kalup.config.ts"'],
  ['!kalup/**', '"!kalup.config.ts"'],
  ['!!kalup', '"!kalup.config.ts"'],
  ['!!kalup/**', '"!kalup.config.ts"'],
  ['!kalup.config.ts', '"!kalup"'],
  ['!!kalup.config.ts', '"!kalup"'],
])('a biome.json with %s already ignores that path, so only %s is added', async (present, added) => {
  portal()
  const dir = empty()
  writeFileSync(join(dir, 'biome.json'), `{ "files": { "includes": ["**", "${present}"] } }\n`)
  const out = await run(dir, '--portal', '1111111', '--objects', 'companies')
  expect(out.data?.files).toContain('biome.json')
  expect(text(dir, 'biome.json')).toBe(`{ "files": { "includes": ["**", "${present}", ${added}] } }\n`)
})

test('a biome.json that ignores both paths already is left as it was', async () => {
  portal()
  const dir = empty()
  const before = '{ "files": { "includes": ["**", "!!kalup/**", "!kalup.config.ts"] } }\n'
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
  expect(text(dir, 'biome.jsonc')).toBe(jsonc('"**", "!**/*.gen.ts", "!kalup", "!kalup.config.ts"'))
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
      '{\n\t"$schema": "https://biomejs.dev/schemas/2.5.4/schema.json",\n\t"files": {\n\t\t"ignoreUnknown": false,\n\t\t"includes": ["**", "!kalup", "!kalup.config.ts"]\n\t},\n\t"formatter": {\n\t\t"enabled": true,\n\t\t"indentStyle": "tab"\n\t}\n}\n',
  },
  {
    name: 'includes on one line',
    file: 'biome.jsonc',
    before: '{\n\t"files": { "includes": ["**"] }\n}\n',
    after: '{\n\t"files": { "includes": ["**", "!kalup", "!kalup.config.ts"] }\n}\n',
  },
  {
    name: 'a missing files',
    file: 'biome.json',
    before: '{\n\t"formatter": { "indentStyle": "tab" }\n}\n',
    after:
      '{\n\t"formatter": { "indentStyle": "tab" },\n\t"files": { "includes": ["**", "!kalup", "!kalup.config.ts"] }\n}\n',
  },
  // Each new entry gets its own line, after the comment on the last one's line.
  {
    name: 'one entry per line',
    file: 'biome.jsonc',
    before:
      '{\n  "formatter": { "indentStyle": "space" },\n  "files": {\n    "includes": [\n      "**",\n      "!**/dist" // the build output\n    ]\n  }\n}\n',
    after:
      '{\n  "formatter": { "indentStyle": "space" },\n  "files": {\n    "includes": [\n      "**",\n      "!**/dist", // the build output\n      "!kalup",\n      "!kalup.config.ts"\n    ]\n  }\n}\n',
  },
  // The same with CRLF line breaks: each new entry gets its own \r\n line.
  {
    name: 'one entry per line, CRLF',
    file: 'biome.jsonc',
    before:
      '{\r\n  "formatter": { "indentStyle": "space", "lineEnding": "crlf" },\r\n  "files": {\r\n    "includes": [\r\n      "**",\r\n      "!**/dist" // the build output\r\n    ]\r\n  }\r\n}\r\n',
    after:
      '{\r\n  "formatter": { "indentStyle": "space", "lineEnding": "crlf" },\r\n  "files": {\r\n    "includes": [\r\n      "**",\r\n      "!**/dist", // the build output\r\n      "!kalup",\r\n      "!kalup.config.ts"\r\n    ]\r\n  }\r\n}\r\n',
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
  expect(text(dir, 'biome.json')).toBe('{ "files": { "includes": ["**", "!kalup", "!kalup.config.ts"] } }\n')
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
  expect(out.text).toContain(
    `${file} was left alone: init could not read files.includes in it. Add !kalup and !kalup.config.ts to files.includes yourself`,
  )
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
  },
)

test('the default objects are contacts, companies and deals, each with its own read scope', async () => {
  const bodies = orchard()
  for (const route of [routes.contacts, routes.deals]) {
    bodies[route] = fixture('api/orchard/companies.properties.json')
  }
  for (const route of [routes.contactGroups, routes.dealGroups]) {
    bodies[route] = fixture('api/orchard/companies.groups.json')
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
  const { calls } = portal({ ...orchard(), [routes.account]: { ...fixture('account-info.json'), portalId: 2_222_222 } })
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
  expect(listing(dir)).toEqual(['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'kalup.config.ts', 'kalup/index.ts'])
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

test.each([
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
