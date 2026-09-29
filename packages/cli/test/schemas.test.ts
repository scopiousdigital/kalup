// The JSON Schemas are a covered contract (docs/compatibility.md). They describe what the CLI writes, so the kalup
// package ships them, copied from the engine at build time, and a tool reaches each one through the package's exports,
// not by a deep import.
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { checkBuild } from '../src/commands/testing.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = fileURLToPath(new URL('../../engine/schemas/', import.meta.url))
const shipped = fileURLToPath(new URL('../dist/schemas/', import.meta.url))
const require = createRequire(import.meta.url)

test('every schema the engine holds resolves as kalup/schemas/<file>, byte for byte', () => {
  checkBuild(root, 'pnpm --filter kalup build')
  const names = readdirSync(source).filter((name) => name.endsWith('.schema.json'))
  expect(names.length).toBeGreaterThan(0)
  expect(readdirSync(shipped).sort()).toEqual(names.sort())
  for (const name of names) {
    const path = require.resolve(`kalup/schemas/${name}`)
    expect(path, name).toBe(`${shipped}${name}`)
    expect(readFileSync(path, 'utf8'), name).toBe(readFileSync(`${source}${name}`, 'utf8'))
  }
})
