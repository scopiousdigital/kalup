// The project on disk: root discovery, the file map core's loadFiles takes, and load(dir). Core never reads the disk.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { bin, KalupError, LOCK_FILE, type Loaded, loadFiles } from '@kalup/engine'
import { version } from '../version.js'

const configFile = 'kalup.config.ts'

/** The nearest directory, from `cwd` upwards, that holds kalup.config.ts. E_NO_CONFIG when none does. */
export function findRoot(cwd: string): string {
  let dir = resolve(cwd)
  while (!existsSync(join(dir, configFile))) {
    const parent = dirname(dir)
    if (parent === dir) {
      throw new KalupError({
        code: 'E_NO_CONFIG',
        message: `no ${configFile} in ${cwd} or any directory above it`,
        fix: `run npx ${bin} init --portal <id> in the project directory`,
      })
    }
    dir = parent
  }
  return dir
}

// kalup.config.ts, the blueprints lock and every .ts file under kalup/, keyed by path relative to root with forward
// slashes. The stored originals under kalup/.blueprints are JSON and never config, so they are not read.
export function readProjectFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const file of [configFile, LOCK_FILE]) {
    if (existsSync(join(root, file))) {
      files[file] = readFileSync(join(root, file), 'utf8')
    }
  }
  const dir = join(root, 'kalup')
  if (!existsSync(dir)) {
    return files
  }
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!(entry.isFile() && entry.name.endsWith('.ts'))) {
      continue
    }
    const full = join(entry.parentPath, entry.name)
    files[relative(root, full).split(sep).join('/')] = readFileSync(full, 'utf8')
  }
  return files
}

/** Reads the project under `dir` and hands it to core's loadFiles, which throws an IssueError when it cannot load. */
export function load(dir: string): Loaded {
  return loadFiles(readProjectFiles(dir), { root: dir, version })
}
