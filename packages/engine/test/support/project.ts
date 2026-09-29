// Test helper: the fixture projects under test/fixtures/projects, read the way the CLI reads a project: kalup.config.ts,
// the blueprints lock and every .ts file under kalup/, keyed by path relative to the root with forward slashes.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCK_FILE } from '../../src/blueprint/lock.js'
import { type Loaded, loadFiles } from '../../src/loader/load.js'

const fixtures = fileURLToPath(new URL('../fixtures/projects/', import.meta.url))

/** The root of a fixture project. Read-only. */
export function project(name: string): string {
  return join(fixtures, name)
}

export function readProjectFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const file of ['kalup.config.ts', LOCK_FILE]) {
    if (existsSync(join(root, file))) {
      files[file] = readFileSync(join(root, file), 'utf8')
    }
  }
  const dir = join(root, 'kalup')
  if (!existsSync(dir)) {
    return files
  }
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      const full = join(entry.parentPath, entry.name)
      files[relative(root, full).split(sep).join('/')] = readFileSync(full, 'utf8')
    }
  }
  return files
}

/** The project under `root`, loaded. */
export function load(root: string): Loaded {
  return loadFiles(readProjectFiles(root), { root, version: '0.0.0' })
}
