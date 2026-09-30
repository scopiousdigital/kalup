// The project on disk: root discovery, the folder of object files, the file map core's loadFiles takes, and load(dir).
// Core never reads the disk.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  bin,
  type ConfigFile,
  DEFAULT_DIR,
  exitCodes,
  IssueError,
  KalupError,
  type Layout,
  LEGACY_DIR,
  type Loaded,
  layout,
  loadFiles,
  normalDir,
  read,
} from '@kalup/engine'
import { version } from '../version.js'
import { packageName } from './repo.js'

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

/**
 * The folder of object files: `dir` in kalup.config.ts, else hubspot/, else a 0.1 project's kalup/ when it holds .ts
 * files and hubspot/ holds none. When both hold .ts files neither is picked: E_DIR_AMBIGUOUS asks for `dir`, since
 * loading the wrong one would plan everything in the other as gone. Undefined for a stated dir outside the project,
 * which the loader reports; a config that cannot be read gets hubspot/, and the loader reports why.
 */
export function projectLayout(root: string): Layout | undefined {
  const stated = statedConfig(root)?.dir
  if (stated !== undefined) {
    const dir = normalDir(stated)
    return dir === undefined ? undefined : layout(dir)
  }
  if (!holdsTs(join(root, LEGACY_DIR))) {
    return layout(DEFAULT_DIR)
  }
  if (!holdsTs(join(root, DEFAULT_DIR))) {
    return layout(LEGACY_DIR, true)
  }
  throw new KalupError(
    {
      code: 'E_DIR_AMBIGUOUS',
      message: `both ${DEFAULT_DIR}/ and ${LEGACY_DIR}/ hold .ts files, and ${configFile} does not say which one holds the object files`,
      file: configFile,
      fix: `add dir: '${LEGACY_DIR}' to ${configFile} to keep the old folder, or dir: '${DEFAULT_DIR}' when the object files are there`,
    },
    exitCodes.invalid,
  )
}

// Whether `dir` is a folder with a .ts file anywhere in it.
function holdsTs(dir: string): boolean {
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    return false
  }
  return readdirSync(dir, { recursive: true, withFileTypes: true }).some(
    (entry) => entry.isFile() && entry.name.endsWith('.ts'),
  )
}

/** kalup.config.ts as the reader reads it, or undefined when there is none or it cannot be read. */
export function statedConfig(root: string): ConfigFile | undefined {
  const path = join(root, configFile)
  if (!existsSync(path)) {
    return undefined
  }
  try {
    const result = read(readFileSync(path, 'utf8'), configFile)
    return result.kind === 'config' ? (result.data as ConfigFile) : undefined
  } catch (error) {
    if (error instanceof IssueError) {
      return undefined
    }
    throw error
  }
}

// kalup.config.ts, the blueprints lock and every .ts file in the folder of object files, keyed by path relative to root
// with forward slashes. The stored originals under <dir>/.blueprints are JSON and never config, so they are not read.
// Without a layout (a dir outside the project) only kalup.config.ts.
export function readProjectFiles(root: string, at: Layout | undefined = projectLayout(root)): Record<string, string> {
  const files: Record<string, string> = {}
  for (const file of at === undefined ? [configFile] : [configFile, at.lock]) {
    if (existsSync(join(root, file))) {
      files[file] = readFileSync(join(root, file), 'utf8')
    }
  }
  const dir = at === undefined ? undefined : join(root, at.dir)
  if (dir === undefined || !existsSync(dir)) {
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
  const at = projectLayout(dir)
  const name = packageName(dir)
  return loadFiles(readProjectFiles(dir, at), {
    root: dir,
    version,
    ...(at === undefined ? {} : { layout: at }),
    ...(name === undefined ? {} : { name }),
  })
}
