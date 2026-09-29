// The files a command reads or writes besides the project's own: a snapshot file named as an argument and an --out
// file. A path on the command line is relative to the directory the command runs in, not to the project root.
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { bin, KalupError, sanitize } from '@kalup/engine'
import { findRoot } from '../lib/load.js'
import { lockDir } from '../lib/lock.js'
import { stateDir } from '../lib/state.js'

const NO_FILE = new Set(['ENOENT', 'EISDIR', 'ENOTDIR'])
// The disks of macOS and Windows ignore case by default: there, .KALUP is .kalup.
const FOLD_CASE = process.platform === 'darwin' || process.platform === 'win32'
// A path is capped far above sanitize's default: a person needs all of it to find the file.
export const PATH_MAX = 1000

/** The text of the file at `path`, or undefined when no file is there. */
export function readArgFile(cwd: string, path: string): string | undefined {
  try {
    return readFileSync(resolve(cwd, path), 'utf8')
  } catch (error) {
    if (NO_FILE.has((error as NodeJS.ErrnoException).code ?? '')) {
      return undefined
    }
    throw error
  }
}

/**
 * Writes `text` to `path` and creates its directory. `exclusive` never replaces a file: false when one is there.
 * E_USAGE, before anything is written, for a symbolic link, which could lead anywhere, or a path among the files Kalup
 * keeps for itself (kalupOwned).
 */
export function writeArgFile(cwd: string, path: string, text: string, exclusive = false): boolean {
  const full = resolve(cwd, path)
  const named = sanitize(shown(cwd, path), PATH_MAX)
  if (lstatSync(full, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new KalupError({
      code: 'E_USAGE',
      message: `${named} is a symbolic link, and ${bin} writes only to a file itself. Nothing was written.`,
      fix: 'pass the path of a file that is not a link, for example plan.json in the project directory',
    })
  }
  const owner = kalupOwned(cwd, full)
  if (owner !== undefined) {
    throw new KalupError({
      code: 'E_USAGE',
      message: `${named} is inside ${owner}, where ${bin} keeps state, journals and locks. Nothing was written.`,
      fix: 'write the file outside .kalup/ and the lock directory, for example plan.json in the project directory',
    })
  }
  mkdirSync(dirname(full), { recursive: true })
  try {
    writeFileSync(full, text, { flag: exclusive ? 'wx' : 'w' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw error
  }
  return true
}

// Where an absolute path is among Kalup's own files, or undefined: under a .kalup directory other than its snapshots,
// under the lock directory, or under the state directory of the project `cwd` is in or its journals, which
// KALUP_STATE_DIR moves. Each side is compared where the disk puts it (located), never as text alone.
function kalupOwned(cwd: string, full: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const at = located(full)
  const parts = at.split(sep)
  const kalup = parts.indexOf('.kalup')
  if (kalup !== -1 && !(parts[kalup + 1] === 'snapshots' && kalup + 2 < parts.length)) {
    return '.kalup/'
  }
  const state = stateDir(projectRoot(cwd), env)
  const owned: [string, string][] = [
    [lockDir(env), 'the lock directory'],
    [state, env.KALUP_STATE_DIR ? 'KALUP_STATE_DIR' : 'the state directory'],
    [join(state, '..', 'journal'), 'the journal directory'],
  ]
  return owned.find(([dir]) => {
    const rel = relative(located(resolve(dir)), at)
    return !(rel.startsWith('..') || isAbsolute(rel))
  })?.[1]
}

// Where a write to the absolute `path` lands: the real path of its nearest existing ancestor, every symbolic link on
// the way resolved, then the rest of it, in lower case where the disk ignores case.
function located(path: string): string {
  let found: string
  try {
    found = realpathSync.native(path)
  } catch {
    const parent = dirname(path)
    found = parent === path ? path : join(located(parent), basename(path))
  }
  return FOLD_CASE ? found.toLowerCase() : found
}

// The root of the project `cwd` is in, whose state directory KALUP_STATE_DIR is taken from, or `cwd` outside one.
function projectRoot(cwd: string): string {
  try {
    return findRoot(cwd)
  } catch {
    return cwd
  }
}

/** A path as a command reports it: relative to `cwd`, with forward slashes, so it can be passed back from there. */
export function shown(cwd: string, path: string): string {
  return relative(cwd, resolve(cwd, path)).split(sep).join('/')
}

/** The line a command prints for a file it wrote. */
export function wrote(file: string): string {
  return `Wrote ${sanitize(file, PATH_MAX)}\n`
}
