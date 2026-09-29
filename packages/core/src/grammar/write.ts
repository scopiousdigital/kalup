import type {
  BarrelEntry,
  ConfigFile,
  Definition,
  ObjectFile,
  Override,
  Property,
  RemovedFile,
  Target,
} from './types.js'

const definitionKeys = [
  'label',
  'group',
  'fieldType',
  'description',
  'options',
  'hasUniqueValue',
  'formField',
  'lifecycle',
]
const optionKeys = ['value', 'label', 'as', 'hidden', 'description']
const lifecycleKeys = ['options', 'removedOptions', 'ignoreChanges', 'preventDestroy']
const targetKeys = ['portalId', 'protected', 'drift', 'allowDestroy', 'credentials', 'overrides']
const customKeys = [
  'primaryDisplayProperty',
  'requiredProperties',
  'searchableProperties',
  'secondaryDisplayProperties',
]

// Biome's line width. A literal that does not fit is broken one entry per line, the way biome breaks it.
const width = 120
// Backslash, both quotes, control characters (Cc), line and paragraph separators (Zl, Zp) and lone surrogates (Cs).
const unsafe = /[\\'"\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/gu
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Escapes a string for a literal in `quote`s. The app executes the file, so this is a security boundary. */
export function escapeString(s: string, quote: "'" | '"' = "'"): string {
  return s.replace(unsafe, (c) => {
    if (c === '\\') {
      return '\\\\'
    }
    if (c === "'" || c === '"') {
      return c === quote ? `\\${c}` : c
    }
    if (c === '\n') {
      return '\\n'
    }
    if (c === '\r') {
      return '\\r'
    }
    if (c === '\t') {
      return '\\t'
    }
    return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
}

/** Writes one file in canonical form. */
export function write(kind: 'object', data: ObjectFile): string
export function write(kind: 'config', data: ConfigFile): string
export function write(kind: 'removed', data: RemovedFile): string
export function write(kind: 'barrel', data: BarrelEntry[]): string
export function write(
  kind: 'object' | 'config' | 'removed' | 'barrel',
  data: ObjectFile | ConfigFile | RemovedFile | BarrelEntry[],
): string {
  if (kind === 'object') {
    return writeObjectFile(data as ObjectFile)
  }
  if (kind === 'config') {
    return writeConfigFile(data as ConfigFile)
  }
  if (kind === 'removed') {
    return writeRemovedFile(data as RemovedFile)
  }
  return writeBarrel(data as BarrelEntry[])
}

// Single quotes, or double quotes when the string holds more single quotes than double quotes, as biome picks them.
function q(s: string): string {
  const count = (c: string) => s.split(c).length - 1
  const quote = count("'") > count('"') ? '"' : "'"
  return `${quote}${escapeString(s, quote)}${quote}`
}

function key(k: string): string {
  return identifier.test(k) ? k : q(k)
}

function cmp(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

function lit(v: unknown): string {
  if (typeof v === 'string') {
    return q(v)
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return String(v)
  }
  if (Array.isArray(v)) {
    return `[${v.map(lit).join(', ')}]`
  }
  if (v && typeof v === 'object') {
    const es = Object.entries(v).filter(([, x]) => x !== undefined)
    return es.length ? `{ ${es.map(([k, x]) => `${key(k)}: ${lit(x)}`).join(', ')} }` : '{}'
  }
  throw new Error(`cannot write a ${typeof v}`)
}

// Biome measures display columns: an East Asian wide or fullwidth character (Hangul, CJK, kana, fullwidth forms) takes
// two. An astral code point is already two code units, which counts the wide ones (CJK extension B, emoji) by accident.
const wide = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/g

function columns(s: string): number {
  return s.length + (s.match(wide)?.length ?? 0)
}

// An array of two or more objects with two or more keys each always breaks, at any depth, and so does every literal
// around it. The rule is biome's, and biome propagates the break outwards.
function forced(v: unknown): boolean {
  if (Array.isArray(v)) {
    const objects = v.length > 1 && v.every((x) => x && typeof x === 'object' && Object.keys(x).length > 1)
    return objects || v.some(forced)
  }
  return !!v && typeof v === 'object' && Object.values(v).some(forced)
}

// The entries of a literal as they are written one per line, each with its `key: ` head, or none for a scalar.
function members(v: unknown): [string, unknown][] {
  if (Array.isArray(v)) {
    return v.map((x) => ['', x])
  }
  if (v && typeof v === 'object') {
    return Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => [`${key(k)}: `, x])
  }
  return []
}

// The lines of `head`, a literal and `tail` at `indent`: one line when it fits the width and holds no forced break,
// else one entry per line with each entry fitted in turn.
function wrap(head: string, v: unknown, tail: string, indent: string): string[] {
  const flat = `${indent}${head}${lit(v)}${tail}`
  const list = Array.isArray(v)
  const entries = members(v)
  if (!entries.length || (columns(flat) <= width && !forced(v))) {
    return [flat]
  }
  return [
    `${indent}${head}${list ? '[' : '{'}`,
    ...entries.flatMap(([h, x]) => wrap(h, x, ',', `${indent}  `)),
    `${indent}${list ? ']' : '}'}${tail}`,
  ]
}

function pick(obj: object, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k]
    if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}

// Every present value is written, defaults and empty lists included: presence decides ownership. Only the key order is
// canonical.
function canon(def: Definition): Record<string, unknown> {
  const out = pick(def, definitionKeys)
  if (def.options) {
    out.options = def.options.map((o) => pick(o, optionKeys))
  }
  if (def.lifecycle) {
    out.lifecycle = pick(def.lifecycle, lifecycleKeys)
  }
  return out
}

function comment(texts: string[], indent: string): string[] {
  return texts.map((t) => (t ? `${indent}// ${t}` : `${indent}//`))
}

// The file header, when there is one, and the blank line that separates it from the imports.
function header(texts: string[] | undefined): string[] {
  return texts?.length ? [...comment(texts, ''), ''] : []
}

// An object literal spanning `body` lines, or `{}` on the head line when empty, as biome writes it.
function block(head: string, body: string[], indent: string, tail: string): string[] {
  return body.length ? [`${head}{`, ...body, `${indent}}${tail}`] : [`${head}{}${tail}`]
}

// A chained call on a multi-line definition is broken the way biome and prettier break member chains.
function property(p: Property): string[] {
  const chain = [
    ...(p.chain.required ? ['.required()'] : []),
    ...(p.chain.readonly ? ['.readonly()'] : []),
    ...(p.chain.managed ? [] : ['.managed(false)']),
  ]
  const call = `${p.kind}(${q(p.name)}${p.json ? `, ${p.json.validatorSource}` : ''}`
  const def = p.definition && canon(p.definition)
  const fields = (i: string) => Object.entries(def ?? {}).flatMap(([k, v]) => wrap(`${k}: `, v, ',', i))
  const head = `    ${key(p.key)}: `
  if (!def) {
    return [`${head}p.${call})${chain.join('')},`]
  }
  if (!Object.keys(def).length) {
    return [`${head}p.${call}, {})${chain.join('')},`]
  }
  if (!chain.length) {
    return [`${head}p.${call}, {`, ...fields('      '), '    }),']
  }
  const calls = chain.map((c, i) => `      ${c}${i === chain.length - 1 ? ',' : ''}`)
  return [`${head}p`, `      .${call}, {`, ...fields('        '), '      })', ...calls]
}

function writeObjectFile(f: ObjectFile): string {
  const builders = [...new Set(f.exports.map((e) => e.builder))].sort(cmp)
  const pImport = f.exports.some((e) => e.properties.length) ? ['p'] : []
  const out = [
    ...header(f.header),
    `import { ${[...builders, 'type InferProperties', ...pImport].join(', ')} } from '@kalup/core'`,
    ...f.imports,
    '',
  ]
  f.exports.forEach((e, i) => {
    const body: string[] = []
    if (e.labels) {
      body.push(...wrap('labels: ', pick(e.labels, ['singular', 'plural']), ',', '  '))
    }
    for (const [k, v] of Object.entries(pick(e, customKeys))) {
      body.push(...wrap(`${k}: `, v, ',', '  '))
    }
    if (e.groups.length) {
      body.push('  groups: {')
      for (const g of [...e.groups].sort((a, b) => cmp(a.name, b.name))) {
        body.push(...comment(g.comments, '    '), ...wrap(`${key(g.name)}: `, { label: g.label }, ',', '    '))
      }
      body.push('  },')
    }
    if (e.properties.length) {
      body.push('  properties: {')
      for (const p of [...e.properties].sort((a, b) => cmp(a.name, b.name))) {
        body.push(...comment(p.comments, '    '), ...property(p))
      }
      body.push('  },')
    }
    if (i) {
      out.push('')
    }
    out.push(
      ...comment(e.comments, ''),
      ...block(`export const ${e.name} = ${e.builder}(${q(e.object)}, `, body, '', ')'),
      '',
      `export type ${e.name}Data = InferProperties<typeof ${e.name}.properties> & { id: string }`,
    )
  })
  return `${out.join('\n')}\n`
}

function override(o: Override): Record<string, unknown> {
  const out = pick(o, ['skip', 'name', 'definition', 'lookup'])
  if (o.definition) {
    out.definition = canon(o.definition)
  }
  return out
}

function target(t: Target): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(pick(t, targetKeys))) {
    const overrides = k === 'overrides' ? Object.entries(v as Record<string, Override>) : []
    if (overrides.length) {
      out.push('      overrides: {')
      for (const [address, o] of overrides) {
        out.push(...wrap(`${key(address)}: `, override(o), ',', '        '))
      }
      out.push('      },')
    } else if (k === 'credentials') {
      out.push(...wrap('credentials: ', pick(v as object, ['read', 'write']), ',', '      '))
    } else {
      out.push(...wrap(`${k}: `, v, ',', '      '))
    }
  }
  return out
}

function writeConfigFile(c: ConfigFile): string {
  const body: string[] = []
  if (c.name !== undefined) {
    body.push(`  name: ${q(c.name)},`)
  }
  if (c.prefix !== undefined) {
    body.push(`  prefix: ${q(c.prefix)},`)
  }
  if (c.defaultTarget !== undefined) {
    body.push(`  defaultTarget: ${q(c.defaultTarget)},`)
  }
  const objects = Object.entries(c.objects)
  if (objects.length) {
    body.push('  objects: {')
    for (const [k, v] of objects) {
      body.push(...wrap(`${key(k)}: `, pick(v, ['include', 'custom', 'as']), ',', '    '))
    }
    body.push('  },')
  }
  const targets = Object.entries(c.targets)
  if (targets.length) {
    body.push('  targets: {')
    for (const [name, t] of targets) {
      body.push(...block(`    ${key(name)}: `, target(t), '    ', ','))
    }
    body.push('  },')
  }
  const out = [
    ...header(c.header),
    "import { defineConfig } from 'kalup'",
    ...c.imports,
    '',
    ...block('export default defineConfig(', body, '', ')'),
  ]
  return `${out.join('\n')}\n`
}

// Tombstones sorted by address in code-unit order.
function writeRemovedFile(r: RemovedFile): string {
  const body = Object.entries(r.tombstones)
    .sort(([a], [b]) => cmp(a, b))
    .flatMap(([address, t]) => wrap(`${key(address)}: `, pick(t, ['action', 'reason']), ',', '  '))
  const out = [
    ...header(r.header),
    "import { defineRemoved } from 'kalup'",
    ...r.imports,
    '',
    ...block('export default defineRemoved(', body, '', ')'),
  ]
  return `${out.join('\n')}\n`
}

function writeBarrel(entries: BarrelEntry[]): string {
  const byFrom = new Map<string, string[]>()
  for (const e of [...entries].sort((a, b) => cmp(a.from, b.from) || cmp(a.name, b.name))) {
    byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), e.name])
  }
  const out: string[] = []
  for (const [from, names] of byFrom) {
    out.push(`export type { ${names.map((n) => `${n}Data`).join(', ')} } from ${q(from)}`)
    out.push(`export { ${names.join(', ')} } from ${q(from)}`)
  }
  return `${out.length ? out.join('\n') : 'export {}'}\n`
}
