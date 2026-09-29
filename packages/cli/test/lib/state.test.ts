import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stableStringify, type TargetState } from '@kalup/core'
import { expect, test } from 'vitest'
import { KalupError } from '../../src/lib/output.js'
import { FileStateStore, type StateIo, stateDir } from '../../src/lib/state.js'

const portalId = 2_222_222
const hex16 = /^[0-9a-f]{16}$/

function temp(): string {
  return mkdtempSync(join(tmpdir(), 'kalup-state-'))
}

function state(serial: number, label = 'Billing'): TargetState {
  return {
    format: 'kalup.state/1',
    lineage: 'b0a1c6e2d4f68a13',
    serial,
    portalId,
    resources: {
      'group:companies/billing': { origin: 'created', id: 'billing', normVersion: 1, base: { label } },
    },
  }
}

function bytes(value: TargetState): string {
  return `${stableStringify(value)}\n`
}

function failure(run: () => unknown): KalupError {
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

const io: StateIo = {
  closeSync,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
}

// The real file operations, one of them replaced by one that throws, and every call recorded by name.
function faulty(fail?: keyof StateIo): { io: StateIo; calls: string[] } {
  const calls: string[] = []
  const wrapped = Object.fromEntries(
    Object.entries(io).map(([name, fn]) => [
      name,
      (...args: unknown[]) => {
        calls.push(name)
        if (name === fail) {
          throw Object.assign(new Error(`${name} failed`), { code: 'EIO' })
        }
        return (fn as (...a: unknown[]) => unknown)(...args)
      },
    ]),
  ) as unknown as StateIo
  return { io: wrapped, calls }
}

test('stateDir: KALUP_STATE_DIR wins, a relative value taken from the project root', () => {
  const root = temp()
  expect(stateDir(root, { KALUP_STATE_DIR: '/srv/kalup-state' })).toBe('/srv/kalup-state')
  expect(stateDir(root, { KALUP_STATE_DIR: 'state-branch' })).toBe(join(root, 'state-branch'))
})

test('stateDir: outside git, and in the main worktree, state is under the project', () => {
  const plain = temp()
  expect(stateDir(plain, {})).toBe(join(plain, '.kalup', 'state'))
  const clone = temp()
  mkdirSync(join(clone, '.git'))
  mkdirSync(join(clone, 'crm'))
  expect(stateDir(join(clone, 'crm'), {})).toBe(join(clone, 'crm', '.kalup', 'state'))
})

// A clone at <tmp>/clone with a linked worktree at <tmp>/feature, as `git worktree add` lays it out.
function linked(pointer: (gitdir: string, worktree: string) => string, commondir = '../..\n') {
  const base = temp()
  const clone = join(base, 'clone')
  const gitdir = join(clone, '.git', 'worktrees', 'feature')
  mkdirSync(gitdir, { recursive: true })
  writeFileSync(join(gitdir, 'commondir'), commondir)
  const worktree = join(base, 'feature')
  mkdirSync(join(worktree, 'crm'), { recursive: true })
  writeFileSync(join(worktree, '.git'), `gitdir: ${pointer(gitdir, worktree)}\n`)
  return { clone, worktree }
}

test('stateDir: in a linked worktree, the same project path in the main worktree', () => {
  const absolute = linked((gitdir) => gitdir)
  expect(stateDir(join(absolute.worktree, 'crm'), {})).toBe(join(absolute.clone, 'crm', '.kalup', 'state'))
  expect(stateDir(absolute.worktree, {})).toBe(join(absolute.clone, '.kalup', 'state'))
  const relative = linked(() => '../clone/.git/worktrees/feature')
  expect(stateDir(join(relative.worktree, 'crm'), {})).toBe(join(relative.clone, 'crm', '.kalup', 'state'))
})

test('stateDir: anything unexpected falls back to the project', () => {
  const noCommondir = linked((gitdir) => gitdir)
  rmSync(join(noCommondir.clone, '.git', 'worktrees', 'feature', 'commondir'))
  const cases = [noCommondir, linked(() => '/nowhere/at/all'), linked((gitdir) => gitdir, '/srv/bare-repo.git\n')]
  for (const { worktree } of cases) {
    expect(stateDir(join(worktree, 'crm'), {})).toBe(join(worktree, 'crm', '.kalup', 'state'))
  }
  const garbage = temp()
  writeFileSync(join(garbage, '.git'), 'not a pointer\n')
  expect(stateDir(garbage, {})).toBe(join(garbage, '.kalup', 'state'))
  // A submodule's .git file points into the superproject's modules, with no commondir.
  const submodule = temp()
  mkdirSync(join(submodule, 'super', '.git', 'modules', 'crm'), { recursive: true })
  mkdirSync(join(submodule, 'super', 'crm'))
  writeFileSync(join(submodule, 'super', 'crm', '.git'), 'gitdir: ../.git/modules/crm\n')
  expect(stateDir(join(submodule, 'super', 'crm'), {})).toBe(join(submodule, 'super', 'crm', '.kalup', 'state'))
})

test('read is null without a file; write creates it with sorted keys and one newline, and no .bak', () => {
  const dir = join(temp(), 'state')
  const store = FileStateStore(dir)
  expect(store.path(portalId)).toBe(join(dir, 'portal-2222222.json'))
  expect(store.read(portalId)).toBeNull()
  expect(store.write(state(0), null)).toBe(true)
  expect(readFileSync(store.path(portalId), 'utf8')).toBe(bytes(state(0)))
  expect(store.read(portalId)).toEqual(state(0))
  expect(readdirSync(dir)).toEqual(['portal-2222222.json'])
})

test('a write keeps the previous file as .bak, flushed and renamed in order', () => {
  const dir = temp()
  FileStateStore(dir).write(state(0), null)
  const { io: spied, calls } = faulty()
  expect(FileStateStore(dir, { io: spied }).write(state(1, 'Billing details'), 0)).toBe(true)
  expect(readFileSync(join(dir, 'portal-2222222.json'), 'utf8')).toBe(bytes(state(1, 'Billing details')))
  expect(readFileSync(join(dir, 'portal-2222222.json.bak'), 'utf8')).toBe(bytes(state(0)))
  expect(calls).toEqual([
    'readFileSync',
    'mkdirSync',
    'openSync',
    'writeSync',
    'fsyncSync',
    'closeSync',
    'copyFileSync',
    'renameSync',
    'openSync',
    'fsyncSync',
    'closeSync',
  ])
  expect(readdirSync(dir).sort()).toEqual(['portal-2222222.json', 'portal-2222222.json.bak'])
})

test('a write whose bytes equal the file writes nothing: no temp file, no .bak', () => {
  const dir = temp()
  FileStateStore(dir).write(state(4), null)
  const { io: spied, calls } = faulty()
  expect(FileStateStore(dir, { io: spied }).write(state(4), 4)).toBe(false)
  expect(calls).toEqual(['readFileSync'])
  expect(readdirSync(dir)).toEqual(['portal-2222222.json'])
})

test('the serial is compared before anything is written: E_STATE_CONFLICT', () => {
  const dir = temp()
  const store = FileStateStore(dir)
  expect(failure(() => store.write(state(0), 0)).issues[0]?.code).toBe('E_STATE_CONFLICT')
  store.write(state(4), null)
  for (const expected of [null, 3, 5]) {
    const error = failure(() => store.write(state(9), expected))
    expect(error.issues[0]).toMatchObject({ code: 'E_STATE_CONFLICT', file: store.path(portalId) })
    expect(error.issues[0]?.message).toContain('its serial is 4')
  }
  expect(readFileSync(store.path(portalId), 'utf8')).toBe(bytes(state(4)))
})

test.each([
  ['the temp file write', 'writeSync'],
  ['the flush', 'fsyncSync'],
  ['the .bak copy', 'copyFileSync'],
  ['the rename', 'renameSync'],
] as const)('a failure in %s is E_STATE_WRITE, and the previous file is intact with no temp file left', (_, step) => {
  const dir = temp()
  FileStateStore(dir).write(state(0), null)
  const { io: broken } = faulty(step)
  const error = failure(() => FileStateStore(dir, { io: broken }).write(state(1, 'Changed'), 0))
  expect(error.exitCode).toBe(1)
  expect(error.issues[0]).toMatchObject({ code: 'E_STATE_WRITE', file: join(dir, 'portal-2222222.json') })
  expect(error.issues[0]?.message).toContain('(EIO). The previous file is intact.')
  expect(readFileSync(join(dir, 'portal-2222222.json'), 'utf8')).toBe(bytes(state(0)))
  expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([])
})

// The real writeSync, taking at most `limit` bytes per call, and none at all after `calls` calls.
function shortWrites(limit: number, calls = Number.POSITIVE_INFINITY): StateIo {
  let made = 0
  const write = (fd: number, buffer: Uint8Array, offset: number, length: number) => {
    made += 1
    return made > calls ? 0 : writeSync(fd, buffer, offset, Math.min(length, limit))
  }
  return { ...io, writeSync: write as StateIo['writeSync'] }
}

test('a write(2) that takes part of the bytes is followed by more until the whole file is written', () => {
  const dir = temp()
  FileStateStore(dir).write(state(0), null)
  expect(FileStateStore(dir, { io: shortWrites(7) }).write(state(1, 'Billing details'), 0)).toBe(true)
  expect(readFileSync(join(dir, 'portal-2222222.json'), 'utf8')).toBe(bytes(state(1, 'Billing details')))
})

test('a write that stops short is E_STATE_WRITE, and the previous file is intact with no temp file left', () => {
  const dir = temp()
  FileStateStore(dir).write(state(0), null)
  const error = failure(() => FileStateStore(dir, { io: shortWrites(20, 1) }).write(state(1, 'Changed'), 0))
  expect(error.issues[0]).toMatchObject({ code: 'E_STATE_WRITE', file: join(dir, 'portal-2222222.json') })
  expect(readFileSync(join(dir, 'portal-2222222.json'), 'utf8')).toBe(bytes(state(0)))
  expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([])
})

test('a state file that cannot be read is E_STATE_INVALID on a read and E_STATE_WRITE on a save, naming the file', () => {
  const dir = temp()
  FileStateStore(dir).write(state(0), null)
  const denied: StateIo = {
    ...io,
    readFileSync: (() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    }) as StateIo['readFileSync'],
  }
  const store = FileStateStore(dir, { io: denied })
  const file = join(dir, 'portal-2222222.json')
  const read = failure(() => store.read(portalId))
  expect(read.issues[0]).toMatchObject({
    code: 'E_STATE_INVALID',
    file,
    message: `${file} could not be read (EACCES).`,
    fix: 'check that this user can read the state file and its directory, then run the command again',
  })
  const saved = failure(() => store.write(state(1), 0))
  expect(saved.issues[0]).toMatchObject({ code: 'E_STATE_WRITE', file })
  expect(saved.issues[0]?.message).toContain('(EACCES)')
  expect(readFileSync(file, 'utf8')).toBe(bytes(state(0)))
})

test('a first write that fails leaves no file at all', () => {
  const dir = temp()
  const { io: broken } = faulty('renameSync')
  expect(failure(() => FileStateStore(dir, { io: broken }).write(state(0), null)).issues[0]?.code).toBe('E_STATE_WRITE')
  expect(existsSync(join(dir, 'portal-2222222.json'))).toBe(false)
  expect(readdirSync(dir)).toEqual([])
})

test.each([
  ['not JSON', '{"format": "kalup.state/1",', 'is not JSON'],
  ['not kalup.state/1', JSON.stringify({ ...state(0), serial: -1 }), 'does not match kalup.state/1 at serial'],
  ['another portal', bytes({ ...state(0), portalId: 3_333_333 }), 'describes portal 3333333, not portal 2222222'],
])('a file that is %s is E_STATE_INVALID naming the file, with the .bak and rebuild fix', (_, text, why) => {
  const dir = temp()
  const file = join(dir, 'portal-2222222.json')
  writeFileSync(file, text)
  const store = FileStateStore(dir)
  const error = failure(() => store.read(portalId, 'production'))
  expect(error.exitCode).toBe(1)
  expect(error.issues[0]).toMatchObject({
    code: 'E_STATE_INVALID',
    file,
    fix: 'rename portal-2222222.json.bak, the state before its last save, into its place if it reads; else move the file away and run kalup state rebuild --target production',
  })
  expect(error.issues[0]?.message).toContain(why)
  expect(failure(() => store.read(portalId)).issues[0]?.fix).toContain(
    'else move the file away and run kalup state rebuild --target <target>',
  )
  // A save over it cannot compare serials, so it refuses too.
  expect(failure(() => store.write(state(0), null)).issues[0]?.code).toBe('E_STATE_INVALID')
  expect(readFileSync(file, 'utf8')).toBe(text)
})

test('a file of another state format is E_STATE_INVALID naming it and the format this version reads, never rebuilt', () => {
  const dir = temp()
  const file = join(dir, 'portal-2222222.json')
  // A newer version's state: its shape may differ in any way, so it is refused before the schema check.
  const text = `${JSON.stringify({ ...state(0), format: 'kalup.state/2', owners: {} })}\n`
  writeFileSync(file, text)
  const store = FileStateStore(dir)
  const error = failure(() => store.read(portalId, 'production'))
  expect(error.exitCode).toBe(1)
  expect(error.issues).toEqual([
    {
      code: 'E_STATE_INVALID',
      message: `${file} is kalup.state/2, and this version of kalup reads kalup.state/1.`,
      file,
      fix: 'use the version of kalup that wrote it, or a newer one',
    },
  ])
  expect(failure(() => store.write(state(0), null)).issues[0]?.message).toContain('is kalup.state/2')
  expect(readFileSync(file, 'utf8')).toBe(text)
})

test('a state that does not match kalup.state/1 is never saved', () => {
  const dir = temp()
  expect(() => FileStateStore(dir).write({ ...state(0), lineage: 'not-hex' }, null)).toThrow('kalup.state/1')
  expect(existsSync(join(dir, 'portal-2222222.json'))).toBe(false)
})

test('archive moves the file under archive/ by lineage and time, ending it; with no file there is nothing to move', () => {
  const dir = temp()
  const store = FileStateStore(dir, { now: () => new Date('2026-09-24T10:11:12.345Z') })
  expect(store.archive(portalId, 'rebuild')).toBeNull()
  store.write(state(7), null)
  const moved = join(dir, 'archive', 'portal-2222222-b0a1c6e2d4f68a13-20260924T101112345Z.json')
  expect(store.archive(portalId, 'rebuild')).toBe(moved)
  expect(readFileSync(moved, 'utf8')).toBe(bytes(state(7)))
  expect(store.read(portalId)).toBeNull()
})

test('an archive that cannot move the file is E_STATE_WRITE naming the reason, the file left in place', () => {
  const dir = temp()
  FileStateStore(dir).write(state(7), null)
  const { io: broken } = faulty('renameSync')
  const error = failure(() => FileStateStore(dir, { io: broken }).archive(portalId, 'rebind'))
  expect(error.issues[0]).toMatchObject({ code: 'E_STATE_WRITE' })
  expect(error.issues[0]?.message).toContain('could not archive it for rebind')
  expect(FileStateStore(dir).read(portalId)).toEqual(state(7))
})

test('newLineage is 16 lowercase hex characters, new each time', () => {
  const store = FileStateStore(temp())
  const lineages = Array.from({ length: 20 }, () => store.newLineage())
  for (const lineage of lineages) {
    expect(lineage).toMatch(hex16)
  }
  expect(new Set(lineages).size).toBe(20)
})
