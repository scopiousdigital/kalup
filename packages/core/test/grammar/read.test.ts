import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { read } from '../../src/grammar/read.js'
import { IssueError, type RemovedFile } from '../../src/grammar/types.js'
import { write } from '../../src/grammar/write.js'
import type { Issue } from '../../src/ir/types.js'

const errors = new URL('../fixtures/grammar/errors/', import.meta.url)
const head = "import { defineObject, type InferProperties, p } from '@kalup/core'\n"
const trailingSemicolon = /;$/

function issue(text: string, file = 'kalup/objects/deals.ts'): Issue {
  try {
    read(text, file)
  } catch (e) {
    if (e instanceof IssueError) {
      return e.issues[0] as Issue
    }
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

const deal = (fields: string) => `${head}export const Deal = defineObject('deals', {\n${fields}\n})\n`

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
  if (fix) {
    expect(i.fix).toBe(fix)
  }
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
  expect(r.kind === 'object' && r.data.imports).toEqual(imports.map((i) => i.replace(trailingSemicolon, '')))
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

// A project whose own Biome or Ultracite setup applies useNumericSeparators rewrites portal IDs in kalup.config.ts.
const target = (portalId: string) =>
  `import { defineConfig } from 'kalup'\nexport default defineConfig({ targets: { qa: { portalId: ${portalId} } } })\n`

test.each([
  ['1_111_111', 1_111_111],
  ['1111111', 1_111_111],
  ['-1_000.000_5', -1000.0005],
])('the portalId %s reads as %s', (literal, portalId) => {
  expect(read(target(literal), 'kalup.config.ts').data).toHaveProperty(['targets', 'qa', 'portalId'], portalId)
})

test.each([
  ['_1', "expected a number but found '_1'", 'write a number'],
  ['1_', "'_' is not allowed here in a number", 'write single underscores between digits, or none'],
  ['1__1', "'_' is not allowed here in a number", 'write single underscores between digits, or none'],
  ['1._5', "'_' is not allowed here in a number", 'write single underscores between digits, or none'],
  ['1_.5', "'_' is not allowed here in a number", 'write single underscores between digits, or none'],
  ['1.5_', "'_' is not allowed here in a number", 'write single underscores between digits, or none'],
  ['0_1', "'_' is not allowed here in a number", 'write single underscores between digits, or none'],
  ['01_2', "'_' is not allowed here in a number", 'write single underscores between digits, or none'],
])('E_NOT_DATA on the numeric separator in %s, where JS rejects it', (literal, message, fix) => {
  expect(issue(target(literal), 'kalup.config.ts')).toMatchObject({ code: 'E_NOT_DATA', line: 2, message, fix })
})

const config = (fields: string) =>
  `import { defineConfig } from 'kalup'\nexport default defineConfig({\n${fields}\n})\n`

test.each([
  ['a number', '  defaultTarget: 1,', "expected a string but found '1'"],
  ['true', '  defaultTarget: true,', "expected a string but found 'true'"],
  ['an identifier', '  defaultTarget: sandbox,', "expected a string but found 'sandbox'"],
  ['an array', "  defaultTarget: ['sandbox'],", "expected a string but found '['"],
])('defaultTarget as %s is E_NOT_DATA', (_name, field, message) => {
  expect(issue(config(field), 'kalup.config.ts')).toMatchObject({
    code: 'E_NOT_DATA',
    line: 3,
    message,
    configPath: 'defaultTarget',
  })
})

test('defaultTarget reads as a string with its line, and any string is data here: validate checks the name', () => {
  const r = read(config("  defaultTarget: 'Staging 2',\n  targets: {},"), 'kalup.config.ts')
  expect(r.kind === 'config' && r.data.defaultTarget).toBe('Staging 2')
  expect(r.lines.defaultTarget).toBe(3)
  expect(read(config("  defaultTarget: '',"), 'kalup.config.ts').data).toHaveProperty('defaultTarget', '')
})

// The grammar has no number field in a definition: a separated number there is one token, quoted as written.
test('a separated number in a definition is one token and the message quotes it as written', () => {
  expect(issue(deal("  properties: { a: p.string('a', { label: 1_111_111 }) },"))).toMatchObject({
    code: 'E_NOT_DATA',
    message: "expected a string but found '1_111_111'",
    line: 3,
  })
})

test('a separated number in a p.json validator is kept verbatim', () => {
  const r = read(deal("  properties: { a: p.json('a', z.number().max(1_111_111)) },"), 'deals.ts')
  expect(r.kind === 'object' && r.data.exports[0]?.properties[0]?.json).toEqual({
    validatorSource: 'z.number().max(1_111_111)',
  })
})

test('allowDestroy reads as a boolean on a target, and anything else is E_NOT_DATA', () => {
  const r = read(config('  targets: { qa: { portalId: 1, allowDestroy: true } },'), 'kalup.config.ts')
  expect(r.kind === 'config' && r.data.targets.qa).toEqual({ portalId: 1, allowDestroy: true })
  expect(r.lines['targets.qa.allowDestroy']).toBe(3)
  expect(issue(config("  targets: { qa: { portalId: 1, allowDestroy: 'yes' } },"), 'kalup.config.ts')).toMatchObject({
    code: 'E_NOT_DATA',
    message: 'expected true or false but found a string',
    configPath: 'targets.qa.allowDestroy',
  })
})

const REMOVED = 'kalup/removed.ts'
const removed = (entries: string) =>
  `import { defineRemoved } from 'kalup'\n\nexport default defineRemoved({\n${entries}\n})\n`

test('kalup/removed.ts reads as tombstones by key, with the header and a line per key', () => {
  const text = `// gone\n${removed("  'property:companies/legacy_score': { action: 'destroy', reason: 'Replaced' },\n  'group:companies/old': { action: 'release' },")}`
  const r = read(text, REMOVED)
  expect(r).toEqual({
    kind: 'removed',
    data: {
      header: ['gone'],
      imports: [],
      tombstones: {
        'property:companies/legacy_score': { action: 'destroy', reason: 'Replaced' },
        'group:companies/old': { action: 'release' },
      },
    },
    lines: {
      'property:companies/legacy_score': 5,
      'property:companies/legacy_score.action': 5,
      'property:companies/legacy_score.reason': 5,
      'group:companies/old': 6,
      'group:companies/old.action': 6,
    },
  })
  // Any key is data here: validate checks that it is a property or group address.
  expect(read(removed("  notAnAddress: { action: 'release' },"), REMOVED).data).toHaveProperty(
    ['tombstones', 'notAnAddress'],
    { action: 'release' },
  )
})

test.each([
  [
    'an action outside destroy and release',
    "  'property:companies/a': { action: 'delete' },",
    "'delete' is not one of destroy, release",
    "write one of 'destroy', 'release'",
  ],
  [
    'a tombstone without an action',
    "  'property:companies/a': { reason: 'old' },",
    "missing field 'action'",
    'add action',
  ],
  [
    'a field other than action and reason',
    "  'property:companies/a': { action: 'destroy', force: true },",
    "unknown field 'force'",
    'use one of action, reason',
  ],
  [
    'a reason that is not a string',
    "  'property:companies/a': { action: 'destroy', reason: 1 },",
    "expected a string but found '1'",
    'write a single-quoted string',
  ],
  [
    "a '__proto__' field",
    "  'property:companies/a': { '__proto__': 'x' },",
    "unknown field '__proto__'",
    'use one of action, reason',
  ],
  [
    'a value that is not an object',
    "  'property:companies/a': 'destroy',",
    "expected '{' but found a string",
    'write an object {...}',
  ],
  [
    'a comment on an entry',
    "  // why\n  'property:companies/a': { action: 'destroy' },",
    'this comment is not attached to an entry',
    'move this comment above the entry it describes',
  ],
])('kalup/removed.ts with %s is E_NOT_DATA', (_name, entries, message, fix) => {
  expect(issue(removed(entries), REMOVED)).toMatchObject({ code: 'E_NOT_DATA', file: REMOVED, message, fix })
})

test("a '__proto__' key is an own key with its line, never the prototype", () => {
  const r = read(
    removed("  '__proto__': { action: 'destroy' },\n  'group:companies/old': { action: 'release' },"),
    REMOVED,
  )
  const { tombstones } = r.data as { tombstones: Record<string, unknown> }
  expect(Object.getPrototypeOf(tombstones)).toBe(Object.prototype)
  expect(Object.keys(tombstones)).toEqual(['__proto__', 'group:companies/old'])
  expect(Object.getOwnPropertyDescriptor(r.lines, '__proto__')?.value).toBe(4)
  // The canonical text keeps it, and reads back the same.
  const text = write('removed', r.data as RemovedFile)
  expect(text).toContain("  __proto__: { action: 'destroy' },")
  expect(read(text, REMOVED).data).toEqual(r.data)
})

test('a repeated address in kalup/removed.ts is E_DUPLICATE_KEY', () => {
  const entries = "  'group:companies/old': { action: 'release' },\n  'group:companies/old': { action: 'destroy' },"
  expect(issue(removed(entries), REMOVED)).toMatchObject({
    code: 'E_DUPLICATE_KEY',
    line: 5,
    configPath: 'group:companies/old',
  })
})

test('anything after defineRemoved is E_NOT_DATA', () => {
  expect(issue(`${removed('')}export const x = 1\n`, REMOVED)).toMatchObject({
    code: 'E_NOT_DATA',
    message: "unexpected 'export' after defineRemoved",
    fix: 'kalup/removed.ts holds one export default defineRemoved({...}) and nothing else',
  })
})

test.each([
  ['type', "'type' comes from the builder, so it cannot differ per target"],
  ['colour', "unknown field 'colour' in a definition override"],
])('a definition override with %s is E_OVERRIDE_DEFINITION at the field, not E_NOT_DATA', (field, message) => {
  const text = `import { defineConfig } from 'kalup'
export default defineConfig({
  targets: {
    eu: {
      portalId: 4141414,
      overrides: {
        'property:deals/term_days': {
          definition: { label: 'Days', ${field}: 'string' },
        },
      },
    },
  },
})
`
  expect(issue(text, 'kalup.config.ts')).toEqual({
    code: 'E_OVERRIDE_DEFINITION',
    message,
    file: 'kalup.config.ts',
    line: 8,
    configPath: `targets.eu.overrides.property:deals/term_days.definition.${field}`,
    fix: 'override only label, description, group, fieldType, formField, options or lifecycle',
  })
  // A shared definition keeps E_NOT_DATA for the same field.
  expect(issue(deal(`  properties: { a: p.string('a', { ${field}: 'string' }) },`)).code).toBe('E_NOT_DATA')
})

// The invented key is joined at run time so secret scanners do not read it as a real one.
test.each([
  ['a key pasted in its place', ['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-')],
  ['a name with a space', 'HUBSPOT KEY'],
  ['a name starting with a digit', '9_KEY'],
  ['an empty name', ''],
])('credentials env must name an environment variable, not hold %s, and the value is never quoted', (_, value) => {
  const text = [
    "import { defineConfig } from 'kalup'",
    '',
    'export default defineConfig({',
    '  targets: {',
    '    sandbox: {',
    '      portalId: 1111111,',
    `      credentials: { read: { env: '${value}' } },`,
    '    },',
    '  },',
    '})',
    '',
  ].join('\n')
  const found = issue(text, 'kalup.config.ts')
  expect(found).toMatchObject({
    code: 'E_NOT_DATA',
    file: 'kalup.config.ts',
    line: 7,
    configPath: 'targets.sandbox.credentials.read.env',
    message:
      'env must name an environment variable (letters, digits and _, not starting with a digit), not hold the key',
  })
  if (value !== '') {
    expect(JSON.stringify(found)).not.toContain(value)
  }
})

test('a credentials env that names a variable reads as it is, read and write', () => {
  const text = [
    "import { defineConfig } from 'kalup'",
    '',
    'export default defineConfig({',
    "  targets: { sandbox: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' }, write: { env: '_W2' } } } },",
    '})',
    '',
  ].join('\n')
  const parsed = read(text, 'kalup.config.ts', 'config').data as { targets: Record<string, unknown> }
  expect(parsed.targets.sandbox).toMatchObject({
    credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' }, write: { env: '_W2' } },
  })
})
