import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { read } from '../../src/grammar/read.js'
import { IssueError } from '../../src/grammar/types.js'
import type { Issue } from '../../src/ir/types.js'

const errors = new URL('../fixtures/grammar/errors/', import.meta.url)
const head = "import { defineObject, type InferProperties, p } from '@kalup/core'\n"

function issue(text: string, file = 'kalup/objects/deals.ts'): Issue {
  try {
    read(text, file)
  } catch (e) {
    if (e instanceof IssueError) return e.issues[0] as Issue
    throw e
  }
  throw new Error('expected read to throw')
}

test.each([
  ['E_NOT_DATA', 6, 'move this comment above the entry it describes'],
  [
    'E_UNKNOWN_BUILDER',
    6,
    'use one of p.string, p.number, p.boolean, p.date, p.datetime, p.enum, p.multiEnum, p.stringArray, p.json',
  ],
  ['E_BAD_CHAIN', 5, 'call it once'],
  ['E_DUPLICATE_KEY', 7, 'remove or rename one of the two entries'],
  ['E_MISSING_EXPORT', 1, "add `export const <Name> = defineObject('<object>', {...})`"],
])('%s fixture reports file, line and fix', (code, line, fix) => {
  const file = `kalup/objects/${code}.ts`
  const i = issue(readFileSync(new URL(`${code}.txt`, errors), 'utf8'), file)
  expect(i).toMatchObject({ code, file, line, fix })
  expect(i.message).toBeTruthy()
})

test('E_UNKNOWN_BUILDER names the builder and the property path', () => {
  const i = issue(
    `${head}export const Deal = defineObject('deals', {\n  properties: {\n    notes: p.text('notes'),\n  },\n})\n`,
  )
  expect(i).toMatchObject({
    code: 'E_UNKNOWN_BUILDER',
    message: 'p.text is not a builder',
    configPath: 'Deal.properties.notes',
    line: 4,
  })
})

test.each([
  ['.managed(true)', '.managed(true) is not allowed', 'write .managed(false) or drop the call'],
  ['.managed()', ".managed(')') is not allowed", 'write .managed(false) or drop the call'],
  ['.readonly().readonly()', '.readonly() is called twice', 'call it once'],
  ['.managed(false).managed(false)', '.managed() is called twice', 'call it once'],
  ['.optional()', '.optional() is not a chain call', 'use .required(), .readonly() or .managed(false)'],
  ['.required(1)', '.required() takes no argument', 'write .required()'],
])('E_BAD_CHAIN on %s', (chain, message, fix) => {
  const i = issue(
    `${head}export const Deal = defineObject('deals', {\n  properties: {\n    amount: p.number('amount')${chain},\n  },\n})\n`,
  )
  expect(i).toMatchObject({ code: 'E_BAD_CHAIN', message, fix, line: 4, configPath: 'Deal.properties.amount' })
})

test('E_DUPLICATE_KEY carries the path of the repeated key', () => {
  const text = `${head}export const Deal = defineObject('deals', {\n  groups: { a: { label: 'A' }, a: { label: 'B' } },\n})\n`
  expect(issue(text)).toMatchObject({
    code: 'E_DUPLICATE_KEY',
    message: "duplicate key 'a'",
    configPath: 'Deal.groups.a',
    line: 3,
  })
})

test('E_DUPLICATE_KEY on two exports with one name', () => {
  const text = `${head}export const Deal = defineObject('deals', {})\nexport const Deal = defineObject('deals', {})\n`
  expect(issue(text)).toMatchObject({ code: 'E_DUPLICATE_KEY', message: "duplicate export 'Deal'", line: 3 })
})

test('E_MISSING_EXPORT on a file with only imports', () => {
  expect(issue(head)).toMatchObject({ code: 'E_MISSING_EXPORT', line: 1 })
})

const deal = (body: string) => `${head}export const Deal = defineObject('deals', {\n${body}\n})\n`

test.each([
  [
    'a spread',
    deal('  properties: { ...shared },'),
    3,
    'write key: value entries only; no spreads, computed keys or shorthand',
  ],
  ['a template string', deal('  properties: { a: p.string(`a`) },'), 3, 'use a single-quoted string'],
  ['an identifier as a value', deal('  properties: { a: shared },'), 3, undefined],
  ['a call other than a builder', deal("  properties: { a: helper('a') },"), 3, undefined],
  [
    'a block comment',
    deal("  /* groups */\n  properties: { a: p.string('a') },"),
    3,
    'use a // comment above the entry it describes',
  ],
  [
    'a comment between two imports',
    `${head}// why\nimport { M } from './m'\n${deal("  properties: { a: p.string('a') },")}`,
    3,
    undefined,
  ],
  [
    'a comment before a non-entry key',
    deal("  // the properties\n  properties: { a: p.string('a') },"),
    3,
    'move this comment above the entry it describes',
  ],
  [
    'a comment inside a definition',
    deal("  properties: { a: p.string('a', {\n    // label\n    label: 'A' }) },"),
    4,
    'move this comment above the entry it describes',
  ],
  [
    'a comment before the type line',
    `${deal("  properties: { a: p.string('a') },")}// data\nexport type DealData = InferProperties<typeof Deal.properties> & { id: string }\n`,
    5,
    'move this comment above the entry it describes',
  ],
  [
    'an unknown definition field',
    deal("  properties: { a: p.string('a', { label: 'A', group: 'g', fieldType: 'text', unique: true }) },"),
    3,
    'use one of label, group, fieldType, description, options, hasUniqueValue, formField, lifecycle',
  ],
  ['a wrong value type', deal("  properties: { a: p.string('a', { label: 1 }) },"), 3, 'write a single-quoted string'],
  [
    'an option without a label',
    deal("  properties: { a: p.enum('a', { options: [{ value: 'x' }] }) },"),
    3,
    'add label',
  ],
  [
    'a bad lifecycle mode',
    deal("  properties: { a: p.enum('a', { lifecycle: { options: 'strict' } }) },"),
    3,
    "write one of 'additive', 'exact'",
  ],
  [
    'labels on defineObject',
    deal("  labels: { singular: 'Deal', plural: 'Deals' },"),
    3,
    'use one of groups, properties',
  ],
  [
    'a wrong type name',
    `${deal("  properties: { a: p.string('a') },")}export type Deal = InferProperties<typeof Deal.properties> & { id: string }\n`,
    5,
    undefined,
  ],
  [
    'a type line for an unknown export',
    `${deal("  properties: { a: p.string('a') },")}export type OtherData = InferProperties<typeof Other.properties> & { id: string }\n`,
    5,
    undefined,
  ],
  ['a top-level statement', `${deal("  properties: { a: p.string('a') },")}const x = 1\n`, 5, undefined],
  ['an unknown export builder', `${head}export const Deal = defineThing('deals', {})\n`, 2, undefined],
  [
    'a p.json without a validator',
    deal("  properties: { a: p.json('a') },"),
    3,
    'add the validator as the second argument',
  ],
  ['an unbalanced validator', deal("  properties: { a: p.json('a', z.object({ }, { label: 'A' }) },"), 3, undefined],
  [
    'a config with two statements',
    "import { defineConfig } from 'kalup'\nexport default defineConfig({})\nexport const x = 1\n",
    3,
    undefined,
  ],
  [
    'a config with skip: false',
    "import { defineConfig } from 'kalup'\nexport default defineConfig({ targets: { a: { overrides: { 'x:y': { skip: false } } } } })\n",
    2,
    'write true or drop the field',
  ],
])('E_NOT_DATA on %s', (_name, text, line, fix) => {
  const i = issue(text)
  expect(i.code).toBe('E_NOT_DATA')
  expect(i.line).toBe(line)
  expect(i.fix).toBeTruthy()
  if (fix) expect(i.fix).toBe(fix)
})

test('a second type line for one export is E_NOT_DATA at the duplicate', () => {
  const type = 'export type DealData = InferProperties<typeof Deal.properties> & { id: string }\n'
  const i = issue(`${deal("  properties: { a: p.string('a') },")}${type}${type}`)
  expect(i).toMatchObject({
    code: 'E_NOT_DATA',
    message: "'DealData' is exported twice",
    line: 6,
    fix: 'remove the duplicate type export',
  })
})

const body = deal("  properties: { a: p.string('a') },")

test.each([
  ['with a blank line', `// one\n// two\n\n${body}`],
  ['without a blank line', `// one\n// two\n${body}`],
])('a comment block before the imports is the file header, %s', (_name, text) => {
  const r = read(text, 'deals.ts')
  expect(r.kind === 'object' && r.data.header).toEqual(['one', 'two'])
  expect(r.kind === 'object' && r.data.exports[0]?.comments).toEqual([])
})

test('the header of a config file is read the same way', () => {
  const r = read("// scope\nimport { defineConfig } from 'kalup'\nexport default defineConfig({})\n", 'kalup.config.ts')
  expect(r.kind === 'config' && r.data.header).toEqual(['scope'])
})

test('a file without a header has no header field', () => {
  expect(read(body, 'deals.ts').data).not.toHaveProperty('header')
})

test('with no import statement a leading comment belongs to the first export, not the header', () => {
  const r = read(`// about Deal\n${body.slice(head.length)}`, 'deals.ts')
  expect(r.data).not.toHaveProperty('header')
  expect(r.kind === 'object' && r.data.exports[0]?.comments).toEqual(['about Deal'])
})

test('a line separator in the header is E_NOT_DATA', () => {
  expect(issue(`// note\u{2028}process.exit(1)\n${body}`)).toMatchObject({ code: 'E_NOT_DATA', line: 1 })
})

test('E_NOT_DATA on an unattached comment carries the config path', () => {
  const i = issue(deal("  properties: {\n    a: p.string('a'),\n    // dangling\n  },"))
  expect(i).toMatchObject({ code: 'E_NOT_DATA', line: 5, configPath: 'Deal.properties' })
})

test('the message of an IssueError names the code, file and line', () => {
  expect(() => read(head, 'kalup/objects/deals.ts')).toThrow(
    'E_MISSING_EXPORT: no defineObject or defineCustomObject export in this file (kalup/objects/deals.ts:1)',
  )
})

// Added by review: the reader accepted each of these and the writer moved or re-emitted text.
test.each([
  [
    'a trailing comment on a property',
    deal("  properties: {\n    a: p.string('a'), // about a\n    b: p.string('b'),\n  },"),
    4,
  ],
  [
    'a trailing comment on a group',
    deal("  groups: {\n    g: { label: 'G' }, // about g\n    h: { label: 'H' },\n  },"),
    4,
  ],
  [
    'a trailing comment on an export',
    `${head}export const A = defineObject('a', {}) // about A\nexport const B = defineObject('b', {})\n`,
    2,
  ],
  [
    'a trailing comment on an import',
    `${head}import { M } from './m' // why\nexport const Deal = defineObject('deals', {})\n`,
    2,
  ],
  [
    'a trailing comment on the tool import',
    `${head.replace('\n', ' // x\n')}export const Deal = defineObject('deals', {})\n`,
    1,
  ],
  [
    'a line separator inside a comment',
    deal("  properties: {\n    // note\u{2028}process.exit(1)\n    a: p.string('a'),\n  },"),
    4,
  ],
  [
    'a paragraph separator inside a comment',
    deal("  properties: {\n    // note\u{2029}alert(1)\n    a: p.string('a'),\n  },"),
    4,
  ],
  [
    'statements before an import path',
    `import a; process.exit(1); const q = 'x'\n${deal("  properties: { a: p.string('a') },")}`,
    1,
  ],
])('review: E_NOT_DATA on %s', (_name, text, line) => {
  const i = issue(text)
  expect(i.code).toBe('E_NOT_DATA')
  expect(i.line).toBe(line)
})

test.each(["'\\u{zz}'", "'\\u{}'", "'\\u{110000}'", "'\\u{-1}'", "'\\u{'", "'\\x4g'", "'\\u12'"])(
  'review: the bad escape %s is E_NOT_DATA, not a RangeError',
  (literal) => {
    expect(issue(deal(`  properties: { a: p.string(${literal}) },`))).toMatchObject({ code: 'E_NOT_DATA', line: 3 })
  },
)

test('the reader decodes every escape the way a JS engine does', () => {
  const literal = "'\\x41A\\u{1F600}\\u00e9\\ud83d\\ude00\\0\\b\\f\\v\\n\\r\\t\\\\\\'\\\"\\q'"
  const r = read(deal(`  properties: { a: p.string(${literal}) },`), 'deals.ts')
  const name = r.kind === 'object' && r.data.exports[0]?.properties[0]?.name
  expect(name).toBe('AA😀é😀\0\b\f\v\n\r\t\\\'"q')
  expect(name).toBe(new Function(`return ${literal}`)())
})

test('E_NOT_DATA on a line continuation inside a string', () => {
  const i = issue(deal("  properties: { a: p.string('a\\\nb') },"))
  expect(i).toMatchObject({ code: 'E_NOT_DATA', line: 3, fix: 'write the string on one line' })
})

test('an invisible unexpected character is named by its code point', () => {
  const i = issue(deal("  properties: {\n    // note\u{2028}process.exit(1)\n    a: p.string('a'),\n  },"))
  expect(i.message).toBe('unexpected character U+2028')
})

test('every import form is kept verbatim', () => {
  const imports = [
    "import './side-effect'",
    "import * as ns from './ns'",
    "import type { A } from './a'",
    "import D, { E } from './d';",
    'import { type F, G as H } from "./f"',
  ]
  const r = read(`${head}${imports.join('\n')}\n${deal("  properties: { a: p.string('a') },")}`, 'deals.ts')
  expect(r.kind === 'object' && r.data.imports).toEqual(imports.map((i) => i.replace(/;$/, '')))
})

test.each([
  ['a missing from', "import { a } './a'", 1],
  ['a call in the specifiers', "import { a } from f('x')", 1],
  ['an import that never ends', 'import { a } from', 2],
])('E_NOT_DATA on %s', (_name, line1, line) => {
  const i = issue(`${line1}\n${deal("  properties: { a: p.string('a') },")}`)
  expect(i.code).toBe('E_NOT_DATA')
  expect(i.line).toBe(line)
  expect(i.fix).toBe("write import { <names> } from '<module>' or import '<module>'")
})

test.each([
  ['a // comment inside the validator', "p.json('a', z // c\n)", 'use /* */ instead'],
  ['an unterminated regex in the validator', "p.json('a', /x)", 'close it with /'],
  ['an unterminated string in the validator', "p.json('a', z.describe('x)", "close it with '"],
  ['an unterminated block comment in the validator', "p.json('a', z /* c)", 'close the comment with */'],
  ['a closing bracket at depth zero in the validator', "p.json('a', z])", 'close every bracket in the validator'],
  ['an empty validator', "p.json('a', )", 'write p.json(name, validator, {...})'],
])('E_NOT_DATA on %s', (_name, call, fix) => {
  const i = issue(deal(`  properties: { a: ${call} },`))
  expect(i).toMatchObject({ code: 'E_NOT_DATA', line: 3, fix })
})
