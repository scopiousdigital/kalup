// The engine boundary. The engine is host-agnostic: the CLI, and later other hosts, inject the process, the terminal,
// the file system and HTTP. The checks read the built dist, which is what the CLI inlines. boundary.test.ts checks the
// sources.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fresh } from '@kalup/tsconfig/stamp'
import { beforeAll, expect, test } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const IMPORT_FROM =
  /^\s*(?:import|export)\b[^'"\n]*?from\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']/gm
const HOST = /\bprocess\.|\bconsole\.|\brequire\(/

function bundle(): string {
  return readFileSync(new URL('../dist/index.mjs', import.meta.url), 'utf8')
}

beforeAll(() => {
  if (!fresh(root)) {
    throw new Error(`${root}dist does not match its sources: run pnpm --filter @kalup/engine build before the tests`)
  }
})

// node:crypto hashes plan digests and snapshot contents.
test('the bundle imports nothing but @kalup/core and node:crypto', () => {
  const imported = [...bundle().matchAll(IMPORT_FROM)].map((m) => m[1] ?? m[2] ?? m[3])
  expect(imported.filter((specifier) => specifier !== '@kalup/core' && specifier !== 'node:crypto')).toEqual([])
})

test('the bundle reads no process state and writes nothing to the console', () => {
  expect(bundle()).not.toMatch(HOST)
})

// The HTTP client's one attempt calls the fetch its host gave it, or the runtime's global fetch when none was given.
test('the bundle calls fetch in one place, the HTTP client', () => {
  expect(bundle().match(/\bfetch\(/g)).toHaveLength(1)
})
