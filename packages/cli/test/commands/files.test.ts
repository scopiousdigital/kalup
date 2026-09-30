// The files a command writes besides the project's own: an --out file never lands among the files Kalup keeps for
// itself, state, journals, archives and locks, which a person or a later run would then read as Kalup's. Paths are
// compared where the disk puts them: through symbolic links, and without case where the disk ignores it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KalupError } from '@kalup/engine'
import { afterEach, expect, test, vi } from 'vitest'
import { writeArgFile } from '../../src/commands/files.js'
import { cli, copy } from '../../src/commands/testing.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

function refusal(run: () => unknown): KalupError {
  try {
    run()
  } catch (error) {
    if (error instanceof KalupError) {
      return error
    }
    throw error
  }
  throw new Error('expected a KalupError')
}

test.each([
  ['the state file', '.kalup/state/portal-1111111.json'],
  ['a journal', '.kalup/journal/portal-1111111/run.jsonl'],
  ['the state directory itself', '.kalup/state'],
  ['.kalup itself', '.kalup'],
])('--out onto %s is E_USAGE and writes nothing', (_, path) => {
  const cwd = mkdtempSync(join(tmpdir(), 'kalup-files-'))
  vi.stubEnv('KALUP_LOCK_DIR', join(cwd, 'locks'))
  const error = refusal(() => writeArgFile(cwd, path, 'plan\n'))
  expect(error.issues).toMatchObject([
    {
      code: 'E_USAGE',
      message: expect.stringContaining(`${path} is inside .kalup/`),
    },
  ])
  expect(existsSync(join(cwd, '.kalup'))).toBe(false)
})

test('--out into the lock directory or KALUP_STATE_DIR is E_USAGE; a snapshot or a plan under .kalup is written', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'kalup-files-'))
  vi.stubEnv('KALUP_LOCK_DIR', join(cwd, 'locks'))
  vi.stubEnv('KALUP_STATE_DIR', join(cwd, 'shared-state'))
  expect(refusal(() => writeArgFile(cwd, 'locks/portal-1111111.lock', 'x')).issues[0]?.message).toContain(
    'is inside the lock directory',
  )
  expect(refusal(() => writeArgFile(cwd, 'shared-state/portal-1111111.json', 'x')).issues[0]?.message).toContain(
    'is inside KALUP_STATE_DIR',
  )
  expect(writeArgFile(cwd, '.kalup/snapshots/sandbox/20260928T100000Z.json', '{}\n', true)).toBe(true)
  expect(writeArgFile(cwd, '.kalup/plans/sandbox-pl_3f9a1c07b2e4.json', '{}\n')).toBe(true)
  expect(writeArgFile(cwd, 'plans/plan.json', '{}\n')).toBe(true)
  expect(readFileSync(join(cwd, 'plans', 'plan.json'), 'utf8')).toBe('{}\n')
})

test('docs --out onto the state file is refused before anything is written', async () => {
  const dir = copy('valid')
  const out = await cli(dir, 'docs', '--out', '.kalup/state/portal-1111111.json', '--json')
  expect(out.exitCode).toBe(1)
  expect(JSON.parse(out.stdout).issues).toMatchObject([{ code: 'E_USAGE' }])
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
})

// A project with a state file, and the lock directory inside the temporary directory.
function withState(): { cwd: string; state: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'kalup-files-'))
  vi.stubEnv('KALUP_LOCK_DIR', join(cwd, 'locks'))
  const state = join(cwd, '.kalup', 'state', 'portal-1111111.json')
  mkdirSync(join(cwd, '.kalup', 'state'), { recursive: true })
  writeFileSync(state, 'state\n')
  return { cwd, state }
}

// What writing `path` from `cwd` does: 'written', or the code of the refusal.
function outcome(cwd: string, path: string): string {
  try {
    writeArgFile(cwd, path, 'plan\n')
    return 'written'
  } catch (error) {
    if (error instanceof KalupError) {
      return error.issues[0]?.code ?? ''
    }
    throw error
  }
}

// On macOS and Windows, whose disks ignore case, .KALUP is .kalup; elsewhere it is a directory of its own.
const foldsCase = process.platform === 'darwin' || process.platform === 'win32'

test.each(['.KALUP/state/portal-1111111.json', '.Kalup/journal/portal-1111111/run.jsonl'])(
  '--out onto %s is E_USAGE where the disk ignores case, before and after .kalup exists',
  (path) => {
    const empty = mkdtempSync(join(tmpdir(), 'kalup-files-'))
    const { cwd, state } = withState()
    const expected = foldsCase ? 'E_USAGE' : 'written'
    expect([outcome(empty, path), outcome(cwd, path)]).toEqual([expected, expected])
    expect(readFileSync(state, 'utf8')).toBe('state\n')
  },
)

test('--out through a symbolic link is E_USAGE: a link to the state file, or a directory linked to .kalup/state', () => {
  const { cwd, state } = withState()
  symlinkSync(state, join(cwd, 'state-link.json'))
  symlinkSync(join(cwd, '.kalup', 'state'), join(cwd, 'st'))
  expect(refusal(() => writeArgFile(cwd, 'state-link.json', 'plan\n')).issues).toMatchObject([
    {
      code: 'E_USAGE',
      message: expect.stringContaining('state-link.json is a symbolic link'),
    },
  ])
  expect(refusal(() => writeArgFile(cwd, 'st/portal-1111111.json', 'plan\n')).issues[0]?.message).toContain(
    'st/portal-1111111.json is inside .kalup/',
  )
  expect(readFileSync(state, 'utf8')).toBe('state\n')
})

test('a relative KALUP_STATE_DIR is taken from the project root, from any directory of the project', () => {
  const dir = copy('valid')
  vi.stubEnv('KALUP_LOCK_DIR', join(dir, 'locks'))
  vi.stubEnv('KALUP_STATE_DIR', '.kalup-state/state')
  const sub = join(dir, 'hubspot')
  expect(
    refusal(() => writeArgFile(sub, '../.kalup-state/state/portal-1111111.json', 'x')).issues[0]?.message,
  ).toContain('../.kalup-state/state/portal-1111111.json is inside KALUP_STATE_DIR')
  expect(
    refusal(() => writeArgFile(sub, '../.kalup-state/journal/portal-1111111/run.jsonl', 'x')).issues[0]?.message,
  ).toContain('is inside the journal directory')
  expect(existsSync(join(dir, '.kalup-state'))).toBe(false)
})

test('the lock directory is found through a symbolic link: a write to its real path is E_USAGE', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'kalup-files-'))
  mkdirSync(join(cwd, 'locks-real'))
  symlinkSync(join(cwd, 'locks-real'), join(cwd, 'locks'))
  vi.stubEnv('KALUP_LOCK_DIR', join(cwd, 'locks'))
  expect(refusal(() => writeArgFile(cwd, 'locks-real/portal-1111111.lock', 'x')).issues[0]?.message).toContain(
    'is inside the lock directory',
  )
  expect(existsSync(join(cwd, 'locks-real', 'portal-1111111.lock'))).toBe(false)
})
