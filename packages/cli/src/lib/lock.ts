// The portal lock: one file per verified portal in a per-user directory, created exclusively. It serializes
// the cooperating writers of one user on one machine, across clones, worktrees and target names. Kalup never waits
// for it: a live holder is E_LOCKED, and a holder that finished on this host left a stale lock, which is taken over.
import { readFileSync, unlinkSync } from 'node:fs'
import { type FileHandle, link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { homedir, hostname as osHostname } from 'node:os'
import { join } from 'node:path'
import { bin } from '../brand.js'
import { KalupError } from './output.js'
import { sanitize } from './sanitize.js'

export interface LockHolder {
  command: string
  planId?: string
}

export interface LockOptions {
  /** The lock directory. Default: lockDir(). */
  dir?: string
  hostname?: string
  /** Whether a process of this host is running. Default: process.kill(pid, 0) does not throw ESRCH. */
  isAlive?: (pid: number) => boolean
  now?: () => Date
}

export interface PortalLock {
  path: string
  /** Removes the lock file, only while it still holds this acquisition's record. */
  release: () => void
}

interface LockRecord {
  command: string
  host: string
  pid: number
  planId?: string
  portalId: number
  startedAt: string
}

const UNWRITABLE = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOTDIR'])

/** KALUP_LOCK_DIR when set, else ~/.kalup/locks. */
export function lockDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.KALUP_LOCK_DIR || join(homedir(), '.kalup', 'locks')
}

/**
 * Takes the lock of one portal, or throws E_LOCKED naming its holder. A lock left by a finished process of this host
 * is renamed aside and the lock taken once more. A lock file that cannot be read counts as held. E_LOCK_DIR when the
 * directory cannot be written: never a fallback into the project.
 */
export async function acquirePortalLock(
  portalId: number,
  holder: LockHolder,
  options: LockOptions = {},
): Promise<PortalLock> {
  const dir = options.dir ?? lockDir()
  const host = options.hostname ?? osHostname()
  const isAlive = options.isAlive ?? processAlive
  const path = join(dir, `portal-${portalId}.lock`)
  const record: LockRecord = {
    pid: process.pid,
    host,
    command: holder.command,
    ...(holder.planId === undefined ? {} : { planId: holder.planId }),
    startedAt: (options.now?.() ?? new Date()).toISOString(),
    portalId,
  }
  const text = `${JSON.stringify(record)}\n`
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    throw unwritable(dir, error)
  }
  if (await create(path, text, dir)) {
    return held(path, text)
  }
  const found = await readRecord(path)
  if (!(found && found.record.host === host && !isAlive(found.record.pid))) {
    throw locked(portalId, found?.record, path)
  }
  // Stale. Renamed aside, then checked: a lock another process took in the meantime is put back and wins.
  const aside = `${path}.stale-${process.pid}-${Date.now()}`
  await rename(path, aside).catch(() => undefined)
  const moved = await readFile(aside, 'utf8').catch(() => undefined)
  if (moved !== undefined && moved !== found.text) {
    await link(aside, path).catch(() => undefined)
    await unlink(aside).catch(() => undefined)
    throw locked(portalId, parse(moved), path)
  }
  await unlink(aside).catch(() => undefined)
  if (await create(path, text, dir)) {
    return held(path, text)
  }
  throw locked(portalId, (await readRecord(path))?.record, path)
}

// Creates the lock file exclusively. False when it exists. A file this call created but could not fill is removed, so
// it never blocks the next run as an unreadable lock.
async function create(path: string, text: string, dir: string): Promise<boolean> {
  let handle: FileHandle
  try {
    handle = await open(path, 'wx')
  } catch (error) {
    if (codeOf(error) === 'EEXIST') {
      return false
    }
    throw UNWRITABLE.has(codeOf(error) ?? '') ? unwritable(dir, error) : error
  }
  try {
    await handle.writeFile(text)
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(path).catch(() => undefined)
    throw error
  }
  await handle.close()
  return true
}

function held(path: string, text: string): PortalLock {
  return {
    path,
    release(): void {
      try {
        if (readFileSync(path, 'utf8') === text) {
          unlinkSync(path)
        }
      } catch {
        // Already gone, or no longer readable: either way it is not this acquisition's to remove.
      }
    },
  }
}

async function readRecord(path: string): Promise<{ record: LockRecord; text: string } | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined)
  const record = text === undefined ? undefined : parse(text)
  return record && text !== undefined ? { record, text } : undefined
}

function parse(text: string): LockRecord | undefined {
  try {
    const value = JSON.parse(text) as Partial<LockRecord> | null
    return typeof value?.pid === 'number' && typeof value.host === 'string' ? (value as LockRecord) : undefined
  } catch {
    return undefined
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return codeOf(error) !== 'ESRCH'
  }
}

function locked(portalId: number, record: LockRecord | undefined, path: string): KalupError {
  if (!record) {
    return new KalupError({
      code: 'E_LOCKED',
      message: `portal ${portalId} is locked, and the lock file ${path} cannot be read.`,
      fix: `wait for it to finish; if no ${bin} command is running on this machine, delete ${path}`,
    })
  }
  const text = (value: unknown) => sanitize(String(value ?? 'unknown'))
  const plan = record.planId === undefined ? '' : ` for plan ${text(record.planId)}`
  return new KalupError({
    code: 'E_LOCKED',
    message: `portal ${portalId} is locked by ${bin} ${text(record.command)}${plan} on ${text(record.host)}, pid ${text(record.pid)}, since ${text(record.startedAt)}.`,
    fix: `wait for it to finish; if no ${bin} command is running on ${text(record.host)}, delete ${path}`,
  })
}

function unwritable(dir: string, error: unknown): KalupError {
  const code = codeOf(error)
  return new KalupError({
    code: 'E_LOCK_DIR',
    message: `the lock directory ${dir} cannot be written${code ? ` (${code})` : ''}.`,
    fix: 'set KALUP_LOCK_DIR to a directory this user can write, outside the project',
  })
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}
