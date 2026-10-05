import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { type ReadResult, read } from '../../src/grammar/read.js'
import type { ConfigFile, ObjectExport, Property } from '../../src/grammar/types.js'
import { escapeString, write } from '../../src/grammar/write.js'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const dir = new URL('../fixtures/grammar/', import.meta.url)
const fixture = (name: string) => readFileSync(new URL(name, dir), 'utf8')
const dollar = '$'
const brokenGroup = /g: \{\n\s+(label: '.*'),\n\s+\}/

function rewrite(r: ReadResult): string {
  if (r.kind === 'object') {
    return write('object', r.data)
  }
  if (r.kind === 'pipeline') {
    return write('pipeline', r.data)
  }
  return r.kind === 'config' ? write('config', r.data) : write('removed', r.data)
}

// Where the tool keeps a file of each kind, for biome's per-path rules.
function home(r: ReadResult, name: string): string {
  if (r.kind === 'object') {
    return name
  }
  if (r.kind === 'pipeline') {
    return `hubspot/pipelines/${name}`
  }
  return r.kind === 'config' ? 'kalup.config.ts' : 'hubspot/removed.ts'
}

// 'kalup' was the config files' import before 0.1.0. It stays tool-owned, so the next write moves it to '@kalup/core'.
test.each([
  ['kalup.config.ts', 'defineConfig', "{\n  name: 'orchard',\n}"],
  ['hubspot/removed.ts', 'defineRemoved', "{\n  'property:companies/legacy_score': { action: 'destroy' },\n}"],
])('%s importing from kalup is written with the @kalup/core import', (file, helper, body) => {
  const old = `import { ${helper} } from 'kalup'\n\nexport default ${helper}(${body})\n`
  expect(rewrite(read(old, file))).toBe(old.replace("'kalup'", "'@kalup/core'"))
})

test('the barrel lists every object per file, type exports first, sorted', () => {
  const barrel = write('barrel', [
    { name: 'Subscription', from: './objects/subscription' },
    { name: 'Company', from: './objects/companies' },
    { name: 'Alpha', from: './objects/companies' },
  ])
  expect(barrel).toBe(
    [
      "export type { AlphaData, CompanyData } from './objects/companies.js'",
      "export { Alpha, Company } from './objects/companies.js'",
      "export type { SubscriptionData } from './objects/subscription.js'",
      "export { Subscription } from './objects/subscription.js'",
      '',
    ].join('\n'),
  )
  expect(write('barrel', [])).toBe('export {}\n')
})

test('escapeString escapes the backslash, the quote, whitespace controls and every other control character', () => {
  expect(escapeString("a\\b'c\nd\re\tf")).toBe("a\\\\b\\'c\\nd\\re\\tf")
  expect(escapeString('\0\x01\x1f\x7f\x85')).toBe('\\u0000\\u0001\\u001f\\u007f\\u0085')
  expect(escapeString(String.fromCharCode(0x20_28, 0x20_29))).toBe('\\u2028\\u2029')
  expect(escapeString('\ud800x')).toBe('\\ud800x')
  expect(escapeString(`"${dollar}{x}\` é 日本 😀`)).toBe(`"${dollar}{x}\` é 日本 😀`)
})

test('the written file is a valid module whose strings evaluate to the original values', () => {
  const value = `it's \\ a "test"\n\t${dollar}{x}\`\0\x7f${String.fromCharCode(0x20_28)}`
  const literal = `'${escapeString(value)}'`
  expect(new Function(`return ${literal}`)()).toBe(value)
})

// Lints `text` as the file `name`, a path under a fresh project root. biome.jsonc relaxes some rules for the files the
// tool writes, kalup.config.ts and hubspot/**, so a test names the file where the tool would write it.
function biome(name: string, text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'kalup-grammar-')), name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  try {
    execFileSync(join(root, 'node_modules/.bin/biome'), ['check', `--config-path=${root}`, file], { encoding: 'utf8' })
    return ''
  } catch (e) {
    const { stdout, stderr } = e as { stdout: string; stderr: string }
    return `${stdout}\n${stderr}`
  }
}

test.each([
  'companies.ts',
  'subscription.ts',
  'invoices.ts',
  'products.ts',
  'defaults.ts',
  'kalup.config.ts',
  'scoped.config.ts',
  'defaults.config.ts',
  'removed.ts',
  'deals.pipeline.ts',
  'every.pipeline.ts',
])('%s written passes biome unchanged', (name) => {
  const r = read(fixture(name), name)
  expect(biome(home(r, name), rewrite(r))).toBe('')
})

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
    "import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({})\n",
  ],
  [
    'a target with no fields',
    'kalup.config.ts',
    write('config', { imports: [], objects: {}, targets: { sandbox: {} } }),
    "import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({\n  targets: {\n    sandbox: {},\n  },\n})\n",
  ],
  [
    'a removed file with no tombstones',
    'hubspot/removed.ts',
    write('removed', { imports: [], tombstones: {} }),
    "import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({})\n",
  ],
])('%s is written as {}, round-trips and passes biome unchanged', (_name, file, text, expected) => {
  expect(text).toBe(expected)
  expect(rewrite(read(text, file))).toBe(text)
  expect(biome(file, text)).toBe('')
})

test('defaultTarget is written right after prefix, an empty string included, and round-trips', () => {
  const data: ConfigFile = {
    imports: [],
    name: 'orchard-crm',
    prefix: 'acme_',
    defaultTarget: '',
    objects: { companies: {} },
    targets: { client_b: { portalId: 4_444_444 } },
  }
  const text = write('config', data)
  expect(text).toBe(
    [
      "import { defineConfig } from '@kalup/core'",
      '',
      'export default defineConfig({',
      "  name: 'orchard-crm',",
      "  prefix: 'acme_',",
      "  defaultTarget: '',",
      '  objects: {',
      '    companies: {},',
      '  },',
      '  targets: {',
      '    client_b: {',
      '      portalId: 4444444,',
      '    },',
      '  },',
      '})',
      '',
    ].join('\n'),
  )
  const r = read(text, 'kalup.config.ts')
  expect(r.data).toEqual(data)
  expect(r.kind === 'config' && write('config', r.data)).toBe(text)
  expect(biome('kalup.config.ts', text)).toBe('')
})

// A reader in declaration order: whatever order the file holds, the data comes back as the writer orders it.
test('defaultTarget before name in the file is written back after prefix', () => {
  const text =
    "import { defineConfig } from '@kalup/core'\nexport default defineConfig({ defaultTarget: 'b', name: 'n' })\n"
  const r = read(text, 'kalup.config.ts')
  expect(Object.keys(r.data)).toEqual(['imports', 'name', 'defaultTarget', 'objects', 'targets'])
  expect(r.kind === 'config' && write('config', r.data)).toBe(
    "import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({\n  name: 'n',\n  defaultTarget: 'b',\n})\n",
  )
})

function labelled(key: string, label: string): Property {
  const chain = { required: false, readonly: false, managed: true }
  return { key, kind: 'string', name: key, definition: { label, group: 'g', fieldType: 'text' }, chain, comments: [] }
}

test('a string with a single quote and no double quote is double-quoted, as biome writes it', () => {
  expect(escapeString("it's", '"')).toBe("it's")
  expect(escapeString('say "hi"', '"')).toBe('say \\"hi\\"')
  const properties = [
    labelled('a', "Customer's name"),
    labelled('b', 'say "hi"'),
    labelled('c', `it's "mixed"`),
    labelled("it's", 'D'),
  ]
  const text = write('object', { imports: [], exports: [{ ...bare, properties }] })
  expect(text).toContain(`label: "Customer's name",`)
  expect(text).toContain(`label: 'say "hi"',`)
  expect(text).toContain(`label: 'it\\'s "mixed"',`)
  expect(text).toContain(`"it's": p.string("it's", {`)
  const r = read(text, 'deals.ts')
  expect(r.kind === 'object' && r.data.exports[0]?.properties).toEqual(properties)
  expect(biome('deals.ts', text)).toBe('')
})

test('a string array breaks past 120 columns, counting its indent and the trailing comma', () => {
  const names = (n: number, len: number) =>
    Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i).padEnd(len, '_'))
  const custom = (requiredProperties: string[]): ObjectExport => ({
    ...bare,
    builder: 'defineCustomObject',
    requiredProperties,
  })
  // 2 + 'requiredProperties: [' + six quoted names of 10 and one of 9 + 6 separators + '],' is exactly 120 columns.
  const flat = write('object', { imports: [], exports: [custom([...names(6, 10), 'g'.padEnd(9, '_')])] })
  const line = flat.split('\n').find((l) => l.includes('requiredProperties')) ?? ''
  expect(line).toHaveLength(120)
  expect(biome('deals.ts', flat)).toBe('')
  // One more column and it breaks.
  const broken = write('object', { imports: [], exports: [custom(names(7, 10))] })
  const lines = broken.split('\n')
  expect(lines.slice(lines.indexOf('  requiredProperties: ['), lines.indexOf('  ],') + 1)).toHaveLength(9)
  expect(lines).toContain("    'a_________',")
  expect(biome('deals.ts', broken)).toBe('')
})

test('an object literal breaks past 120 columns, and biome would break the flat form itself', () => {
  const groups = (n: number) => [{ name: 'g', label: 'x'.repeat(n), comments: [] }]
  // 4 + "g: { label: '" + n + "' }," is 21 + n columns.
  const flat = write('object', { imports: [], exports: [{ ...bare, groups: groups(99) }] })
  const line = flat.split('\n').find((l) => l.includes('label')) ?? ''
  expect(line).toHaveLength(120)
  expect(biome('deals.ts', flat)).toBe('')
  const broken = write('object', { imports: [], exports: [{ ...bare, groups: groups(100) }] })
  expect(broken).toContain(`    g: {\n      label: '${'x'.repeat(100)}',\n    },\n`)
  expect(biome('deals.ts', broken)).toBe('')
  // Biome keeps a broken object broken, so collapse it to prove biome breaks the 121-column form on its own.
  expect(biome('deals.ts', broken.replace(brokenGroup, 'g: { $1 }'))).not.toBe('')
})

// The spec keeps other imports verbatim, so the writer cannot make biome accept every file: biome rewrites double
// quotes and sorts a package import before a relative one. A known limit of the spec, recorded here, not fixed.
test('kept imports are verbatim, so double quotes or a package after a relative import fail biome', () => {
  const chain = { required: false, readonly: false, managed: true }
  const json = (key: string, validatorSource: string): Property => ({
    key,
    kind: 'json',
    name: key,
    json: { validatorSource },
    chain,
    comments: [],
  })
  const properties = [json('m', 'M'), json('z', 'z')]
  const file = (imports: string[]) => write('object', { imports, exports: [{ ...bare, properties }] })
  expect(biome('deals.ts', file(["import { z } from 'zod'", "import { M } from './m'"]))).toBe('')
  expect(biome('deals.ts', file(['import { z } from "zod"', "import { M } from './m'"]))).not.toBe('')
  expect(biome('deals.ts', file(["import { M } from './m'", "import { z } from 'zod'"]))).not.toBe('')
})

// Added by review: biome picks double quotes whenever a string holds more single quotes than double quotes, not
// only when it holds no double quote. Prose with three apostrophes and one quoted word is enough.
test('review: a string with more single quotes than double quotes is double-quoted, as biome writes it', () => {
  const label = `It's Bob's car, not Sue's "thing"`
  const text = write('object', { imports: [], exports: [{ ...bare, properties: [labelled('a', label)] }] })
  expect(text).toContain(`label: "It's Bob's car, not Sue's \\"thing\\"",`)
  expect(biome('deals.ts', text)).toBe('')
})

// Added by review: an array of two or more options forces every literal around it to break, as biome does. The
// writer only checks the literal it is writing, so a short override stays on one line and biome reformats it.
test('review: two options inside an override break the override and its definition, as biome writes it', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ]
  const config: ConfigFile = {
    imports: [],
    objects: {},
    targets: { prod: { portalId: 1, overrides: { 'property:a/b': { definition: { options } } } } },
  }
  const text = write('config', config)
  expect(text).toBe(
    [
      "import { defineConfig } from '@kalup/core'",
      '',
      'export default defineConfig({',
      '  targets: {',
      '    prod: {',
      '      portalId: 1,',
      '      overrides: {',
      "        'property:a/b': {",
      '          definition: {',
      '            options: [',
      "              { value: 'a', label: 'A' },",
      "              { value: 'b', label: 'B' },",
      '            ],',
      '          },',
      '        },',
      '      },',
      '    },',
      '  },',
      '})',
      '',
    ].join('\n'),
  )
  expect(biome('kalup.config.ts', text)).toBe('')
})

// Added by review: biome measures display columns, so an East Asian wide character counts as two. The writer
// counts UTF-16 code units, so five names of twelve CJK characters (105 code units, 165 columns) stay on one line.
test('review: a string array of wide characters breaks by display columns, as biome measures them', () => {
  const include = Array.from({ length: 5 }, () => '日本語日本語日本語日本語')
  const text = write('config', { imports: [], objects: { companies: { include } }, targets: {} })
  expect(text).toContain('  include: [\n')
  expect(biome('kalup.config.ts', text)).toBe('')
})

test('the barrel passes biome unchanged', () => {
  const entries = [
    { name: 'Company', from: './objects/companies' },
    { name: 'Subscription', from: './objects/subscription' },
    { name: 'Invoice', from: './objects/invoices' },
    { name: 'Ticket', from: './objects/invoices' },
  ]
  expect(biome('hubspot/index.ts', write('barrel', entries))).toBe('')
  expect(biome('hubspot/index.ts', write('barrel', []))).toBe('')
})

test('tombstones are written sorted by address in code-unit order, action before reason', () => {
  const text = write('removed', {
    imports: [],
    tombstones: {
      'property:companies/b': { reason: 'Old', action: 'destroy' },
      'group:companies/z': { action: 'release' },
      'property:companies/B': { action: 'release' },
    },
  })
  expect(text).toBe(
    [
      "import { defineRemoved } from '@kalup/core'",
      '',
      'export default defineRemoved({',
      "  'group:companies/z': { action: 'release' },",
      "  'property:companies/B': { action: 'release' },",
      "  'property:companies/b': { action: 'destroy', reason: 'Old' },",
      '})',
      '',
    ].join('\n'),
  )
  expect(biome('hubspot/removed.ts', text)).toBe('')
})

test('allowDestroy is written after drift and before credentials', () => {
  const config: ConfigFile = {
    imports: [],
    objects: {},
    targets: {
      sandbox: {
        credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
        allowDestroy: true,
        drift: 'overwrite',
        portalId: 4_141_414,
      },
    },
  }
  expect(write('config', config)).toContain(
    "    sandbox: {\n      portalId: 4141414,\n      drift: 'overwrite',\n      allowDestroy: true,\n      credentials:",
  )
})
