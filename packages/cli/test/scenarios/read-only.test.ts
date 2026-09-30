// The read-only guard, with writes in the tree: pull, plan, compare, snapshot, status, docs and state rebuild without
// --write send only read-tagged requests, with the read key, even when the target names a write key and the write key
// is set. None but pull writes state, a journal or a lock; pull records bases in state under the lock, and leaves no
// journal and no lock.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cli } from '../../src/commands/testing.js'
import {
  applyNow,
  edit,
  environment,
  live,
  notRead,
  objectsFile,
  portal,
  project,
  statePath,
  writeKey,
} from './harness.js'

let locks = ''

beforeEach(() => {
  ;({ locks } = environment())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Every file under the project's .kalup/state and .kalup/journal, with its bytes. */
function written(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const folder of ['state', 'journal']) {
    const root = join(dir, '.kalup', folder)
    if (!existsSync(root)) {
      continue
    }
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        const full = join(entry.parentPath, entry.name)
        out[full] = readFileSync(full, 'utf8')
      }
    }
  }
  return out
}

const commands = [
  ['pull', '--check'],
  ['plan'],
  ['plan', '--out', 'plan.json'],
  ['compare', 'config', 'sandbox'],
  ['snapshot'],
  ['status'],
  ['docs'],
  ['state', 'rebuild'],
]

test('read-only guard: pull --check, plan, compare, snapshot, status, docs and state rebuild send only reads and never write state', async () => {
  const sim = portal()
  const dir = project({ target: { write: 'KESTREL_WRITE_KEY' } })
  vi.stubEnv('KESTREL_WRITE_KEY', writeKey)
  await applyNow(dir)
  expect(existsSync(statePath(dir))).toBe(true)
  // Something to do on both sides: a UI edit and a config change.
  live(sim, 'hive_count').label = 'Hives kept'
  edit(dir, objectsFile, "apiary: { label: 'Apiary' }", "apiary: { label: 'Apiary yard' }")
  const before = written(dir)

  for (const argv of commands) {
    const from = sim.log.length
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, each command checked against the log it added
    const out = await cli(dir, ...argv)
    expect(out.exitCode, `${argv.join(' ')}: ${out.stderr}`).toBe(0)
    const requests = sim.log.slice(from)
    // Every command but docs of config reads the portal.
    expect(requests.length > 0, argv.join(' ')).toBe(argv[0] !== 'docs')
    expect(notRead(requests), argv.join(' ')).toEqual([])
    expect(new Set(requests.map((r) => r.key)), argv.join(' ')).toEqual(
      new Set(requests.length > 0 ? ['KESTREL_READ_KEY'] : []),
    )
    expect(written(dir), argv.join(' ')).toEqual(before)
    expect(readdirSync(locks), argv.join(' ')).toEqual([])
  }

  // Without the write key in the environment, every one of them still runs: none resolves it.
  vi.stubEnv('KESTREL_WRITE_KEY', undefined)
  for (const argv of commands) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one command at a time
    const out = await cli(dir, ...argv)
    expect(out.exitCode, `${argv.join(' ')}: ${out.stderr}`).toBe(0)
    expect(out.stderr, argv.join(' ')).not.toContain('E_MISSING_KEY')
  }
  expect(sim.writes()).toHaveLength(2)
  expect(written(dir)).toEqual(before)
})

test('pull sends only reads with the read key, and writes state alone: the base it agreed on, no journal, no lock', async () => {
  const sim = portal()
  const dir = project({ target: { write: 'KESTREL_WRITE_KEY' } })
  vi.stubEnv('KESTREL_WRITE_KEY', writeKey)
  await applyNow(dir)
  live(sim, 'hive_count').label = 'Hives kept'
  const before = written(dir)
  const from = sim.log.length
  const out = await cli(dir, 'pull')
  expect(out.exitCode, out.stderr).toBe(0)
  const requests = sim.log.slice(from)
  expect(notRead(requests)).toEqual([])
  expect(new Set(requests.map((r) => r.key))).toEqual(new Set(['KESTREL_READ_KEY']))
  const after = written(dir)
  const changed = Object.keys(after).filter((file) => after[file] !== before[file])
  expect(changed.map((file) => file.slice(dir.length + 1)).sort()).toEqual([
    '.kalup/state/portal-7700001.json',
    '.kalup/state/portal-7700001.json.bak',
  ])
  expect(readdirSync(locks)).toEqual([])
})
