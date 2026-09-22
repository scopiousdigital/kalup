import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import { broken, cli, copy, empty, parseEnvelope, project } from '../../src/commands/testing.js'
import { fakeFetch } from '../../src/lib/testing.js'
import { bin, disclaimer, usage, version, versionText } from '../../src/usage.js'

const key = 'kalup-test-secret-9f2c'
const oneUnexpectedLine = /^E_UNEXPECTED: [^\n]+\n$/

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test.each([[[]], [['--help']], [['-h']], [['validate', '--help']]])(
  'no arguments and --help print the usage on stdout and exit 0: %j',
  async (argv) => {
    const out = await cli(project('valid'), ...argv)
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(`${usage()}\n`)
    expect(out.stderr).toBe('')
  },
)

test('--version prints the name, the version and the disclaimer, and no key', async () => {
  vi.stubEnv('HUBSPOT_SERVICE_KEY', key)
  const out = await cli(project('valid'), '--version')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe(`${bin} ${version}\n${disclaimer}\n`)
  expect(out.stdout).toContain('not affiliated with, endorsed by, or sponsored by HubSpot, Inc.')
  expect(out.stdout).not.toContain(key)
})

test.each([[['--json']], [['--help', '--json']], [['validate', '--help', '--json']]])(
  '--help --json prints one envelope, not the plain text: %j',
  async (argv) => {
    const out = await cli(project('valid'), ...argv)
    expect(out.exitCode, argv.join(' ')).toBe(0)
    expect(out.stderr).toBe('')
    expect(parseEnvelope(out.stdout)).toEqual({ format: 'envelope/1', ok: true, data: { usage: usage() }, issues: [] })
  },
)

test('--version --json prints one envelope, not the plain text', async () => {
  const out = await cli(project('valid'), '--version', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope(out.stdout)).toEqual({
    format: 'envelope/1',
    ok: true,
    data: { name: bin, version, disclaimer },
    issues: [],
  })
})

test('an unknown command exits 1 with the usage on stderr', async () => {
  const out = await cli(project('valid'), 'deploy')
  expect(out.exitCode).toBe(1)
  expect(out.stdout).toBe('')
  expect(out.stderr).toContain("E_USAGE: unknown command 'deploy'")
  expect(out.stderr).toContain(usage())
})

// Review finding: `switches[arg]` and `command in commands` fall through to Object.prototype, so these exit 0.
test.each(['toString', 'constructor', 'hasOwnProperty'])(
  'a command named after an Object.prototype member is an unknown command, not a switch: %s',
  async (name) => {
    const out = await cli(project('valid'), name)
    expect(out.exitCode, name).toBe(1)
    expect(out.stderr, name).toContain(`E_USAGE: unknown command '${name}'`)
  },
)

test('a positional argument the command does not take is E_USAGE, so `fmt check` rewrites nothing', async () => {
  const dir = copy('valid')
  const out = await cli(dir, 'fmt', 'check')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain("E_USAGE: unexpected argument 'check'")
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
  const json = await cli(project('valid'), 'validate', 'extra', 'words', '--json')
  expect(json.exitCode).toBe(1)
  expect(parseEnvelope(json.stdout).issues[0]).toMatchObject({
    code: 'E_USAGE',
    message: "unexpected argument 'extra'",
  })
})

test('an unknown flag exits 1 with the usage on stderr', async () => {
  const out = await cli(project('valid'), 'validate', '--strict')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain('E_USAGE: unknown flag --strict')
  expect(out.stderr).toContain(usage())
})

test.each([[['validate', '--target']], [['validate', '--target', '--json']]])(
  '--target without a name exits 1: %j',
  async (argv) => {
    const out = await cli(project('valid'), ...argv)
    expect(out.exitCode).toBe(1)
    expect(`${out.stdout}${out.stderr}`).toContain('--target needs a target name')
  },
)

test('a usage error with --json is one envelope on stdout and nothing on stderr', async () => {
  const out = await cli(project('valid'), 'deploy', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toBe('')
  expect(parseEnvelope(out.stdout)).toEqual({
    format: 'envelope/1',
    ok: false,
    issues: [
      { code: 'E_USAGE', message: "unknown command 'deploy'", fix: `run ${bin} --help`, docs: 'errors/E_USAGE.md' },
    ],
  })
})

test('a command that is not built yet prints "not implemented yet" and exits 1', async () => {
  const human = await cli(project('valid'), 'snapshot', '--target', 'sandbox')
  expect(human.exitCode).toBe(1)
  expect(human.stdout).toBe('')
  expect(human.stderr).toBe(
    `E_NOT_IMPLEMENTED: ${bin} snapshot is not implemented yet (docs: errors/E_NOT_IMPLEMENTED.md)\n`,
  )
  const json = await cli(project('valid'), 'compare', '--json')
  expect(json.exitCode).toBe(1)
  expect(json.stderr).toBe('')
  const env = parseEnvelope(json.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues[0]?.message).toBe(`${bin} compare is not implemented yet`)
})

test('an unexpected error exits 1 with one sanitized line', async () => {
  const dir = broken()
  const human = await cli(dir, 'validate')
  expect(human.exitCode).toBe(1)
  expect(human.stdout).toBe('')
  expect(human.stderr).toMatch(oneUnexpectedLine)
  const json = await cli(dir, 'validate', '--json')
  expect(json.exitCode).toBe(1)
  expect(json.stderr).toBe('')
  const env = parseEnvelope(json.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues.map((issue) => issue.code)).toEqual(['E_UNEXPECTED'])
})

test.each([[['validate']], [['ir']], [['ir', '--check']], [['fmt']], [['fmt', '--check']]])(
  'validate, ir and fmt send no request at all: %j',
  async (argv) => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetch)
    await cli(copy('valid'), ...argv)
    expect(fake.calls).toHaveLength(0)
  },
)

// Success, exit 3, E_NO_CONFIG, E_USAGE and E_UNEXPECTED, each with and without --json.
const projects: Record<string, () => string> = {
  valid: () => copy('valid'),
  invalid: () => copy('invalid'),
  warned: () => copy('warned'),
  empty,
  broken,
}
const argvs = [['validate'], ['ir'], ['fmt'], ['deploy'], ['fmt', 'extra'], ['toString']].flatMap((argv) => [
  argv,
  [...argv, '--json'],
])

test.each(Object.entries(projects).flatMap(([name, make]) => argvs.map((argv) => ({ name, make, argv }))))(
  'no output of any code path carries the key: $name project, $argv',
  async ({ make, argv }) => {
    vi.stubEnv('HUBSPOT_SERVICE_KEY', key)
    const dir = make()
    writeFileSync(join(dir, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\n`)
    const out = await cli(dir, ...argv)
    expect(`${out.stdout}${out.stderr}`, argv.join(' ')).not.toContain(key)
  },
)

const dist = fileURLToPath(new URL('../../dist/index.mjs', import.meta.url))

// The bin reads package.json relative to dist/, so only a spawn of the built file proves that path. Skipped when the
// package has not been built; CI builds before it tests.
test('the built bin runs: `node dist/index.mjs --version` prints the version text', { skip: !existsSync(dist) }, () => {
  const stdout = execFileSync(process.execPath, [dist, '--version'], { encoding: 'utf8' })
  expect(stdout).toBe(versionText())
})
