// Before the tool overwrites a project file, the old one is copied to .kalup/history/<timestamp>/<path>. The timestamp
// is compact ISO, as the journal writes it: a colon is not allowed in a Windows file name.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const historyKeep = 20

const COMPACT = /[-:.]/g

export interface History {
  dir: string
  /** Copies `file` (relative to the project root) into this run's folder. A file that does not exist yet is skipped. */
  save: (file: string) => void
}

/** Opens one history folder for this run and prunes the folders beyond the last 20. */
export function openHistory(root: string, now = new Date()): History {
  const historyRoot = join(root, '.kalup', 'history')
  const dir = join(historyRoot, now.toISOString().replace(COMPACT, ''))
  return {
    dir,
    save(file) {
      const source = join(root, file)
      if (!existsSync(source)) {
        return
      }
      const dest = join(dir, file)
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(source, dest)
      const stamps = readdirSync(historyRoot).sort()
      for (const stamp of stamps.slice(0, Math.max(0, stamps.length - historyKeep))) {
        rmSync(join(historyRoot, stamp), { recursive: true, force: true })
      }
    },
  }
}
