import type { IssueCode } from '../issues.js'
import { type Token, tokenize } from './tokenize.js'
import {
  type BuilderKind,
  type ConfigFile,
  type Definition,
  IssueError,
  type ObjectExport,
  type ObjectFile,
  type Property,
  type RemovedFile,
  type Tombstone,
} from './types.js'

export type ReadResult =
  | { kind: 'object'; data: ObjectFile; lines: Record<string, number> }
  | { kind: 'config'; data: ConfigFile; lines: Record<string, number> }
  | { kind: 'removed'; data: RemovedFile; lines: Record<string, number> }

interface S {
  file: string
  i: number
  lines: Record<string, number>
  text: string
  toks: Token[]
}
type Parse<T> = (s: S, path: string) => T

export const builderKinds: BuilderKind[] = [
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'multiEnum',
  'stringArray',
  'json',
  'phoneNumber',
  'owner',
]
/** The chain calls after a builder call, in canonical order. */
const CHAIN_FLAGS = ['strict', 'required', 'readonly', 'managed'] as const
type ChainFlag = (typeof CHAIN_FLAGS)[number]
// The writer imports from '@kalup/core'. 'kalup' was the config files' specifier before 0.1.0: it stays tool-owned, so an
// older file loads the same and its import is rewritten by fmt, or by any command that rewrites that file.
const toolOwned = ['@kalup/core', 'kalup']
const typeLineFix = 'write `export type <Name>Data = InferProperties<typeof <Name>.properties> & { id: string }`'

/**
 * Parses one object file, kalup.config.ts or removed.ts into plain data. Throws IssueError on anything outside
 * the grammar. `kind` is the kind the file must be, when its path decides it; otherwise the content does.
 */
export function read(text: string, file: string, kind?: ReadResult['kind']): ReadResult {
  const bom = text.charCodeAt(0) === 0xfe_ff ? text.slice(1) : text
  const src = bom.replace(/\r\n?/g, '\n')
  const s: S = { file, text: src, toks: tokenize(src, file), i: 0, lines: {} }
  const header = parseHeader(s)
  const imports = parseImports(s)
  const top = header.length ? { header } : {}
  const found = kind ?? kindAt(s)
  if (found === 'removed') {
    return { kind: 'removed', data: { ...top, ...parseRemoved(s, imports) }, lines: s.lines }
  }
  if (found === 'config') {
    return { kind: 'config', data: { ...top, ...parseConfig(s, imports) }, lines: s.lines }
  }
  return { kind: 'object', data: { ...top, ...parseObjectFile(s, imports) }, lines: s.lines }
}

// An `export default` makes a config file, or a removed file when it calls defineRemoved; anything else is an object
// file.
function kindAt(s: S): ReadResult['kind'] {
  let j = s.i
  while (at(s, j).kind === 'comment') {
    j += 1
  }
  if (!(is(at(s, j), 'ident', 'export') && is(at(s, j + 1), 'ident', 'default'))) {
    return 'object'
  }
  return is(at(s, j + 2), 'ident', 'defineRemoved') ? 'removed' : 'config'
}

function at(s: S, i: number): Token {
  return s.toks[Math.min(i, s.toks.length - 1)] as Token
}

function is(t: Token, kind: Token['kind'], value: string): boolean {
  return t.kind === kind && t.value === value
}

function show(t: Token): string {
  if (t.kind === 'eof') {
    return 'end of file'
  }
  return t.kind === 'string' ? 'a string' : `'${t.value}'`
}

function fail(s: S, code: IssueCode, tok: Token, message: string, fix: string, configPath?: string): never {
  throw new IssueError([{ code, message, file: s.file, line: tok.line, configPath, fix }])
}

function failComment(s: S, tok: Token, path?: string): never {
  fail(
    s,
    'E_NOT_DATA',
    tok,
    'this comment is not attached to an entry',
    'move this comment above the entry it describes',
    path,
  )
}

function peek(s: S): Token {
  const t = at(s, s.i)
  if (t.kind === 'comment') {
    failComment(s, t)
  }
  return t
}

function next(s: S): Token {
  const t = peek(s)
  s.i += 1
  return t
}

function expect(s: S, kind: Token['kind'], value: string, fix = `add '${value}'`, path?: string): Token {
  const t = peek(s)
  if (!is(t, kind, value)) {
    fail(s, 'E_NOT_DATA', t, `expected '${value}' but found ${show(t)}`, fix, path)
  }
  s.i += 1
  return t
}

function skip(s: S, value: string): boolean {
  if (!is(at(s, s.i), 'punct', value)) {
    return false
  }
  s.i += 1
  return true
}

// A comment on the same line as the token before it trails that token; only a comment on its own line leads an entry.
function takeComments(s: S, path?: string): Token[] {
  const out: Token[] = []
  while (at(s, s.i).kind === 'comment') {
    const t = at(s, s.i)
    if (s.i && at(s, s.i - 1).line === t.line) {
      failComment(s, t, path)
    }
    out.push(t)
    s.i += 1
  }
  return out
}

function texts(comments: Token[]): string[] {
  return comments.map((c) => c.value)
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

// The comments before the first import are the file header. With no import they lead the first export as usual.
function parseHeader(s: S): string[] {
  let j = 0
  while (at(s, j).kind === 'comment') {
    j += 1
  }
  return is(at(s, j), 'ident', 'import') ? texts(takeComments(s)) : []
}

// `import '<module>'` or `import <specifiers> from '<module>'`, where specifiers are names, `{`, `}`, `,` and `*`.
function parseImports(s: S): string[] {
  const kept: string[] = []
  const fix = "write import { <names> } from '<module>' or import '<module>'"
  while (is(at(s, s.i), 'ident', 'import')) {
    const start = next(s)
    let prev = start
    let t = next(s)
    while (t.kind !== 'string') {
      const name = t.kind === 'ident' && t.value !== 'import' && t.value !== 'export'
      if (!(name || (t.kind === 'punct' && '{},*'.includes(t.value)))) {
        fail(s, 'E_NOT_DATA', t, `unexpected ${show(t)} in an import`, fix)
      }
      prev = t
      t = next(s)
    }
    if (prev !== start && !is(prev, 'ident', 'from')) {
      fail(s, 'E_NOT_DATA', t, "expected 'from' before the module path", fix)
    }
    skip(s, ';')
    if (!toolOwned.includes(t.value)) {
      kept.push(s.text.slice(start.start, t.end))
    }
  }
  return kept
}

// Object literal walker shared by every shape: keys, ':', trailing commas, duplicates, the line map.
function entries(s: S, path: string, comments: boolean, entry: (key: string, tok: Token, cs: Token[]) => void): void {
  expect(s, 'punct', '{', 'write an object {...}', path)
  const seen = new Set<string>()
  for (;;) {
    const cs = takeComments(s, path)
    if (is(at(s, s.i), 'punct', '}')) {
      if (cs[0]) {
        failComment(s, cs[0], path)
      }
      s.i += 1
      return
    }
    const tok = next(s)
    if (tok.kind !== 'ident' && tok.kind !== 'string') {
      const fix = 'write key: value entries only; no spreads, computed keys or shorthand'
      fail(s, 'E_NOT_DATA', tok, `expected a key but found ${show(tok)}`, fix, path)
    }
    if (cs[0] && !comments) {
      failComment(s, cs[0], path)
    }
    const key = tok.value
    if (seen.has(key)) {
      fail(
        s,
        'E_DUPLICATE_KEY',
        tok,
        `duplicate key '${key}'`,
        'remove or rename one of the two entries',
        join(path, key),
      )
    }
    seen.add(key)
    expect(s, 'punct', ':', 'write key: value', path)
    own(s.lines, join(path, key), tok.line)
    entry(key, tok, cs)
    if (!skip(s, ',')) {
      expect(s, 'punct', '}', "add ',' between entries", path)
      return
    }
  }
}

const str: Parse<string> = (s, path) => {
  const t = next(s)
  if (t.kind !== 'string') {
    fail(s, 'E_NOT_DATA', t, `expected a string but found ${show(t)}`, 'write a single-quoted string', path)
  }
  return t.value
}

const num: Parse<number> = (s, path) => {
  const t = next(s)
  if (t.kind !== 'number') {
    fail(s, 'E_NOT_DATA', t, `expected a number but found ${show(t)}`, 'write a number', path)
  }
  // The tokenizer only lets numeric separators through where JS allows them.
  return Number(t.value.replaceAll('_', ''))
}

const bool: Parse<boolean> = (s, path) => {
  const t = next(s)
  if (!(is(t, 'ident', 'true') || is(t, 'ident', 'false'))) {
    fail(s, 'E_NOT_DATA', t, `expected true or false but found ${show(t)}`, 'write true or false', path)
  }
  return t.value === 'true'
}

const literalTrue: Parse<true> = (s, path) => {
  const t = next(s)
  if (!is(t, 'ident', 'true')) {
    fail(s, 'E_NOT_DATA', t, `expected true but found ${show(t)}`, 'write true or drop the field', path)
  }
  return true
}

function oneOf<T extends string>(...values: T[]): Parse<T> {
  return (s, path) => {
    const t = peek(s)
    const v = str(s, path)
    if (!values.includes(v as T)) {
      fail(
        s,
        'E_NOT_DATA',
        t,
        `'${v}' is not one of ${values.join(', ')}`,
        `write one of ${values.map((x) => `'${x}'`).join(', ')}`,
        path,
      )
    }
    return v as T
  }
}

function list<T>(item: Parse<T>): Parse<T[]> {
  return (s, path) => {
    expect(s, 'punct', '[', 'write an array [...]', path)
    const out: T[] = []
    while (!is(peek(s), 'punct', ']')) {
      out.push(item(s, `${path}[${out.length}]`))
      if (!skip(s, ',')) {
        break
      }
    }
    expect(s, 'punct', ']', "add ',' between items", path)
    return out
  }
}

/** The issue for a field a shape does not know, when it is not E_NOT_DATA's. Undefined: E_NOT_DATA's. */
type Unknown = (key: string, path: string) => { code: IssueCode; message: string; fix: string } | undefined

function shape<T>(fields: Record<string, Parse<unknown>>, required: string[] = [], unknown?: Unknown): Parse<T> {
  return (s, path) => {
    const open = peek(s)
    const out: Record<string, unknown> = {}
    entries(s, path, false, (key, tok) => {
      // An own field only: a key such as '__proto__' must not find Object.prototype.
      const parse = Object.hasOwn(fields, key) ? fields[key] : undefined
      const issue = parse ? undefined : unknown?.(key, path)
      if (issue) {
        fail(s, issue.code, tok, issue.message, issue.fix, join(path, key))
      }
      if (!parse) {
        fail(s, 'E_NOT_DATA', tok, `unknown field '${key}'`, `use one of ${Object.keys(fields).join(', ')}`, path)
      }
      out[key] = parse(s, join(path, key))
    })
    for (const k of required) {
      if (!(k in out)) {
        fail(s, 'E_NOT_DATA', open, `missing field '${k}'`, `add ${k}`, path)
      }
    }
    return Object.fromEntries(Object.keys(fields).flatMap((k) => (k in out ? [[k, out[k]]] : []))) as T
  }
}

function map<T>(item: Parse<T>): Parse<Record<string, T>> {
  return (s, path) => {
    const out: Record<string, T> = {}
    entries(s, path, false, (key) => {
      own(out, key, item(s, join(path, key)))
    })
    return out
  }
}

// defineProperty, not assignment: assigning a key such as '__proto__' would replace the prototype instead of adding it.
function own<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true })
}

/** Where a kalup.config.ts setting may stand. */
type Level = 'top' | 'object' | 'target' | 'target-object'

// Each setting, the levels that allow it and a value to show in a fix. A setting found at another level, in an
// override or in a property definition is E_SETTING_LEVEL, whose fix lists every allowed level with a snippet.
const SETTINGS: Record<string, { example: string; levels: Level[] }> = {
  mode: { levels: ['top', 'object', 'target', 'target-object'], example: "'takeover'" },
  include: { levels: ['object'], example: "['name']" },
  exclude: { levels: ['object'], example: "['zi_*']" },
  custom: { levels: ['object'], example: 'false' },
  as: { levels: ['object'], example: "'Firm'" },
  protected: { levels: ['target'], example: 'true' },
  drift: { levels: ['target'], example: "'overwrite'" },
  adopt: { levels: ['target'], example: "'overwrite'" },
  allowDestroy: { levels: ['target'], example: 'true' },
  yesLimit: { levels: ['target'], example: '100' },
}

const LEVEL_NAMES: Record<Level, string> = {
  top: 'the top level',
  object: 'objects.<object>',
  target: 'targets.<target>',
  'target-object': 'targets.<target>.objects.<object>',
}

// The snippet that states `key: value` at one level of defineConfig.
function snippet(level: Level, key: string, value: string): string {
  const entry = `${key}: ${value}`
  return {
    top: `defineConfig({ ${entry} })`,
    object: `objects: { companies: { ${entry} } }`,
    target: `targets: { sandbox: { ${entry} } }`,
    'target-object': `targets: { sandbox: { objects: { companies: { ${entry} } } } }`,
  }[level]
}

/**
 * E_SETTING_LEVEL for a known setting at a path that does not allow it, named `where` or by the path itself; undefined
 * for any other key.
 */
function misplaced(where?: string): Unknown {
  return (key, path) => {
    const found = Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : undefined
    if (!found) {
      return undefined
    }
    const allowed = found.levels.map((level) => `${LEVEL_NAMES[level]} (${snippet(level, key, found.example)})`)
    return {
      code: 'E_SETTING_LEVEL',
      message: `${key} is not allowed in ${where ?? (path || 'the top level')}`,
      fix: `move it to ${allowed.length > 1 ? 'one of ' : ''}${allowed.join(', ')}`,
    }
  }
}

// Case-insensitive edit distance, for a did-you-mean.
function distance(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  let row = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i += 1) {
    const cells = [i]
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      cells[j] = Math.min((row[j] ?? 0) + 1, (cells[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + cost)
    }
    row = cells
  }
  return row[y.length] ?? 0
}

/** A setting's string value: E_SETTING_VALUE, with the nearest allowed value, for anything else. */
function setting<T extends string>(...values: T[]): Parse<T> {
  return (s, path) => {
    const t = next(s)
    if (t.kind === 'string' && values.includes(t.value as T)) {
      return t.value as T
    }
    const shown = t.kind === 'string' ? `'${t.value}'` : show(t)
    const [nearest] = [...values].sort((a, b) => distance(t.value, a) - distance(t.value, b))
    const all = values.map((v) => `'${v}'`).join(' or ')
    return fail(
      s,
      'E_SETTING_VALUE',
      t,
      `${shown} is not a value of ${path.slice(path.lastIndexOf('.') + 1)}`,
      `did you mean '${nearest}'? write ${all}`,
      path,
    )
  }
}

/** yesLimit: an integer from 0 to 1000. E_SETTING_VALUE, with the nearest allowed value, otherwise. */
const YES_LIMIT_MAX = 1000
const yesLimit: Parse<number> = (s, path) => {
  const t = next(s)
  const value = t.kind === 'number' ? Number(t.value.replaceAll('_', '')) : Number.NaN
  if (Number.isInteger(value) && value >= 0 && value <= YES_LIMIT_MAX) {
    return value
  }
  const nearest = Number.isNaN(value) ? 25 : Math.min(YES_LIMIT_MAX, Math.max(0, Math.round(value)))
  return fail(
    s,
    'E_SETTING_VALUE',
    t,
    `${t.kind === 'number' ? t.value : show(t)} is not a value of yesLimit, an integer from 0 to ${YES_LIMIT_MAX}`,
    `did you mean ${nearest}? 0 turns --yes off`,
    path,
  )
}

const mode = setting('addon', 'takeover')

const group = shape<{ label: string }>({ label: str }, ['label'])
const option = shape({ value: str, label: str, as: str, hidden: bool, description: str }, ['value', 'label'])
const lifecycle = shape({
  options: oneOf('additive', 'exact'),
  removedOptions: list(str),
  ignoreChanges: list(str),
  preventDestroy: bool,
})
const definitionFields = {
  label: str,
  group: str,
  fieldType: str,
  description: str,
  options: list(option),
  hasUniqueValue: bool,
  formField: bool,
  hidden: bool,
  displayOrder: num,
  numberDisplayHint: oneOf('currency', 'duration', 'formatted', 'percentage', 'probability', 'unformatted'),
  showCurrencySymbol: bool,
  currencyPropertyName: str,
  textDisplayHint: oneOf(
    'domain_name',
    'email',
    'ip_address',
    'multi_line',
    'phone_number',
    'physical_address',
    'postal_code',
    'unformatted_single_line',
  ),
  calculationFormula: str,
  dataSensitivity: oneOf('non_sensitive', 'sensitive', 'highly_sensitive'),
  lifecycle,
}
const definition: Parse<Definition> = shape(definitionFields, [], misplaced('a property definition'))
// A target's definition override reads the same fields; validate says which of them may differ per target.
const overrideDefinition: Parse<Definition> = shape(definitionFields, [], (key) => ({
  code: 'E_OVERRIDE_DEFINITION',
  message:
    key === 'type'
      ? "'type' comes from the builder, so it cannot differ per target"
      : `unknown field '${key}' in a definition override`,
  fix: 'override only label, description, group, fieldType, formField, options, hidden, displayOrder, the display hints, calculationFormula or lifecycle',
}))
const customFields: Record<string, Parse<unknown>> = {
  labels: shape({ singular: str, plural: str }, ['singular', 'plural']),
  primaryDisplayProperty: str,
  requiredProperties: list(str),
  searchableProperties: list(str),
  secondaryDisplayProperties: list(str),
}
// A credential names the environment variable that holds the key. A value that is no variable name is never quoted
// back: it may be the key itself, pasted in the wrong place.
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/
const variable: Parse<string> = (s, path) => {
  const t = peek(s)
  const v = str(s, path)
  if (!VARIABLE.test(v)) {
    fail(
      s,
      'E_NOT_DATA',
      t,
      'env must name an environment variable (letters, digits and _, not starting with a digit), not hold the key',
      'write the variable name here, such as HUBSPOT_SANDBOX_KEY, and put the key itself in .env or the environment',
      path,
    )
  }
  return v
}
const env = shape({ env: variable }, ['env'])
const override = shape(
  { skip: literalTrue, name: str, definition: overrideDefinition, lookup: map(str) },
  [],
  misplaced(),
)
const config: Parse<Partial<ConfigFile>> = shape(
  {
    name: str,
    dir: str,
    state: setting('local', 'repo'),
    prefix: str,
    defaultTarget: str,
    mode,
    objects: map(shape({ mode, include: list(str), exclude: list(str), custom: bool, as: str }, [], misplaced())),
    targets: map(
      shape(
        {
          portalId: num,
          mode,
          protected: bool,
          drift: setting('hold', 'overwrite'),
          adopt: setting('hold', 'overwrite'),
          allowDestroy: bool,
          yesLimit,
          credentials: shape({ read: env, write: env }, ['read']),
          objects: map(shape({ mode }, [], misplaced())),
          overrides: map(override),
        },
        [],
        misplaced(),
      ),
    ),
  },
  [],
  misplaced(),
)

const tombstone = shape<Tombstone>({ action: oneOf('destroy', 'release'), reason: str }, ['action'])

function parseObjectFile(s: S, imports: string[]): ObjectFile {
  const exports: ObjectExport[] = []
  const typed = new Set<string>()
  const fix =
    'only imports, `export const <Name> = defineObject(...)` and the InferProperties type line are allowed here'
  for (;;) {
    const cs = takeComments(s)
    if (at(s, s.i).kind === 'eof') {
      if (!exports.length) {
        const add = "add `export const <Name> = defineObject('<object>', {...})`"
        fail(s, 'E_MISSING_EXPORT', at(s, 0), 'no defineObject or defineCustomObject export in this file', add)
      }
      if (cs[0]) {
        failComment(s, cs[0])
      }
      return { imports, exports }
    }
    expect(s, 'ident', 'export', fix)
    const t = peek(s)
    if (is(t, 'ident', 'const')) {
      s.i += 1
      exports.push(parseExport(s, cs, exports))
    } else if (is(t, 'ident', 'type')) {
      if (cs[0]) {
        failComment(s, cs[0])
      }
      s.i += 1
      parseTypeLine(s, exports, typed)
    } else {
      fail(s, 'E_NOT_DATA', t, `unexpected ${show(t)} after 'export'`, fix)
    }
  }
}

function parseExport(s: S, cs: Token[], exports: ObjectExport[]): ObjectExport {
  const nameTok = next(s)
  if (nameTok.kind !== 'ident') {
    fail(
      s,
      'E_NOT_DATA',
      nameTok,
      `expected an export name but found ${show(nameTok)}`,
      'write export const <Name> = ...',
    )
  }
  const name = nameTok.value
  if (exports.some((x) => x.name === name)) {
    fail(s, 'E_DUPLICATE_KEY', nameTok, `duplicate export '${name}'`, 'rename one of the two exports', name)
  }
  expect(s, 'punct', '=', 'write export const <Name> = defineObject(...)', name)
  const b = next(s)
  if (!(is(b, 'ident', 'defineObject') || is(b, 'ident', 'defineCustomObject'))) {
    const fix = "write defineObject('<object>', {...}) or defineCustomObject('<name>', {...})"
    fail(s, 'E_NOT_DATA', b, `'${b.value}' is not defineObject or defineCustomObject`, fix, name)
  }
  const builder = b.value as ObjectExport['builder']
  expect(s, 'punct', '(', undefined, name)
  const object = str(s, name)
  expect(s, 'punct', ',', 'add the object literal as the second argument', name)
  s.lines[name] = nameTok.line
  const e: ObjectExport = { name, builder, object, comments: texts(cs), groups: [], properties: [] }
  const allowed = ['groups', 'properties', ...(builder === 'defineCustomObject' ? Object.keys(customFields) : [])]
  entries(s, name, false, (key, tok) => {
    const path = join(name, key)
    if (key === 'groups') {
      entries(s, path, true, (g, _t, gcs) =>
        e.groups.push({ name: g, ...group(s, join(path, g)), comments: texts(gcs) }),
      )
    } else if (key === 'properties') {
      entries(s, path, true, (k, _t, pcs) => e.properties.push(parseProperty(s, join(path, k), k, pcs)))
    } else if (customFields[key] && builder === 'defineCustomObject') {
      Object.assign(e, { [key]: customFields[key](s, path) })
    } else {
      fail(s, 'E_NOT_DATA', tok, `unknown field '${key}'`, `use one of ${allowed.join(', ')}`, name)
    }
  })
  skip(s, ',')
  expect(s, 'punct', ')', undefined, name)
  skip(s, ';')
  return e
}

function parseProperty(s: S, path: string, key: string, cs: Token[]): Property {
  const t = peek(s)
  if (!is(t, 'ident', 'p')) {
    const fix = `write p.<kind>('<internal name>', {...}) where kind is one of ${builderKinds.join(', ')}`
    fail(s, 'E_NOT_DATA', t, `expected a builder call for '${key}' but found ${show(t)}`, fix, path)
  }
  s.i += 1
  expect(s, 'punct', '.', 'write p.<kind>(...)', path)
  const k = next(s)
  if (!builderKinds.includes(k.value as BuilderKind)) {
    const fix = `use one of ${builderKinds.map((x) => `p.${x}`).join(', ')}`
    fail(s, 'E_UNKNOWN_BUILDER', k, `p.${k.value} is not a builder`, fix, path)
  }
  const kind = k.value as BuilderKind
  expect(s, 'punct', '(', undefined, path)
  const name = str(s, path)
  const prop: Property = {
    key,
    kind,
    name,
    chain: { required: false, readonly: false, managed: true },
    comments: texts(cs),
  }
  if (kind === 'json') {
    expect(s, 'punct', ',', 'add the validator as the second argument', path)
    prop.json = { validatorSource: opaque(s, path) }
  }
  if (skip(s, ',') && !is(peek(s), 'punct', ')')) {
    prop.definition = definition(s, path)
    skip(s, ',')
  }
  expect(s, 'punct', ')', undefined, path)
  parseChain(s, prop, path)
  return prop
}

// The .strict(), .required(), .readonly() and .managed(false) calls after the builder call, each at most once. .strict()
// is for p.enum and p.multiEnum alone.
function parseChain(s: S, prop: Property, path: string): void {
  while (skip(s, '.')) {
    const m = next(s)
    const flag = chainCall(s, m, path)
    if (flag === 'managed' ? !prop.chain.managed : prop.chain[flag]) {
      fail(s, 'E_BAD_CHAIN', m, `.${flag}() is called twice`, 'call it once', path)
    }
    if (flag === 'strict' && prop.kind !== 'enum' && prop.kind !== 'multiEnum') {
      const message = `.strict() is for p.enum and p.multiEnum, not p.${prop.kind}`
      fail(s, 'E_BAD_CHAIN', m, message, 'drop .strict()', path)
    }
    prop.chain[flag] = flag !== 'managed'
  }
}

// One chain call after its name `m`: `()`, or `(false)` for managed. Returns the flag it sets.
function chainCall(s: S, m: Token, path: string): ChainFlag {
  const bad = (message: string, fix: string) => fail(s, 'E_BAD_CHAIN', m, message, fix, path)
  const flag = m.value as ChainFlag
  if (!CHAIN_FLAGS.includes(flag)) {
    bad(`.${m.value}() is not a chain call`, 'use .strict(), .required(), .readonly() or .managed(false)')
  }
  const managed = flag === 'managed'
  const call = `write .${flag}(${managed ? 'false' : ''})`
  if (!is(next(s), 'punct', '(')) {
    bad(`.${flag} must be called`, call)
  }
  if (managed) {
    const a = next(s)
    if (!is(a, 'ident', 'false')) {
      bad(
        `.managed(${a.kind === 'ident' ? a.value : show(a)}) is not allowed`,
        'write .managed(false) or drop the call',
      )
    }
  }
  if (!is(next(s), 'punct', ')')) {
    bad(`.${flag}() takes ${managed ? 'only false' : 'no argument'}`, call)
  }
  return flag
}

// The p.json validator: the tokenizer scans it as one opaque token, balanced brackets up to the depth-zero comma.
function opaque(s: S, path: string): string {
  const t = next(s)
  if (t.kind !== 'opaque' || !t.value) {
    fail(s, 'E_NOT_DATA', t, 'p.json needs a validator', 'write p.json(name, validator, {...})', path)
  }
  return t.value
}

function parseTypeLine(s: S, exports: ObjectExport[], typed: Set<string>): void {
  const nameTok = next(s)
  const seq = (...pairs: [Token['kind'], string][]) => {
    for (const [kind, value] of pairs) {
      expect(s, kind, value, typeLineFix)
    }
  }
  seq(['punct', '='], ['ident', 'InferProperties'], ['punct', '<'], ['ident', 'typeof'])
  const ref = next(s)
  seq(['punct', '.'], ['ident', 'properties'], ['punct', '>'], ['punct', '&'], ['punct', '{'])
  seq(['ident', 'id'], ['punct', ':'], ['ident', 'string'], ['punct', '}'])
  skip(s, ';')
  if (!exports.some((e) => e.name === ref.value)) {
    fail(s, 'E_NOT_DATA', ref, `'${ref.value}' is not an export in this file`, typeLineFix)
  }
  if (nameTok.value !== `${ref.value}Data`) {
    fail(s, 'E_NOT_DATA', nameTok, `expected the type name ${ref.value}Data`, typeLineFix)
  }
  if (typed.has(ref.value)) {
    fail(s, 'E_NOT_DATA', nameTok, `'${nameTok.value}' is exported twice`, 'remove the duplicate type export')
  }
  typed.add(ref.value)
}

function parseConfig(s: S, imports: string[]): ConfigFile {
  const fix = 'write export default defineConfig({...})'
  expect(s, 'ident', 'export', fix)
  expect(s, 'ident', 'default', fix)
  const b = next(s)
  if (!is(b, 'ident', 'defineConfig')) {
    fail(s, 'E_NOT_DATA', b, `'${b.value}' is not defineConfig`, fix)
  }
  expect(s, 'punct', '(', fix)
  const c = config(s, '')
  skip(s, ',')
  expect(s, 'punct', ')', fix)
  skip(s, ';')
  const t = peek(s)
  if (t.kind !== 'eof') {
    fail(
      s,
      'E_NOT_DATA',
      t,
      `unexpected ${show(t)} after defineConfig`,
      'kalup.config.ts holds one export default defineConfig({...}) and nothing else',
    )
  }
  return { imports, ...c, objects: c.objects ?? {}, targets: c.targets ?? {} }
}

function parseRemoved(s: S, imports: string[]): RemovedFile {
  const fix = 'write export default defineRemoved({...})'
  expect(s, 'ident', 'export', fix)
  expect(s, 'ident', 'default', fix)
  expect(s, 'ident', 'defineRemoved', fix)
  expect(s, 'punct', '(', fix)
  const tombstones = map(tombstone)(s, '')
  skip(s, ',')
  expect(s, 'punct', ')', fix)
  skip(s, ';')
  const t = peek(s)
  if (t.kind !== 'eof') {
    fail(
      s,
      'E_NOT_DATA',
      t,
      `unexpected ${show(t)} after defineRemoved`,
      'removed.ts holds one export default defineRemoved({...}) and nothing else',
    )
  }
  return { imports, tombstones }
}
