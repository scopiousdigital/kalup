import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { KalupError } from '@kalup/engine'
import { afterEach, expect, test } from 'vitest'
import { acquirePortalLock, lockDir } from '../../src/lib/lock.js'

const host = hostname()
const children: ChildProcess[] = []
const unwritable: string[] = []

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL')
  }
  for (const dir of unwritable.splice(0)) {
    chmodSync(dir, 0o700)
  }
})

function temp(): string {
  return mkdtempSync(join(tmpdir(), 'kalup-lock-'))
}

async function refusal(pending: Promise<unknown>): Promise<KalupError> {
  const error = await pending.then(
    () => {
      throw new Error('expected the lock to be refused')
    },
    (e: unknown) => e,
  )
  if (!(error instanceof KalupError)) {
    throw error
  }
  return error
}

function holder(dir: string, portalId: number, record: Record<string, unknown>): string {
  const path = join(dir, `portal-${portalId}.lock`)
  writeFileSync(path, `${JSON.stringify(record)}\n`)
  return path
}

// The pid of a process that has exited.
function deadPid(): number {
  const { pid } = spawnSync(process.execPath, ['-e', ''])
  return pid
}

test('lockDir is KALUP_LOCK_DIR, else ~/.kalup/locks', () => {
  expect(lockDir({ KALUP_LOCK_DIR: '/srv/locks' })).toBe('/srv/locks')
  expect(lockDir({})).toBe(join(homedir(), '.kalup', 'locks'))
})

test('the lock file records the holder; a second acquisition of the portal, in this process too, is E_LOCKED', async () => {
  const dir = join(temp(), 'locks')
  const now = () => new Date('2026-09-24T10:00:00.000Z')
  const lock = await acquirePortalLock(2_222_222, { command: 'apply', planId: 'pl_7f3a1c07b2e4' }, { dir, now })
  expect(lock.path).toBe(join(dir, 'portal-2222222.lock'))
  expect(JSON.parse(readFileSync(lock.path, 'utf8'))).toEqual({
    pid: process.pid,
    host,
    command: 'apply',
    planId: 'pl_7f3a1c07b2e4',
    startedAt: '2026-09-24T10:00:00.000Z',
    portalId: 2_222_222,
  })
  const error = await refusal(acquirePortalLock(2_222_222, { command: 'state rebuild' }, { dir }))
  expect(error.exitCode).toBe(1)
  expect(error.issues).toEqual([
    {
      code: 'E_LOCKED',
      message: expect.stringContaining(`kalup apply for plan pl_7f3a1c07b2e4 on ${host}, pid ${process.pid}`),
      fix: expect.stringContaining(`delete ${lock.path}`),
    },
  ])
  lock.release()
  expect(existsSync(lock.path)).toBe(false)
  const again = await acquirePortalLock(2_222_222, { command: 'state rebuild' }, { dir })
  expect(JSON.parse(readFileSync(again.path, 'utf8'))).not.toHaveProperty('planId')
  again.release()
})

test('locks of different portals do not conflict', async () => {
  const dir = temp()
  const first = await acquirePortalLock(1_111_111, { command: 'apply' }, { dir })
  const second = await acquirePortalLock(2_222_222, { command: 'apply' }, { dir })
  expect(readdirSync(dir).sort()).toEqual(['portal-1111111.lock', 'portal-2222222.lock'])
  first.release()
  second.release()
  expect(readdirSync(dir)).toEqual([])
})

test('a lock left by a finished process of this host is never taken over: E_LOCKED names it and the file to delete', async () => {
  const dir = temp()
  const pid = deadPid()
  const record = { pid, host, command: 'apply', planId: 'pl_0a1b2c3d4e5f', startedAt: '2026-09-23T08:00:00.000Z' }
  const path = holder(dir, 2_222_222, record)
  const error = await refusal(acquirePortalLock(2_222_222, { command: 'apply' }, { dir }))
  expect(error.issues).toEqual([
    {
      code: 'E_LOCKED',
      message: `portal 2222222 is locked by kalup apply for plan pl_0a1b2c3d4e5f on ${host}, pid ${pid}, since 2026-09-23T08:00:00.000Z.`,
      fix: `wait for it to finish; delete ${path} only when no kalup command is running on ${host}`,
    },
  ])
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(record)
  expect(readdirSync(dir)).toEqual(['portal-2222222.lock'])
})

test('two acquirers racing on a stale lock both get E_LOCKED, and neither holds it', async () => {
  const dir = temp()
  const record = { pid: deadPid(), host, command: 'apply', startedAt: '2026-09-23T08:00:00.000Z' }
  const path = holder(dir, 2_222_222, record)
  const outcomes = await Promise.allSettled([
    acquirePortalLock(2_222_222, { command: 'apply' }, { dir }),
    acquirePortalLock(2_222_222, { command: 'target rebind' }, { dir }),
  ])
  expect(outcomes.map((o) => (o.status === 'rejected' ? (o.reason as KalupError).issues[0]?.code : 'held'))).toEqual([
    'E_LOCKED',
    'E_LOCKED',
  ])
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(record)
  expect(readdirSync(dir)).toEqual(['portal-2222222.lock'])
})

test('a lock held on another host is E_LOCKED naming that host', async () => {
  const dir = temp()
  const path = holder(dir, 2_222_222, {
    pid: deadPid(),
    host: 'build-agent-7',
    command: 'apply',
    planId: 'pl_0a1b2c3d4e5f',
    startedAt: '2026-09-24T09:00:00.000Z',
  })
  const error = await refusal(acquirePortalLock(2_222_222, { command: 'apply' }, { dir }))
  expect(error.issues[0]?.message).toContain('on build-agent-7')
  expect(error.issues[0]?.fix).toContain(`delete ${path} only when no kalup command is running on build-agent-7`)
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ host: 'build-agent-7' })
})

test('a lock file that cannot be read counts as held', async () => {
  const dir = temp()
  const path = join(dir, 'portal-2222222.lock')
  writeFileSync(path, '')
  const error = await refusal(acquirePortalLock(2_222_222, { command: 'apply' }, { dir }))
  expect(error.issues[0]).toEqual({
    code: 'E_LOCKED',
    message: expect.stringContaining(`the lock file ${path} cannot be read`),
    fix: expect.stringContaining(`delete ${path}`),
  })
  expect(readFileSync(path, 'utf8')).toBe('')
})

test('release leaves a lock file that another holder has written since', async () => {
  const dir = temp()
  const lock = await acquirePortalLock(2_222_222, { command: 'apply' }, { dir })
  const other = `${JSON.stringify({ pid: 4242, host, command: 'apply', startedAt: '2026-09-24T11:00:00.000Z' })}\n`
  writeFileSync(lock.path, other)
  lock.release()
  expect(readFileSync(lock.path, 'utf8')).toBe(other)
  lock.release()
})

test('a lock held by another running process blocks this one, and still does after it is killed, until deleted', async () => {
  const dir = temp()
  const path = join(dir, 'portal-2222222.lock')
  const script = [
    "const { writeFileSync } = require('node:fs')",
    "const { hostname } = require('node:os')",
    `const record = { pid: process.pid, host: hostname(), command: 'apply', planId: 'pl_5a6b7c8d9e0f', startedAt: new Date().toISOString(), portalId: 2222222 }`,
    `writeFileSync(${JSON.stringify(path)}, JSON.stringify(record) + '\\n', { flag: 'wx' })`,
    "process.stdout.write('held\\n')",
    'setInterval(() => undefined, 1000)',
  ].join('\n')
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  children.push(child)
  await new Promise<void>((resolve, reject) => {
    child.stdout?.once('data', () => resolve())
    child.once('exit', (code) => reject(new Error(`the holder exited early with ${code}`)))
  })
  const error = await refusal(acquirePortalLock(2_222_222, { command: 'apply' }, { dir }))
  expect(error.issues[0]?.message).toContain(`for plan pl_5a6b7c8d9e0f on ${host}, pid ${child.pid},`)
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
  const left = await refusal(acquirePortalLock(2_222_222, { command: 'apply' }, { dir }))
  expect(left.issues[0]?.message).toContain(`pid ${child.pid},`)
  unlinkSync(path)
  const lock = await acquirePortalLock(2_222_222, { command: 'apply' }, { dir })
  expect(JSON.parse(readFileSync(lock.path, 'utf8'))).toMatchObject({ pid: process.pid })
  lock.release()
})

test('a lock directory this user cannot write is E_LOCK_DIR naming KALUP_LOCK_DIR, with no fallback', async () => {
  const parent = temp()
  chmodSync(parent, 0o500)
  unwritable.push(parent)
  const dir = join(parent, 'locks')
  const error = await refusal(acquirePortalLock(2_222_222, { command: 'apply' }, { dir }))
  expect(error.issues).toEqual([
    {
      code: 'E_LOCK_DIR',
      message: expect.stringContaining(`${dir} cannot be written (EACCES)`),
      fix: expect.stringContaining('KALUP_LOCK_DIR'),
    },
  ])
  // A directory that exists but cannot take a new file is the same error.
  const readOnly = join(temp(), 'locks')
  mkdirSync(readOnly)
  chmodSync(readOnly, 0o500)
  unwritable.push(readOnly)
  const again = await refusal(acquirePortalLock(2_222_222, { command: 'apply' }, { dir: readOnly }))
  expect(again.issues[0]?.code).toBe('E_LOCK_DIR')
  // A path under a file is no directory at all.
  const file = join(temp(), 'file')
  writeFileSync(file, '')
  const under = await refusal(acquirePortalLock(2_222_222, { command: 'apply' }, { dir: join(file, 'locks') }))
  expect(under.issues[0]?.code).toBe('E_LOCK_DIR')
})
