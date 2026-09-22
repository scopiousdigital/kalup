import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import { fakeFetch } from '../lib/testing.js'
import { bin, disclaimer, usage, version, versionText } from '../usage.js'
import { broken, cli, copy, empty, parseEnvelope, project } from './testing.js'

const key = 'kalup-test-secret-9f2c'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('no arguments and --help print the usage on stdout and exit 0', async () => {
  for (const argv of [[], ['--help'], ['-h'], ['validate', '--help']]) {
    const out = await cli(project('valid'), ...argv)
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(`${usage()}\n`)
    expect(out.stderr).toBe('')
  }
})

test('--version prints the name, the version and the disclaimer, and no key', async () => {
  vi.stubEnv('HUBSPOT_SERVICE_KEY', key)
  const out = await cli(project('valid'), '--version')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe(`${bin} ${version}\n${disclaimer}\n`)
  expect(out.stdout).toContain('not affiliated with, endorsed by, or sponsored by HubSpot, Inc.')
  expect(out.stdout).not.toContain(key)
})

test('--help --json and --version --json print one envelope, not the plain text', async () => {
  for (const argv of [['--json'], ['--help', '--json'], ['validate', '--help', '--json']]) {
    const out = await cli(project('valid'), ...argv)
    expect(out.exitCode, argv.join(' ')).toBe(0)
    expect(out.stderr).toBe('')
    expect(parseEnvelope(out.stdout)).toEqual({ format: 'envelope/1', ok: true, data: { usage: usage() }, issues: [] })
  }
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

test('a command named after an Object.prototype member is an unknown command, not a switch', async () => {
  // Review finding: `switches[arg]` and `command in commands` fall through to Object.prototype, so these exit 0.
  for (const name of ['toString', 'constructor', 'hasOwnProperty']) {
    const out = await cli(project('valid'), name)
    expect(out.exitCode, name).toBe(1)
    expect(out.stderr, name).toContain(`E_USAGE: unknown command '${name}'`)
  }
})

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

test('--target without a name exits 1', async () => {
  for (const argv of [
    ['validate', '--target'],
    ['validate', '--target', '--json'],
  ]) {
    const out = await cli(project('valid'), ...argv)
    expect(out.exitCode).toBe(1)
    expect(`${out.stdout}${out.stderr}`).toContain('--target needs a target name')
  }
})

test('a usage error with --json is one envelope on stdout and nothing on stderr', async () => {
  const out = await cli(project('valid'), 'deploy', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toBe('')
  expect(parseEnvelope(out.stdout)).toEqual({
    format: 'envelope/1',
    ok: false,
    issues: [{ code: 'E_USAGE', message: "unknown command 'deploy'", fix: `run ${bin} --help` }],
  })
})

test('a command that is not built yet prints "not implemented yet" and exits 1', async () => {
  const human = await cli(project('valid'), 'snapshot', '--target', 'sandbox')
  expect(human.exitCode).toBe(1)
  expect(human.stdout).toBe('')
  expect(human.stderr).toBe(`E_NOT_IMPLEMENTED: ${bin} snapshot is not implemented yet\n`)
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
  expect(human.stderr).toMatch(/^E_UNEXPECTED: [^\n]+\n$/)
  const json = await cli(dir, 'validate', '--json')
  expect(json.exitCode).toBe(1)
  expect(json.stderr).toBe('')
  const env = parseEnvelope(json.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues.map((issue) => issue.code)).toEqual(['E_UNEXPECTED'])
})

test('validate, ir and fmt send no request at all', async () => {
  const fake = fakeFetch()
  vi.stubGlobal('fetch', fake.fetch)
  const dir = copy('valid')
  for (const argv of [['validate'], ['ir'], ['ir', '--check'], ['fmt'], ['fmt', '--check']]) {
    await cli(dir, ...argv)
  }
  expect(fake.calls).toHaveLength(0)
})

test('no output of any code path carries the key: success, exit 3, E_NO_CONFIG, E_USAGE and E_UNEXPECTED', async () => {
  vi.stubEnv('HUBSPOT_SERVICE_KEY', key)
  for (const dir of [copy('valid'), copy('invalid'), copy('warned'), empty(), broken()]) {
    writeFileSync(join(dir, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\n`)
    for (const argv of [['validate'], ['ir'], ['fmt'], ['deploy'], ['fmt', 'extra'], ['toString']]) {
      for (const json of [[], ['--json']]) {
        const out = await cli(dir, ...argv, ...json)
        expect(`${out.stdout}${out.stderr}`, [...argv, ...json].join(' ')).not.toContain(key)
      }
    }
  }
})

const dist = fileURLToPath(new URL('../../dist/index.mjs', import.meta.url))

// The bin reads package.json relative to dist/, so only a spawn of the built file proves that path. Skipped when the
// package has not been built; CI builds before it tests.
test.skipIf(!existsSync(dist))('the built bin runs: `node dist/index.mjs --version` prints the version text', () => {
  const stdout = execFileSync(process.execPath, [dist, '--version'], { encoding: 'utf8' })
  expect(stdout).toBe(versionText())
})
