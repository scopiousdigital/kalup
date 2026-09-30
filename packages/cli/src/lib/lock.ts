// The portal lock: one file per verified portal in a per-user directory, created exclusively. It serializes
// the cooperating writers of one user on one machine, across clones, worktrees and target names. Kalup never waits
// for it and never takes it over: a lock file that exists is E_LOCKED, even when its holder has ended, because no
// takeover by rename or delete is safe against a third contender. A person removes a lock that was left behind.
import { readFileSync, unlinkSync } from 'node:fs'
import { type FileHandle, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { homedir, hostname as osHostname } from 'node:os'
import { join } from 'node:path'
import { bin, KalupError, sanitize } from '@kalup/engine'

export interface LockHolder {
  command: string
  planId?: string
}

export interface LockOptions {
  /** The lock directory. Default: lockDir(). */
  dir?: string
  hostname?: string
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
 * Takes the lock of one portal, or throws E_LOCKED naming its holder and the lock file. A lock file that exists is
 * held, whether or not its holder still runs, and one that cannot be read too. E_LOCK_DIR when the directory cannot be
 * written: never a fallback into the project.
 */
export async function acquirePortalLock(
  portalId: number,
  holder: LockHolder,
  options: LockOptions = {},
): Promise<PortalLock> {
  const dir = options.dir ?? lockDir()
  const host = options.hostname ?? osHostname()
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
  throw locked(portalId, await readRecord(path), path, host)
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

async function readRecord(path: string): Promise<LockRecord | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) {
    return undefined
  }
  try {
    const value = JSON.parse(text) as Partial<LockRecord> | null
    return typeof value?.pid === 'number' && typeof value.host === 'string' ? (value as LockRecord) : undefined
  } catch {
    return undefined
  }
}

function locked(portalId: number, record: LockRecord | undefined, path: string, host: string): KalupError {
  if (!record) {
    return new KalupError({
      code: 'E_LOCKED',
      message: `portal ${portalId} is locked, and the lock file ${path} cannot be read.`,
      fix: `wait for it to finish; delete ${path} only when no ${bin} command is running on this machine`,
    })
  }
  const text = (value: unknown) => sanitize(String(value ?? 'unknown'))
  const plan = record.planId === undefined ? '' : ` for plan ${text(record.planId)}`
  const message = `portal ${portalId} is locked by ${bin} ${text(record.command)}${plan} on ${text(record.host)}, pid ${text(record.pid)}, since ${text(record.startedAt)}.`
  const deleteIt = `delete ${path} only when no ${bin} command is running on ${text(record.host)}`
  // Seen from its own host, a holder that has ended left the lock behind: there is nothing to wait for. It stays held.
  if (record.host === host && !running(record.pid)) {
    return new KalupError({
      code: 'E_LOCKED',
      message: `${message} That process has ended without releasing the lock.`,
      fix: `${deleteIt}, then run your command again`,
    })
  }
  return new KalupError({ code: 'E_LOCKED', message, fix: `wait for it to finish; ${deleteIt}` })
}

// Whether a process of this host runs. Signal 0 only checks; EPERM means it runs as another user.
function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return codeOf(error) !== 'ESRCH'
  }
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
