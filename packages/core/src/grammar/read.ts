import { type Token, tokenize } from './tokenize.js'
import {
  type BuilderKind,
  type ConfigFile,
  type Definition,
  IssueError,
  type ObjectExport,
  type ObjectFile,
  type Property,
} from './types.js'

export type ReadResult =
  | { kind: 'object'; data: ObjectFile; lines: Record<string, number> }
  | { kind: 'config'; data: ConfigFile; lines: Record<string, number> }

interface S {
  file: string
  text: string
  toks: Token[]
  i: number
  lines: Record<string, number>
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
]
const toolOwned = ['@kalup/core', 'kalup']
const typeLineFix = 'write `export type <Name>Data = InferProperties<typeof <Name>.properties> & { id: string }`'

/** Parses one object file or kalup.config.ts into plain data. Throws IssueError on anything outside the grammar. */
export function read(text: string, file: string): ReadResult {
  const bom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const src = bom.replace(/\r\n?/g, '\n')
  const s: S = { file, text: src, toks: tokenize(src, file), i: 0, lines: {} }
  const header = parseHeader(s)
  const imports = parseImports(s)
  const top = header.length ? { header } : {}
  let j = s.i
  while (at(s, j).kind === 'comment') j++
  if (is(at(s, j), 'ident', 'export') && is(at(s, j + 1), 'ident', 'default')) {
    return { kind: 'config', data: { ...top, ...parseConfig(s, imports) }, lines: s.lines }
  }
  return { kind: 'object', data: { ...top, ...parseObjectFile(s, imports) }, lines: s.lines }
}

function at(s: S, i: number): Token {
  return s.toks[Math.min(i, s.toks.length - 1)] as Token
}

function is(t: Token, kind: Token['kind'], value: string): boolean {
  return t.kind === kind && t.value === value
}

function show(t: Token): string {
  return t.kind === 'eof' ? 'end of file' : t.kind === 'string' ? 'a string' : `'${t.value}'`
}

function fail(s: S, code: string, tok: Token, message: string, fix: string, configPath?: string): never {
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
  if (t.kind === 'comment') failComment(s, t)
  return t
}

function next(s: S): Token {
  const t = peek(s)
  s.i++
  return t
}

function expect(s: S, kind: Token['kind'], value: string, fix = `add '${value}'`, path?: string): Token {
  const t = peek(s)
  if (!is(t, kind, value)) fail(s, 'E_NOT_DATA', t, `expected '${value}' but found ${show(t)}`, fix, path)
  s.i++
  return t
}

function skip(s: S, value: string): boolean {
  if (!is(at(s, s.i), 'punct', value)) return false
  s.i++
  return true
}

// A comment on the same line as the token before it trails that token; only a comment on its own line leads an entry.
function takeComments(s: S, path?: string): Token[] {
  const out: Token[] = []
  while (at(s, s.i).kind === 'comment') {
    const t = at(s, s.i)
    if (s.i && at(s, s.i - 1).line === t.line) failComment(s, t, path)
    out.push(t)
    s.i++
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
  while (at(s, j).kind === 'comment') j++
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
      if (!name && !(t.kind === 'punct' && '{},*'.includes(t.value))) {
        fail(s, 'E_NOT_DATA', t, `unexpected ${show(t)} in an import`, fix)
      }
      prev = t
      t = next(s)
    }
    if (prev !== start && !is(prev, 'ident', 'from')) {
      fail(s, 'E_NOT_DATA', t, "expected 'from' before the module path", fix)
    }
    skip(s, ';')
    if (!toolOwned.includes(t.value)) kept.push(s.text.slice(start.start, t.end))
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
      if (cs[0]) failComment(s, cs[0], path)
      s.i++
      return
    }
    const tok = next(s)
    if (tok.kind !== 'ident' && tok.kind !== 'string') {
      const fix = 'write key: value entries only; no spreads, computed keys or shorthand'
      fail(s, 'E_NOT_DATA', tok, `expected a key but found ${show(tok)}`, fix, path)
    }
    if (cs[0] && !comments) failComment(s, cs[0], path)
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
    s.lines[join(path, key)] = tok.line
    entry(key, tok, cs)
    if (!skip(s, ',')) {
      expect(s, 'punct', '}', "add ',' between entries", path)
      return
    }
  }
}

const str: Parse<string> = (s, path) => {
  const t = next(s)
  if (t.kind !== 'string')
    fail(s, 'E_NOT_DATA', t, `expected a string but found ${show(t)}`, 'write a single-quoted string', path)
  return t.value
}

const num: Parse<number> = (s, path) => {
  const t = next(s)
  if (t.kind !== 'number') fail(s, 'E_NOT_DATA', t, `expected a number but found ${show(t)}`, 'write a number', path)
  return Number(t.value)
}

const bool: Parse<boolean> = (s, path) => {
  const t = next(s)
  if (!is(t, 'ident', 'true') && !is(t, 'ident', 'false')) {
    fail(s, 'E_NOT_DATA', t, `expected true or false but found ${show(t)}`, 'write true or false', path)
  }
  return t.value === 'true'
}

const literalTrue: Parse<true> = (s, path) => {
  const t = next(s)
  if (!is(t, 'ident', 'true'))
    fail(s, 'E_NOT_DATA', t, `expected true but found ${show(t)}`, 'write true or drop the field', path)
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
      if (!skip(s, ',')) break
    }
    expect(s, 'punct', ']', "add ',' between items", path)
    return out
  }
}

function shape<T>(fields: Record<string, Parse<unknown>>, required: string[] = []): Parse<T> {
  return (s, path) => {
    const open = peek(s)
    const out: Record<string, unknown> = {}
    entries(s, path, false, (key, tok) => {
      const parse = fields[key]
      if (!parse)
        fail(s, 'E_NOT_DATA', tok, `unknown field '${key}'`, `use one of ${Object.keys(fields).join(', ')}`, path)
      out[key] = parse(s, join(path, key))
    })
    for (const k of required) if (!(k in out)) fail(s, 'E_NOT_DATA', open, `missing field '${k}'`, `add ${k}`, path)
    return Object.fromEntries(Object.keys(fields).flatMap((k) => (k in out ? [[k, out[k]]] : []))) as T
  }
}

function map<T>(item: Parse<T>): Parse<Record<string, T>> {
  return (s, path) => {
    const out: Record<string, T> = {}
    entries(s, path, false, (key) => {
      out[key] = item(s, join(path, key))
    })
    return out
  }
}

const group = shape<{ label: string }>({ label: str }, ['label'])
const option = shape({ value: str, label: str, as: str, hidden: bool, description: str }, ['value', 'label'])
const lifecycle = shape({
  options: oneOf('additive', 'exact'),
  removedOptions: list(str),
  ignoreChanges: list(str),
  preventDestroy: bool,
})
const definition: Parse<Definition> = shape({
  label: str,
  group: str,
  fieldType: str,
  description: str,
  options: list(option),
  hasUniqueValue: bool,
  formField: bool,
  lifecycle,
})
const customFields: Record<string, Parse<unknown>> = {
  labels: shape({ singular: str, plural: str }, ['singular', 'plural']),
  primaryDisplayProperty: str,
  requiredProperties: list(str),
  searchableProperties: list(str),
  secondaryDisplayProperties: list(str),
}
const env = shape({ env: str }, ['env'])
const config: Parse<Partial<ConfigFile>> = shape({
  name: str,
  prefix: str,
  objects: map(shape({ include: list(str), custom: bool, as: str })),
  targets: map(
    shape({
      portalId: num,
      protected: bool,
      drift: oneOf('hold', 'overwrite'),
      credentials: shape({ read: env, write: env }, ['read']),
      overrides: map(shape({ skip: literalTrue, name: str, definition, lookup: map(str) })),
    }),
  ),
})

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
      if (cs[0]) failComment(s, cs[0])
      return { imports, exports }
    }
    expect(s, 'ident', 'export', fix)
    const t = peek(s)
    if (is(t, 'ident', 'const')) {
      s.i++
      exports.push(parseExport(s, cs, exports))
    } else if (is(t, 'ident', 'type')) {
      if (cs[0]) failComment(s, cs[0])
      s.i++
      parseTypeLine(s, exports, typed)
    } else {
      fail(s, 'E_NOT_DATA', t, `unexpected ${show(t)} after 'export'`, fix)
    }
  }
}

function parseExport(s: S, cs: Token[], exports: ObjectExport[]): ObjectExport {
  const nameTok = next(s)
  if (nameTok.kind !== 'ident')
    fail(
      s,
      'E_NOT_DATA',
      nameTok,
      `expected an export name but found ${show(nameTok)}`,
      'write export const <Name> = ...',
    )
  const name = nameTok.value
  if (exports.some((e) => e.name === name)) {
    fail(s, 'E_DUPLICATE_KEY', nameTok, `duplicate export '${name}'`, 'rename one of the two exports', name)
  }
  expect(s, 'punct', '=', 'write export const <Name> = defineObject(...)', name)
  const b = next(s)
  if (!is(b, 'ident', 'defineObject') && !is(b, 'ident', 'defineCustomObject')) {
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
  s.i++
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
  while (skip(s, '.')) {
    const m = next(s)
    const bad = (message: string, fix: string) => fail(s, 'E_BAD_CHAIN', m, message, fix, path)
    const flag = m.value as 'required' | 'readonly' | 'managed'
    if (!['required', 'readonly', 'managed'].includes(flag)) {
      bad(`.${m.value}() is not a chain call`, 'use .required(), .readonly() or .managed(false)')
    }
    if (!is(next(s), 'punct', '('))
      bad(`.${flag} must be called`, `write .${flag}(${flag === 'managed' ? 'false' : ''})`)
    if (flag === 'managed') {
      const a = next(s)
      if (!is(a, 'ident', 'false'))
        bad(
          `.managed(${a.kind === 'ident' ? a.value : show(a)}) is not allowed`,
          'write .managed(false) or drop the call',
        )
    }
    if (!is(next(s), 'punct', ')'))
      bad(
        `.${flag}() takes ${flag === 'managed' ? 'only false' : 'no argument'}`,
        `write .${flag}(${flag === 'managed' ? 'false' : ''})`,
      )
    if (flag === 'managed' ? !prop.chain.managed : prop.chain[flag]) bad(`.${flag}() is called twice`, 'call it once')
    prop.chain[flag] = flag !== 'managed'
  }
  return prop
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
    for (const [kind, value] of pairs) expect(s, kind, value, typeLineFix)
  }
  seq(['punct', '='], ['ident', 'InferProperties'], ['punct', '<'], ['ident', 'typeof'])
  const ref = next(s)
  seq(['punct', '.'], ['ident', 'properties'], ['punct', '>'], ['punct', '&'], ['punct', '{'])
  seq(['ident', 'id'], ['punct', ':'], ['ident', 'string'], ['punct', '}'])
  skip(s, ';')
  if (!exports.some((e) => e.name === ref.value)) {
    fail(s, 'E_NOT_DATA', ref, `'${ref.value}' is not an export in this file`, typeLineFix)
  }
  if (nameTok.value !== `${ref.value}Data`)
    fail(s, 'E_NOT_DATA', nameTok, `expected the type name ${ref.value}Data`, typeLineFix)
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
  if (!is(b, 'ident', 'defineConfig')) fail(s, 'E_NOT_DATA', b, `'${b.value}' is not defineConfig`, fix)
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
