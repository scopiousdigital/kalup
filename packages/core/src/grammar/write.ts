import { DEFAULTS } from '../ir/defaults.js'
import type { BarrelEntry, ConfigFile, Definition, ObjectFile, Option, Override, Property, Target } from './types.js'

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
const targetKeys = ['portalId', 'protected', 'drift', 'credentials', 'overrides']
const customKeys = [
  'primaryDisplayProperty',
  'requiredProperties',
  'searchableProperties',
  'secondaryDisplayProperties',
]

// Backslash, quote, control characters (Cc), line and paragraph separators (Zl, Zp) and lone surrogates (Cs).
const unsafe = /[\\'\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/gu

/** Escapes a string for a single-quoted literal. The app executes the file, so this is a security boundary. */
export function escapeString(s: string): string {
  return s.replace(unsafe, (c) => {
    if (c === '\\') return '\\\\'
    if (c === "'") return "\\'"
    if (c === '\n') return '\\n'
    if (c === '\r') return '\\r'
    if (c === '\t') return '\\t'
    return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
}

/** Writes one file in canonical form. */
export function write(kind: 'object', data: ObjectFile): string
export function write(kind: 'config', data: ConfigFile): string
export function write(kind: 'barrel', data: BarrelEntry[]): string
export function write(kind: 'object' | 'config' | 'barrel', data: ObjectFile | ConfigFile | BarrelEntry[]): string {
  if (kind === 'object') return writeObjectFile(data as ObjectFile)
  if (kind === 'config') return writeConfigFile(data as ConfigFile)
  return writeBarrel(data as BarrelEntry[])
}

function q(s: string): string {
  return `'${escapeString(s)}'`
}

function key(k: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : q(k)
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function lit(v: unknown): string {
  if (typeof v === 'string') return q(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`
  if (v && typeof v === 'object') {
    const es = Object.entries(v).filter(([, x]) => x !== undefined)
    return es.length ? `{ ${es.map(([k, x]) => `${key(k)}: ${lit(x)}`).join(', ')} }` : '{}'
  }
  throw new Error(`cannot write a ${typeof v}`)
}

function pick(obj: object, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

// Like pick, with the values in the default table and empty lists dropped.
function strip(obj: object, keys: string[], defaults: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(pick(obj, keys))) {
    if (v === (defaults as Record<string, unknown>)[k] || (Array.isArray(v) && !v.length)) continue
    out[k] = v
  }
  return out
}

function canon(def: Definition): Record<string, unknown> {
  const out = strip(def, definitionKeys, DEFAULTS.definition)
  if (Array.isArray(out.options)) {
    out.options = (out.options as Option[]).map((o) => strip(o, optionKeys, DEFAULTS.option))
  }
  if (out.lifecycle) {
    const l = strip(out.lifecycle, lifecycleKeys, DEFAULTS.lifecycle)
    if (Object.keys(l).length) out.lifecycle = l
    else delete out.lifecycle
  }
  return out
}

function comment(texts: string[], indent: string): string[] {
  return texts.map((t) => (t ? `${indent}// ${t}` : `${indent}//`))
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
  const fields = (i: string) =>
    Object.entries(def ?? {}).flatMap(([k, v]) => {
      if (k === 'options' && (v as unknown[]).length > 1) {
        return [`${i}options: [`, ...(v as unknown[]).map((o) => `${i}  ${lit(o)},`), `${i}],`]
      }
      return [`${i}${k}: ${lit(v)},`]
    })
  const head = `    ${key(p.key)}: `
  if (!def) return [`${head}p.${call})${chain.join('')},`]
  if (!Object.keys(def).length) return [`${head}p.${call}, {})${chain.join('')},`]
  if (!chain.length) return [`${head}p.${call}, {`, ...fields('      '), '    }),']
  const calls = chain.map((c, i) => `      ${c}${i === chain.length - 1 ? ',' : ''}`)
  return [`${head}p`, `      .${call}, {`, ...fields('        '), '      })', ...calls]
}

function writeObjectFile(f: ObjectFile): string {
  const builders = [...new Set(f.exports.map((e) => e.builder))].sort(cmp)
  const p = f.exports.some((e) => e.properties.length) ? ['p'] : []
  const out = [
    `import { ${[...builders, 'type InferProperties', ...p].join(', ')} } from '@kalup/core'`,
    ...f.imports,
    '',
  ]
  f.exports.forEach((e, i) => {
    const body: string[] = []
    if (e.labels) body.push(`  labels: ${lit(pick(e.labels, ['singular', 'plural']))},`)
    for (const [k, v] of Object.entries(pick(e, customKeys))) body.push(`  ${k}: ${lit(v)},`)
    if (e.groups.length) {
      body.push('  groups: {')
      for (const g of [...e.groups].sort((a, b) => cmp(a.name, b.name))) {
        body.push(...comment(g.comments, '    '), `    ${key(g.name)}: { label: ${q(g.label)} },`)
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
    if (i) out.push('')
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
  if (o.definition) out.definition = canon(o.definition)
  return out
}

function target(t: Target): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(pick(t, targetKeys))) {
    const overrides = k === 'overrides' ? Object.entries(v as Record<string, Override>) : []
    if (overrides.length) {
      out.push('      overrides: {')
      for (const [address, o] of overrides) out.push(`        ${key(address)}: ${lit(override(o))},`)
      out.push('      },')
    } else if (k === 'credentials') {
      out.push(`      credentials: ${lit(pick(v as object, ['read', 'write']))},`)
    } else {
      out.push(`      ${k}: ${lit(v)},`)
    }
  }
  return out
}

function writeConfigFile(c: ConfigFile): string {
  const body: string[] = []
  if (c.name !== undefined) body.push(`  name: ${q(c.name)},`)
  if (c.prefix !== undefined) body.push(`  prefix: ${q(c.prefix)},`)
  const objects = Object.entries(c.objects)
  if (objects.length) {
    body.push('  objects: {')
    for (const [k, v] of objects) body.push(`    ${key(k)}: ${lit(pick(v, ['include', 'custom', 'as']))},`)
    body.push('  },')
  }
  const targets = Object.entries(c.targets)
  if (targets.length) {
    body.push('  targets: {')
    for (const [name, t] of targets) body.push(...block(`    ${key(name)}: `, target(t), '    ', ','))
    body.push('  },')
  }
  const out = [
    "import { defineConfig } from 'kalup'",
    ...c.imports,
    '',
    ...block('export default defineConfig(', body, '', ')'),
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
