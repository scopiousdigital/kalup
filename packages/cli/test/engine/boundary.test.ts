// The engine boundary: engine code reaches no command, no host, no oclif and no file system, directly or through the
// lib modules it imports. Commands own the disk, the keys and the text.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const src = fileURLToPath(new URL('../../src/', import.meta.url))
const engine = join(src, 'engine')
const specifiers = /(?:from|import)\s*\(?\s*'([^']+)'/g
const jsExtension = /\.js$/
const forbidden = /^(node:)?fs(\/|$)|^@oclif\//

// Every module of this package the engine loads, relative to src, and every package specifier those modules import.
function closure(): { modules: string[]; packages: string[] } {
  const queue = readdirSync(engine)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(engine, name))
  const modules = new Set(queue)
  const packages = new Set<string>()
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const [, specifier = ''] of readFileSync(file, 'utf8').matchAll(specifiers)) {
      if (!specifier.startsWith('.')) {
        packages.add(specifier)
        continue
      }
      const next = resolve(dirname(file), specifier.replace(jsExtension, '.ts'))
      if (!modules.has(next)) {
        modules.add(next)
        queue.push(next)
      }
    }
  }
  return { modules: [...modules].map((file) => relative(src, file)).sort(), packages: [...packages].sort() }
}

test('no file in src/engine imports from src/commands, src/host, @oclif/core or node:fs, even indirectly', () => {
  const { modules, packages } = closure()
  expect(modules).toContain('engine/observe.ts')
  expect(modules).toContain('engine/preflight.ts')
  // plan names the CLI and warns about pins, so the brand stays off the disk; the version module reads it.
  expect(modules).toContain('brand.ts')
  expect(modules).toContain('lib/pins.ts')
  expect(modules).not.toContain('version.ts')
  expect(modules.filter((file) => file.startsWith('commands/') || file.startsWith('host/'))).toEqual([])
  expect(packages.filter((name) => forbidden.test(name))).toEqual([])
})
