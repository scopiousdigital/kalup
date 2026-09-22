// Test helper: reads test/fixtures/loader/<name>/ into the map loadFiles takes. Not exported from the package.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURES = new URL('../../test/fixtures/loader/', import.meta.url)

/** Every file under the fixture project, keyed by its path relative to the project root, forward slashes. */
export function project(name: string): Record<string, string> {
  const root = fileURLToPath(new URL(`${name}/`, FIXTURES))
  const files: Record<string, string> = {}
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath, entry.name)
    files[relative(root, full).split(sep).join('/')] = readFileSync(full, 'utf8')
  }
  return files
}

export function fixtureText(path: string): string {
  return readFileSync(new URL(path, FIXTURES), 'utf8')
}
