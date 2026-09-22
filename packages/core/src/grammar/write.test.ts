import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { read } from './read.js'
import { escapeString, write } from './write.js'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const dir = new URL('../../test/fixtures/grammar/', import.meta.url)
const fixture = (name: string) => readFileSync(new URL(name, dir), 'utf8')
const dollar = '$'

test('the barrel lists every object per file, type exports first, sorted', () => {
  const barrel = write('barrel', [
    { name: 'Subscription', from: './objects/subscription' },
    { name: 'Company', from: './objects/companies' },
    { name: 'Alpha', from: './objects/companies' },
  ])
  expect(barrel).toBe(
    [
      "export type { AlphaData, CompanyData } from './objects/companies'",
      "export { Alpha, Company } from './objects/companies'",
      "export type { SubscriptionData } from './objects/subscription'",
      "export { Subscription } from './objects/subscription'",
      '',
    ].join('\n'),
  )
  expect(write('barrel', [])).toBe('export {}\n')
})

test('escapeString escapes the backslash, the quote, whitespace controls and every other control character', () => {
  expect(escapeString("a\\b'c\nd\re\tf")).toBe("a\\\\b\\'c\\nd\\re\\tf")
  expect(escapeString('\0\x01\x1f\x7f\x85')).toBe('\\u0000\\u0001\\u001f\\u007f\\u0085')
  expect(escapeString(String.fromCharCode(0x2028, 0x2029))).toBe('\\u2028\\u2029')
  expect(escapeString('\ud800x')).toBe('\\ud800x')
  expect(escapeString(`"${dollar}{x}\` é 日本 😀`)).toBe(`"${dollar}{x}\` é 日本 😀`)
})

test('the written file is a valid module whose strings evaluate to the original values', () => {
  const value = `it's \\ a "test"\n\t${dollar}{x}\`\0\x7f${String.fromCharCode(0x2028)}`
  const literal = `'${escapeString(value)}'`
  expect(new Function(`return ${literal}`)()).toBe(value)
})

function biome(name: string, text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'kalup-grammar-')), name)
  writeFileSync(file, text)
  try {
    execFileSync(join(root, 'node_modules/.bin/biome'), ['check', `--config-path=${root}`, file], { encoding: 'utf8' })
    return ''
  } catch (e) {
    const { stdout, stderr } = e as { stdout: string; stderr: string }
    return `${stdout}\n${stderr}`
  }
}

test.each(['companies.ts', 'subscription.ts', 'invoices.ts', 'kalup.config.ts'])(
  '%s written passes biome unchanged',
  (name) => {
    const r = read(fixture(name), name)
    const text = r.kind === 'object' ? write('object', r.data) : write('config', r.data)
    expect(biome(name, text)).toBe('')
  },
)

const bare = {
  name: 'Deal',
  builder: 'defineObject' as const,
  object: 'deals',
  comments: [],
  groups: [],
  properties: [],
}

test.each([
  [
    'an export with no groups and no properties',
    'deals.ts',
    write('object', { imports: [], exports: [bare] }),
    [
      "import { defineObject, type InferProperties } from '@kalup/core'",
      '',
      "export const Deal = defineObject('deals', {})",
      '',
      'export type DealData = InferProperties<typeof Deal.properties> & { id: string }',
      '',
    ].join('\n'),
  ],
  [
    'a config with nothing in it',
    'kalup.config.ts',
    write('config', { imports: [], objects: {}, targets: {} }),
    "import { defineConfig } from 'kalup'\n\nexport default defineConfig({})\n",
  ],
  [
    'a target with no fields',
    'kalup.config.ts',
    write('config', { imports: [], objects: {}, targets: { sandbox: {} } }),
    "import { defineConfig } from 'kalup'\n\nexport default defineConfig({\n  targets: {\n    sandbox: {},\n  },\n})\n",
  ],
])('%s is written as {}, round-trips and passes biome unchanged', (_name, file, text, expected) => {
  expect(text).toBe(expected)
  const r = read(text, file)
  expect(r.kind === 'object' ? write('object', r.data) : write('config', r.data)).toBe(text)
  expect(biome(file, text)).toBe('')
})

test('the barrel passes biome unchanged', () => {
  const entries = [
    { name: 'Company', from: './objects/companies' },
    { name: 'Subscription', from: './objects/subscription' },
    { name: 'Invoice', from: './objects/invoices' },
    { name: 'Ticket', from: './objects/invoices' },
  ]
  expect(biome('index.ts', write('barrel', entries))).toBe('')
  expect(biome('index.ts', write('barrel', []))).toBe('')
})
