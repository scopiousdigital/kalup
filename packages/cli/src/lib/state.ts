// State on disk: one kalup.state/1 file per verified portal, <stateDir>/portal-<portalId>.json. Every save
// compares the serial, writes a temporary file, keeps one .bak and renames over the file, so a failed save leaves the
// previous file intact. A save that changes no byte writes nothing.
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { stableStringify, type TargetState, validateState } from '@kalup/core'
import { bin } from '../brand.js'
import { KalupError } from './output.js'
import { sanitize } from './sanitize.js'

/** The file operations the store uses, injectable so the tests can make any one of them fail. */
export interface StateIo {
  closeSync: typeof closeSync
  copyFileSync: typeof copyFileSync
  fsyncSync: typeof fsyncSync
  mkdirSync: typeof mkdirSync
  openSync: typeof openSync
  readFileSync: typeof readFileSync
  renameSync: typeof renameSync
  rmSync: typeof rmSync
  writeSync: typeof writeSync
}

const nodeIo: StateIo = {
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

export interface StateFileStore {
  /** Moves the file to <dir>/archive/portal-<id>-<lineage>-<time>.json, ending its lineage. Null when there is none. */
  archive: (portalId: number, reason: string) => string | null
  /** 16 lowercase hex characters for a new lineage. */
  newLineage: () => string
  path: (portalId: number) => string
  /**
   * The state of one portal, or null when it has none. E_STATE_INVALID when the file cannot be read, is not JSON, names
   * a format other than kalup.state/1, does not match its schema, or describes another portal. `target` names the target
   * in the fix.
   */
  read: (portalId: number, target?: string) => TargetState | null
  /**
   * Saves `next` when the stored serial is `expectSerial` (null: no file), else E_STATE_CONFLICT. True when the file
   * changed; false when its bytes already equal `next`. The caller raises the serial when something changed.
   */
  write: (next: TargetState, expectSerial: number | null) => boolean
}

export interface StateStoreOptions {
  io?: StateIo
  now?: () => Date
}

const FORMAT = 'kalup.state/1'
const COMPACT = /[-:.]/g
const notJson = Symbol('not JSON')
const GITDIR = /^gitdir:\s*(.+)$/m
const STATE = join('.kalup', 'state')

/**
 * Where state lives for the project at `projectRoot`: KALUP_STATE_DIR when set (a relative value is taken from the
 * project root); in a linked git worktree, the same project path in the main worktree, so every worktree of one clone
 * shares state; else <projectRoot>/.kalup/state. Worktrees are found by reading git's files, never by running git, and
 * anything unexpected falls back to the project's own directory.
 */
export function stateDir(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const set = env.KALUP_STATE_DIR
  if (set) {
    return resolve(projectRoot, set)
  }
  const root = resolve(projectRoot)
  const main = mainWorktree(root)
  return main === undefined ? join(root, STATE) : join(main.root, relative(main.worktree, root), STATE)
}

// The main worktree's root and the worktree holding `root`, when `root` is inside a linked worktree.
function mainWorktree(root: string): { root: string; worktree: string } | undefined {
  const worktree = nearestGit(root)
  if (worktree === undefined) {
    return undefined
  }
  try {
    const dotGit = join(worktree, '.git')
    if (statSync(dotGit).isDirectory()) {
      return undefined
    }
    const pointer = GITDIR.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim()
    if (!pointer) {
      return undefined
    }
    const gitdir = resolve(worktree, pointer)
    const common = resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim())
    const mainRoot = dirname(common)
    const linked = basename(common) === '.git' && basename(dirname(gitdir)) === 'worktrees'
    return linked && statSync(mainRoot).isDirectory() ? { root: mainRoot, worktree } : undefined
  } catch {
    return undefined
  }
}

function nearestGit(from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) {
      return dir
    }
    if (dirname(dir) === dir) {
      return undefined
    }
  }
}

/** The state files under `dir`, one per portal. */
export function FileStateStore(dir: string, options: StateStoreOptions = {}): StateFileStore {
  const io = options.io ?? nodeIo
  const now = options.now ?? (() => new Date())
  const path = (portalId: number) => join(dir, `portal-${portalId}.json`)

  // The file's text, or null when there is none. Any other read failure is the caller's KalupError.
  function text(file: string, failed: (error: unknown) => KalupError): string | null {
    try {
      return io.readFileSync(file, 'utf8')
    } catch (error) {
      if (codeOf(error) === 'ENOENT') {
        return null
      }
      throw failed(error)
    }
  }

  function read(portalId: number, target?: string): TargetState | null {
    const file = path(portalId)
    const found = text(file, (error) => unreadable(file, error))
    return found === null ? null : parse(found, file, portalId, target)
  }

  function write(next: TargetState, expectSerial: number | null): boolean {
    const file = path(next.portalId)
    const current = text(file, (error) => stateWrite(file, error))
    const stored = current === null ? null : parse(current, file, next.portalId).serial
    if (stored !== expectSerial) {
      throw new KalupError({
        code: 'E_STATE_CONFLICT',
        message: `${file} changed while this command ran: its serial is ${stored ?? 'absent'}, not ${expectSerial ?? 'absent'}. Nothing was saved.`,
        file,
        fix: `another ${bin} command wrote state for portal ${next.portalId}; run ${bin} plan again`,
      })
    }
    const problems = validateState(next)
    if (problems.length > 0) {
      throw new Error(`refusing to save state that does not match kalup.state/1: ${problems[0]?.message}`)
    }
    const bytes = `${stableStringify(next)}\n`
    if (bytes === current) {
      return false
    }
    const temp = `${file}.tmp-${process.pid}`
    try {
      io.mkdirSync(dir, { recursive: true })
      const fd = io.openSync(temp, 'w')
      try {
        writeAll(io.writeSync, fd, bytes)
        io.fsyncSync(fd)
      } finally {
        io.closeSync(fd)
      }
      if (current !== null) {
        io.copyFileSync(file, `${file}.bak`)
      }
      io.renameSync(temp, file)
    } catch (error) {
      io.rmSync(temp, { force: true })
      throw stateWrite(file, error)
    }
    syncDir(dir, io)
    return true
  }

  function archive(portalId: number, reason: string): string | null {
    const state = read(portalId)
    if (state === null) {
      return null
    }
    const stamp = now().toISOString().replace(COMPACT, '')
    const moved = join(dir, 'archive', `portal-${portalId}-${state.lineage}-${stamp}.json`)
    try {
      io.mkdirSync(dirname(moved), { recursive: true })
      io.renameSync(path(portalId), moved)
    } catch (error) {
      throw stateWrite(path(portalId), error, `could not archive it for ${reason}`)
    }
    return moved
  }

  return { path, read, write, archive, newLineage: () => randomBytes(8).toString('hex') }
}

function parse(text: string, file: string, portalId: number, target?: string): TargetState {
  const document = parseJson(text)
  if (document === notJson) {
    throw invalid(file, 'is not JSON', target)
  }
  // Another format is another version's state: never read as this one, and never rebuilt over, which would lose it.
  const format = (document as { format?: unknown } | null)?.format
  if (typeof format === 'string' && format !== FORMAT) {
    throw new KalupError({
      code: 'E_STATE_INVALID',
      message: `${file} is ${sanitize(format)}, and this version of ${bin} reads ${FORMAT}.`,
      file,
      fix: `use the version of ${bin} that wrote it, or a newer one`,
    })
  }
  const issues = validateState(document)
  if (issues.length > 0) {
    const [first] = issues
    const at = first?.configPath ? ` at ${first.configPath}` : ''
    throw invalid(file, `does not match ${FORMAT}${at}: ${first?.message}`, target)
  }
  const state = document as TargetState
  if (state.portalId !== portalId) {
    throw invalid(file, `describes portal ${state.portalId}, not portal ${portalId}`, target)
  }
  return state
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return notJson
  }
}

function invalid(file: string, why: string, target = '<target>'): KalupError {
  return new KalupError({
    code: 'E_STATE_INVALID',
    message: `${file} ${why}.`,
    file,
    fix: `rename ${basename(file)}.bak, the state before its last save, into its place if it reads; else move the file away and run ${bin} state rebuild --target ${target}`,
  })
}

function unreadable(file: string, error: unknown): KalupError {
  const code = codeOf(error)
  return new KalupError({
    code: 'E_STATE_INVALID',
    message: `${file} could not be read${code ? ` (${code})` : ''}.`,
    file,
    fix: 'check that this user can read the state file and its directory, then run the command again',
  })
}

function stateWrite(file: string, error: unknown, what = 'could not save it'): KalupError {
  const code = codeOf(error)
  return new KalupError({
    code: 'E_STATE_WRITE',
    message: `${file}: ${what}${code ? ` (${code})` : ''}. The previous file is intact.`,
    file,
    fix: 'check that the state directory is writable and the disk has room, then run the command again',
  })
}

/**
 * Writes all of `text`: one write(2) may take only part of it, so this writes the rest until none is left, and a write
 * that takes nothing throws rather than leave a short file.
 */
export function writeAll(write: typeof writeSync, fd: number, text: string): void {
  const buffer = Buffer.from(text)
  let offset = 0
  while (offset < buffer.length) {
    const written = write(fd, buffer, offset, buffer.length - offset)
    if (!(written > 0)) {
      throw Object.assign(new Error('a write took no bytes'), { code: 'EIO' })
    }
    offset += written
  }
}

// Flushes the rename where the platform can open a directory; Windows cannot, and the rename stands without it.
function syncDir(dir: string, io: StateIo): void {
  let fd: number | undefined
  try {
    fd = io.openSync(dir, 'r')
    io.fsyncSync(fd)
  } catch {
    // Not supported here.
  } finally {
    if (fd !== undefined) {
      io.closeSync(fd)
    }
  }
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}
