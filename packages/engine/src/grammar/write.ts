import type { EnumOption, KalupConfig, PropertyLifecycle } from '@kalup/core'
import type {
  BarrelEntry,
  ConfigFile,
  Definition,
  ObjectExport,
  ObjectFile,
  ObjectScope,
  Override,
  PipelineExport,
  PipelineFile,
  Property,
  RemovedFile,
  Stage,
  Target,
  TargetObject,
  Tombstone,
} from './types.js'

// The keys of T in the order the writer writes them. A key of T the list leaves out is a compile error that names it,
// so a field added to a config type does not compile until the writer writes it.
function every<T>() {
  return <const K extends readonly (keyof T)[]>(
    keys: K & ([Exclude<keyof T, K[number]>] extends [never] ? unknown : { missing: Exclude<keyof T, K[number]> }),
  ): K => keys
}

const configKeys = every<KalupConfig>()([
  'name',
  'dir',
  'state',
  'prefix',
  'defaultTarget',
  'mode',
  'objects',
  'targets',
])
const scopeKeys = every<ObjectScope>()(['mode', 'include', 'exclude', 'custom', 'as', 'pipelines'])
const targetKeys = every<Target>()([
  'portalId',
  'mode',
  'protected',
  'drift',
  'adopt',
  'allowDestroy',
  'yesLimit',
  'credentials',
  'objects',
  'overrides',
])
const targetObjectKeys = every<TargetObject>()(['mode'])
const credentialKeys = every<NonNullable<Target['credentials']>>()(['read', 'write'])
const overrideKeys = every<Override>()(['skip', 'name', 'definition', 'lookup'])
const definitionKeys = every<Definition>()([
  'label',
  'group',
  'fieldType',
  'description',
  'options',
  'hasUniqueValue',
  'formField',
  'hidden',
  'displayOrder',
  'numberDisplayHint',
  'showCurrencySymbol',
  'currencyPropertyName',
  'textDisplayHint',
  'calculationFormula',
  'dataSensitivity',
  'lifecycle',
])
// An override's definition: a property's fields, then a stage's metadata.
const overrideDefinitionKeys = every<NonNullable<Override['definition']>>()([
  ...definitionKeys,
  'probability',
  'ticketState',
  'state',
])
const optionKeys = every<EnumOption>()(['value', 'label', 'as', 'hidden', 'description'])
const stageKeys = every<Omit<Stage, 'comments' | 'key'>>()(['id', 'label', 'probability', 'ticketState', 'state'])
const lifecycleKeys = every<PropertyLifecycle>()(['options', 'removedOptions', 'ignoreChanges', 'preventDestroy'])
const tombstoneKeys = every<Tombstone>()(['action', 'reason'])
const labelKeys = every<NonNullable<ObjectExport['labels']>>()(['singular', 'plural'])
// Not every key of an export: the fields only a custom object has, besides its labels.
const customKeys = [
  'description',
  'primaryDisplayProperty',
  'requiredProperties',
  'searchableProperties',
  'secondaryDisplayProperties',
] as const satisfies readonly (keyof ObjectExport)[]

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
export function write(kind: 'pipeline', data: PipelineFile): string
export function write(kind: 'config', data: ConfigFile): string
export function write(kind: 'removed', data: RemovedFile): string
export function write(kind: 'barrel', data: BarrelEntry[]): string
export function write(
  kind: 'object' | 'pipeline' | 'config' | 'removed' | 'barrel',
  data: ObjectFile | PipelineFile | ConfigFile | RemovedFile | BarrelEntry[],
): string {
  if (kind === 'object') {
    return writeObjectFile(data as ObjectFile)
  }
  if (kind === 'pipeline') {
    return writePipelineFile(data as PipelineFile)
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

function pick(obj: object, keys: readonly string[]): Record<string, unknown> {
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
    ...(p.chain.strict ? ['.strict()'] : []),
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
      body.push(...wrap('labels: ', pick(e.labels, labelKeys), ',', '  '))
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

// A pipeline file: the exports in the order given, each pipeline's stages in file order, which is display order.
function writePipelineFile(f: PipelineFile): string {
  const out = [...header(f.header), "import { definePipeline } from '@kalup/core'", ...f.imports, '']
  f.exports.forEach((e: PipelineExport, i) => {
    const body = [
      ...wrap('id: ', e.id, ',', '  '),
      ...wrap('label: ', e.label, ',', '  '),
      `  displayOrder: ${e.displayOrder},`,
      ...block(
        '  stages: ',
        e.stages.flatMap((st) => [
          ...comment(st.comments, '    '),
          ...wrap(`${key(st.key)}: `, pick(st, stageKeys), ',', '    '),
        ]),
        '  ',
        ',',
      ),
    ]
    if (i) {
      out.push('')
    }
    out.push(
      ...comment(e.comments, ''),
      ...block(`export const ${e.name} = definePipeline(${q(e.object)}, `, body, '', ')'),
    )
  })
  return `${out.join('\n')}\n`
}

function override(o: Override): Record<string, unknown> {
  const out = pick(o, overrideKeys)
  if (o.definition) {
    const def = canon(o.definition)
    out.definition = { ...def, ...pick(o.definition, overrideDefinitionKeys.slice(definitionKeys.length)) }
  }
  return out
}

function target(t: Target): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(pick(t, targetKeys))) {
    const overrides = k === 'overrides' ? Object.entries(v as Record<string, Override>) : []
    const objects = k === 'objects' ? Object.entries(v as Record<string, TargetObject>) : []
    if (overrides.length) {
      out.push('      overrides: {')
      for (const [address, o] of overrides) {
        out.push(...wrap(`${key(address)}: `, override(o), ',', '        '))
      }
      out.push('      },')
    } else if (objects.length) {
      out.push('      objects: {')
      for (const [name, o] of objects) {
        out.push(...wrap(`${key(name)}: `, pick(o, targetObjectKeys), ',', '        '))
      }
      out.push('      },')
    } else if (k === 'credentials') {
      out.push(...wrap('credentials: ', pick(v as object, credentialKeys), ',', '      '))
    } else {
      out.push(...wrap(`${k}: `, v, ',', '      '))
    }
  }
  return out
}

// A top-level record of kalup.config.ts, left out when empty.
function section<T>(name: string, record: Record<string, T>, entry: (key: string, value: T) => string[]): string[] {
  const entries = Object.entries(record)
  return entries.length ? [`  ${name}: {`, ...entries.flatMap(([k, v]) => entry(k, v)), '  },'] : []
}

function writeConfigFile(c: ConfigFile): string {
  const body = configKeys.flatMap((k) => {
    if (k === 'objects') {
      return section(k, c.objects, (name, v) => wrap(`${key(name)}: `, pick(v, scopeKeys), ',', '    '))
    }
    if (k === 'targets') {
      return section(k, c.targets, (name, t) => block(`    ${key(name)}: `, target(t), '    ', ','))
    }
    return c[k] === undefined ? [] : wrap(`${k}: `, c[k], ',', '  ')
  })
  const out = [
    ...header(c.header),
    "import { defineConfig } from '@kalup/core'",
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
    .flatMap(([address, t]) => wrap(`${key(address)}: `, pick(t, tombstoneKeys), ',', '  '))
  const out = [
    ...header(r.header),
    "import { defineRemoved } from '@kalup/core'",
    ...r.imports,
    '',
    ...block('export default defineRemoved(', body, '', ')'),
  ]
  return `${out.join('\n')}\n`
}

// Relative specifiers with a .js suffix resolve the same under NodeNext, Bundler resolution, Vite, Next.js and plain
// Node running tsc output; an extensionless or .ts specifier does not.
function writeBarrel(entries: BarrelEntry[]): string {
  const byFrom = new Map<string, string[]>()
  for (const e of [...entries].sort((a, b) => cmp(a.from, b.from) || cmp(a.name, b.name))) {
    byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), e.name])
  }
  const pipelines = new Set(entries.filter((e) => e.pipeline).map((e) => `${e.from}\0${e.name}`))
  const out: string[] = []
  for (const [from, names] of byFrom) {
    const typed = names.filter((n) => !pipelines.has(`${from}\0${n}`))
    if (typed.length) {
      out.push(`export type { ${typed.map((n) => `${n}Data`).join(', ')} } from ${q(`${from}.js`)}`)
    }
    out.push(`export { ${names.join(', ')} } from ${q(`${from}.js`)}`)
  }
  return `${out.length ? out.join('\n') : 'export {}'}\n`
}
