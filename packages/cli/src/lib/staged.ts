// A staged write of several project files, so a command never leaves the project half-rewritten. Each file is copied to
// history, written in full to a temporary name beside it, then renamed over its path; a file to delete goes only after
// every rename succeeded. When a history copy, a write, a rename or a delete fails, every file already renamed or
// deleted gets its previous contents back (a new file is removed), the temporary files go, and E_PROJECT_WRITE says
// nothing changed, or names each file it could not put back. The command validates the candidate project first.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openHistory } from './history.js'
import { KalupError } from './output.js'

/** The file operations a staged write uses, injectable so the tests can make any one of them fail. */
export interface StagedIo {
  mkdirSync: typeof mkdirSync
  readFileSync: typeof readFileSync
  renameSync: typeof renameSync
  rmSync: typeof rmSync
  writeFileSync: typeof writeFileSync
}

const nodeIo: StagedIo = { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync }

/**
 * Writes `files` (path relative to `root` to its new text, or null to delete it) as one change: all of them or none.
 * Files whose text is already on disk, and deletes of files that do not exist, are left alone. Returns the paths
 * written or deleted, sorted.
 */
export function writeStaged(
  root: string,
  files: Record<string, string | null>,
  options: { io?: StagedIo; now?: Date } = {},
): string[] {
  const io = options.io ?? nodeIo
  const previous = previousOf(io, root, files)
  const changed = [...previous.keys()]
  if (changed.length === 0) {
    return []
  }
  const written = changed.filter((file) => files[file] !== null)
  const temp = (file: string) => `${join(root, file)}.kalup-${process.pid}.tmp`
  const done: string[] = []
  try {
    // A history copy that fails is a failed write too: nothing has been renamed yet.
    const history = openHistory(root, options.now)
    for (const file of changed) {
      history.save(file)
    }
    for (const file of written) {
      io.mkdirSync(dirname(join(root, file)), { recursive: true })
      io.writeFileSync(temp(file), files[file] ?? '')
    }
    for (const file of written) {
      io.renameSync(temp(file), join(root, file))
      done.push(file)
    }
    for (const file of changed.filter((f) => files[f] === null)) {
      io.rmSync(join(root, file))
      done.push(file)
    }
  } catch (error) {
    const restored = restore(io, root, done, previous)
    for (const file of written) {
      io.rmSync(temp(file), { force: true })
    }
    throw failed(error, changed, restored)
  }
  return changed
}

/** The paths `writeStaged` would write or delete, sorted: what a --dry-run reports. */
export function pending(root: string, files: Record<string, string | null>): string[] {
  return [...previousOf(nodeIo, root, files).keys()]
}

// Each file whose text on disk differs from `files`, in path order, with that text (null when there is no file).
function previousOf(io: StagedIo, root: string, files: Record<string, string | null>): Map<string, string | null> {
  const previous = new Map<string, string | null>()
  for (const file of Object.keys(files).sort()) {
    const before = current(io, join(root, file))
    if (before !== files[file]) {
      previous.set(file, before)
    }
  }
  return previous
}

// The text at `path`, or null when there is no file.
function current(io: StagedIo, path: string): string | null {
  try {
    return io.readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

// Puts back each renamed or deleted file's previous contents, or removes it when it is new. The files it could not put
// back.
function restore(io: StagedIo, root: string, done: string[], previous: Map<string, string | null>): string[] {
  const left: string[] = []
  for (const file of done) {
    const before = previous.get(file)
    try {
      if (before === null || before === undefined) {
        io.rmSync(join(root, file), { force: true })
      } else {
        io.writeFileSync(join(root, file), before)
      }
    } catch {
      left.push(file)
    }
  }
  return left
}

function failed(error: unknown, files: string[], left: string[]): KalupError {
  const code = (error as { code?: unknown } | null)?.code
  const why = typeof code === 'string' ? ` (${code})` : ''
  const state =
    left.length === 0
      ? 'Every file was left as it was.'
      : `These files could not be put back: ${left.join(', ')}; their previous text is under .kalup/history.`
  return new KalupError({
    code: 'E_PROJECT_WRITE',
    message: `could not write ${files.join(', ')}${why}. ${state}`,
    fix: 'check that the project directory is writable and the disk has room, then run the command again',
  })
}
