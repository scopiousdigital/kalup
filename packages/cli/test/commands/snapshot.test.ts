import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { SnapshotData } from '../../src/commands/snapshot.js'
import { cli, copy, parseEnvelope } from '../../src/commands/testing.js'
import { parseSnapshot, snapshotPath, snapshotText } from '../../src/engine/snapshot.js'
import { fixture, jsonResponse } from '../../src/lib/testing.js'
import { version } from '../../src/version.js'
import { printed } from '../support/printed.js'
import { type Bodies, edit, key, orchard, portal, refused, routes, tree } from './orchard.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const observedAt = '2026-09-23T10:15:30.123Z'
const file = '.kalup/snapshots/sandbox/20260923T101530123Z.json'

// The one clock snapshot reads, fixed. Timers stay real: the HTTP client paces requests with them.
function at(time: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(time))
}

test('snapshot writes the read under .kalup/snapshots/<target>/<stamp>.json, and nothing else', async () => {
  at(observedAt)
  const { calls } = portal()
  const dir = copy('pull')
  const before = tree(dir)
  const out = await cli(dir, 'snapshot', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  expect(out.stderr).toBe('')
  const env = parseEnvelope<SnapshotData>(out.stdout)
  expect(env.ok).toBe(true)
  expect(env.data).toEqual({
    file,
    target: 'sandbox',
    portalId: 1_111_111,
    observedAt,
    complete: true,
    counts: { objects: 2, groups: 5, properties: 14 },
  })
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_UNSUPPORTED_TYPE'])
  const text = readFileSync(join(dir, file), 'utf8')
  const snapshot = parseSnapshot(text, file)
  expect(text).toBe(snapshotText(snapshot))
  // The engine's golden is the same read of the same project; only the generator's version differs.
  expect(snapshot).toEqual({
    ...fixture('snapshot/orchard.json'),
    generator: { name: 'kalup', version, frontend: 'portal' },
  })
  // Config files are never written: kalup/ and kalup.config.ts are as they were, and the snapshot is the only new file.
  expect(tree(dir)).toEqual({ ...before, [file]: text })
  expect(calls.every((call) => call.startsWith('GET '))).toBe(true)
  expect(calls).not.toContain('GET /crm/limits/2026-09/custom-properties')
})

test('a snapshot never replaces a file: the same stamp again is E_SNAPSHOT, exit 1, and the first file stays', async () => {
  at(observedAt)
  portal()
  const dir = copy('pull')
  expect((await cli(dir, 'snapshot', '--target', 'sandbox')).exitCode).toBe(0)
  const first = readFileSync(join(dir, file), 'utf8')
  portal({ [key]: { ...orchard(), [routes.harvestGroups]: { results: [] } } })
  const again = await cli(dir, 'snapshot', '--target', 'sandbox', '--json')
  expect(again.exitCode).toBe(1)
  expect(parseEnvelope(again.stdout).issues).toEqual([
    expect.objectContaining({ code: 'E_SNAPSHOT', message: `${file} already exists`, file }),
  ])
  expect(readFileSync(join(dir, file), 'utf8')).toBe(first)
})

test('--out writes exactly there, relative to the directory the command runs in, and never replaces a file', async () => {
  portal()
  const dir = copy('pull')
  const cwd = join(dir, 'kalup')
  const human = await cli(cwd, 'snapshot', '--target', 'sandbox', '--out', 'snaps/sandbox.json')
  expect(human.exitCode).toBe(0)
  const text = readFileSync(join(cwd, 'snaps', 'sandbox.json'), 'utf8')
  expect(human.stdout).toContain(parseSnapshot(text, 'snaps/sandbox.json').observation.observedAt)
  expect(printed(human)).toMatchInlineSnapshot(`
    "Snapshot of target sandbox, portal 1111111, observed at <time>: 2 objects, 5 groups, 14 properties
    Wrote snaps/sandbox.json
    --- stderr
    W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which no builder carries; skipped (docs: errors/W_UNSUPPORTED_TYPE.md)
    "
  `)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)

  portal()
  const again = await cli(cwd, 'snapshot', '--target', 'sandbox', '--out', 'snaps/sandbox.json', '--json')
  expect(again.exitCode).toBe(1)
  expect(parseEnvelope(again.stdout).issues[0]).toMatchObject({ code: 'E_SNAPSHOT', file: 'snaps/sandbox.json' })
  expect(readFileSync(join(cwd, 'snaps', 'sandbox.json'), 'utf8')).toBe(text)
})

test('an incomplete read is still written, marked incomplete, with W_INCOMPLETE and exit 0', async () => {
  const bodies = orchard()
  bodies[routes.harvestGroups] = refused()
  portal({ [key]: bodies })
  const dir = copy('pull')
  const out = await cli(dir, 'snapshot', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<SnapshotData>(out.stdout)
  expect(env.ok).toBe(true)
  expect(env.data?.complete).toBe(false)
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_UNSUPPORTED_TYPE', 'E_SCOPE', 'W_INCOMPLETE'])
  expect(env.issues.at(-1)?.message).toContain('harvest was not read')
  const snapshot = parseSnapshot(readFileSync(join(dir, env.data?.file ?? ''), 'utf8'), 'snapshot')
  expect(snapshot.observation.coverage.objects.harvest).toMatchObject({ status: 'unreadable', issue: 'E_SCOPE' })
  expect(env.data?.file).toBe(snapshotPath('sandbox', env.data?.observedAt ?? ''))
})

test('selection, config and portal errors: exit 1, 3 and 4, and no file is written', async () => {
  const { calls } = portal({
    [key]: { ...orchard(), [routes.account]: { ...fixture('account-info.json'), portalId: 2 } },
  })
  const dir = copy('pull')
  const several = copy('pull')
  edit(several, 'kalup.config.ts', '  targets: {\n', '  targets: {\n    production: { portalId: 2222222 },\n')
  const required = await cli(several, 'snapshot', '--json')
  expect(required.exitCode).toBe(1)
  expect(parseEnvelope(required.stdout).issues[0]).toMatchObject({ code: 'E_TARGET_REQUIRED' })
  expect(existsSync(join(several, '.kalup'))).toBe(false)
  const unknown = await cli(dir, 'snapshot', '--target', 'production', '--json')
  expect(unknown.exitCode).toBe(3)
  expect(calls).toEqual([])
  const mismatch = await cli(dir, 'snapshot', '--target', 'sandbox', '--json')
  expect(mismatch.exitCode).toBe(4)
  expect(calls).toEqual(['GET /account-info/2026-09/details'])
  const invalid = copy('pull')
  edit(invalid, 'kalup.config.ts', 'portalId: 1111111', 'portalId: 0')
  expect((await cli(invalid, 'snapshot', '--target', 'sandbox')).exitCode).toBe(3)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
  expect(existsSync(join(invalid, '.kalup'))).toBe(false)
})

const failing: Record<string, () => Bodies> = {
  success: orchard,
  '401': () => ({ ...orchard(), [routes.companies]: jsonResponse(401, fixture('errors/unauthorized.json')) }),
  'portal mismatch': () => ({ [routes.account]: { ...fixture('account-info.json'), portalId: 2 } }),
  'nothing answers': () => ({}),
}

test.each(
  Object.entries(failing).flatMap(([name, bodies]) => [
    { name, bodies, json: [] },
    { name, bodies, json: ['--json'] },
  ]),
)('key hygiene: no output and no snapshot carries the key: $name $json', async ({ bodies, json }) => {
  portal({ [key]: bodies() })
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', undefined)
  const dir = copy('pull')
  writeFileSync(join(dir, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\n`)
  mkdirSync(join(dir, '.kalup'))
  const out = await cli(dir, 'snapshot', '--target', 'sandbox', ...json)
  expect(`${out.stdout}${out.stderr}`.length).toBeGreaterThan(0)
  expect(`${out.stdout}${out.stderr}`).not.toContain(key)
  for (const [name, text] of Object.entries(tree(join(dir, '.kalup')))) {
    expect(text, name).not.toContain(key)
  }
})
