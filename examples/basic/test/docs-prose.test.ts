// The docs pages describe this example, so they are checked next to it: no em dash, none of the words public docs
// keep out, and the disclaimer on every page. apps/web has no test runner of its own.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const docs = fileURLToPath(new URL('../../../apps/web/content/docs/', import.meta.url))
const banned = ['—', 'bridge', 'extension', 'cookie', 'session', 'internal api', 'private api', 'pricing']
const disclaimer = 'kalup is an independent open-source project maintained by scopious'

test('every docs page is free of em dashes and the words public docs keep out, and carries the disclaimer', () => {
  const pages = readdirSync(docs).filter((file) => file.endsWith('.mdx'))
  assert.ok(pages.length > 0)
  for (const page of pages) {
    const text = readFileSync(join(docs, page), 'utf8').toLowerCase()
    for (const word of banned) assert.ok(!text.includes(word), `${page} contains '${word}'`)
    assert.ok(text.includes(disclaimer), `${page} lacks the disclaimer`)
  }
})
