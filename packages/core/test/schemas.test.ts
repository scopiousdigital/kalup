// The JSON Schemas under schemas/ are a covered contract (docs/compatibility.md), so a tool reaches each one through
// the package's exports, not by a deep import.
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const dir = fileURLToPath(new URL('../schemas/', import.meta.url))
const require = createRequire(import.meta.url)

test('every schema the package ships resolves as @kalup/core/schemas/<file>', () => {
  const names = readdirSync(dir).filter((name) => name.endsWith('.schema.json'))
  expect(names.length).toBeGreaterThan(0)
  for (const name of names) {
    expect(require.resolve(`@kalup/core/schemas/${name}`), name).toBe(`${dir}${name}`)
  }
})
