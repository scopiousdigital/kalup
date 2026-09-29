import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { builderKinds, type ReadResult, read } from '../../src/grammar/read.js'
import type { BuilderKind, ConfigFile, Definition, ObjectFile, Property, RemovedFile } from '../../src/grammar/types.js'
import { write } from '../../src/grammar/write.js'
import { fixtureText, project } from '../../src/loader/fixture.js'
import { loadFiles } from '../../src/loader/load.js'

const dir = new URL('../fixtures/grammar/', import.meta.url)
const fixture = (name: string) => readFileSync(new URL(name, dir), 'utf8')
const canonical = [
  'companies.ts',
  'subscription.ts',
  'invoices.ts',
  'products.ts',
  'defaults.ts',
  'kalup.config.ts',
  'scoped.config.ts',
  'defaults.config.ts',
  'removed.ts',
]

function rewrite(r: ReadResult): string {
  if (r.kind === 'object') {
    return write('object', r.data)
  }
  return r.kind === 'config' ? write('config', r.data) : write('removed', r.data)
}

test.each(canonical)('write(read(%s)) is byte-identical', (name) => {
  const text = fixture(name)
  expect(rewrite(read(text, name))).toBe(text)
})

test.each(canonical)('%s with CRLF line endings reads the same', (name) => {
  const text = fixture(name)
  expect(read(text.replace(/\n/g, '\r\n'), name)).toEqual(read(text, name))
})

// What kalup fmt does to the files the loader reads: each one read and written back. Other files stay as they are.
function fmt(files: Record<string, string>): Record<string, string> {
  const formats = (file: string) =>
    file === 'kalup.config.ts' || (file.startsWith('kalup/') && file.endsWith('.ts') && file !== 'kalup/index.ts')
  return Object.fromEntries(
    Object.entries(files).map(([file, text]) => [file, formats(file) ? rewrite(read(text, file)) : text]),
  )
}

// The loader refuses these, so fmt, which validates first, never formats them.
const refused = ['E_DUPLICATE_ADDRESS.ts', 'E_DUPLICATE_KEY.ts', 'E_REFERENCE_DEFINITION.ts']
const rules = readdirSync(new URL('../fixtures/loader/rules/', import.meta.url))
  .filter((name) => !refused.includes(name))
  .map((name): [string, Record<string, string>] => {
    const config = name.endsWith('.config.ts') ? name : 'base.config.ts'
    const object = name.endsWith('.config.ts') ? 'base.ts' : name
    const files = {
      'kalup.config.ts': fixtureText(`rules/${config}`),
      'kalup/objects/deals.ts': fixtureText(`rules/${object}`),
    }
    return [`rules/${name}`, files]
  })
const projects: [string, Record<string, string>][] = [
  ['loader/spec', project('spec')],
  ['loader/app', project('app')],
  ['loader/payload', project('payload')],
  ...rules,
  [
    'grammar',
    {
      'kalup.config.ts': fixture('kalup.config.ts'),
      'kalup/objects/companies.ts': fixture('companies.ts'),
      'kalup/objects/subscription.ts': fixture('subscription.ts'),
      'kalup/objects/invoices.ts': fixture('invoices.ts'),
      'kalup/objects/products.ts': fixture('products.ts'),
    },
  ],
  ['grammar/scoped.config.ts', { 'kalup.config.ts': fixture('scoped.config.ts') }],
  [
    'grammar/defaults',
    { 'kalup.config.ts': fixture('defaults.config.ts'), 'kalup/objects/crates.ts': fixture('defaults.ts') },
  ],
  ['grammar/removed.ts', { 'kalup.config.ts': fixture('kalup.config.ts'), 'kalup/removed.ts': fixture('removed.ts') }],
  [
    'codecs/fleet.ts',
    {
      'kalup.config.ts': fixtureText('rules/base.config.ts'),
      'kalup/objects/fleet.ts': readFileSync(new URL('../fixtures/codecs/fleet.ts', import.meta.url), 'utf8'),
    },
  ],
]

// Presence decides ownership, so the check is strict: a field fmt dropped would fail it even if its value was a default.
test.each(projects)('formatting %s keeps the IR, field presence included', (_name, files) => {
  expect(loadFiles(fmt(files)).ir).toStrictEqual(loadFiles(files).ir)
})

test('formatting keeps every explicit default in definitions, options, lifecycle blocks and overrides', () => {
  const files = fmt({
    'kalup.config.ts': fixture('defaults.config.ts'),
    'kalup/objects/crates.ts': fixture('defaults.ts'),
  })
  const { resources, targets } = loadFiles(files).ir
  expect(resources).toMatchObject({
    'property:crates/crate_kind': { definition: { options: [] } },
    'property:crates/fragile': { definition: { description: '', hasUniqueValue: false, formField: false } },
    'property:crates/handling_code': {
      definition: {
        description: '',
        options: [
          { value: 'std', label: 'Standard', hidden: false, description: '' },
          { value: 'COLD', label: 'Cold chain', hidden: false },
        ],
      },
    },
    'property:crates/route': { definition: { options: [] } },
  })
  expect(targets).toStrictEqual({
    sandbox: {
      portalId: 3_131_313,
      overrides: {
        'property:crates/handling_code': {
          definition: {
            description: '',
            options: [{ value: 'std', label: 'Standard', hidden: false, description: '' }],
            hasUniqueValue: false,
            formField: false,
            lifecycle: { options: 'additive', removedOptions: [], ignoreChanges: [] },
          },
        },
        'property:crates/route': { definition: { options: [], lifecycle: {} } },
      },
    },
  })
})

test('read returns the data shapes with comments, chains, opaque source and kept imports', () => {
  const r = read(fixture('companies.ts'), 'companies.ts')
  expect(r.kind).toBe('object')
  if (r.kind !== 'object') {
    return
  }
  expect(r.data.imports).toEqual(["import { BillingMeta } from '../../src/billing'"])
  const company = r.data.exports.at(0)
  expect(company?.name).toBe('Company')
  expect(company?.builder).toBe('defineObject')
  expect(company?.object).toBe('companies')
  expect(company?.groups).toEqual([{ name: 'billing', label: 'Billing', comments: [] }])
  const byKey = Object.fromEntries((company?.properties ?? []).map((p) => [p.key, p]))
  expect(byKey.billingId).toEqual({
    key: 'billingId',
    kind: 'stringArray',
    name: 'billing_id',
    definition: { label: 'Billing ID', group: 'billing', fieldType: 'text' },
    chain: { required: false, readonly: false, managed: true },
    comments: ['Managed. Carries its full definition.'],
  })
  expect(byKey.billingMeta?.json).toEqual({ validatorSource: 'BillingMeta' })
  expect(byKey.billingStatus?.chain).toEqual({ required: true, readonly: false, managed: true })
  expect(byKey.billingStatus?.definition?.options?.[1]).toEqual({
    value: 'PAST DUE',
    label: 'Past due',
    as: 'past_due',
  })
  expect(byKey.lifetimeValue?.definition).toBeUndefined()
  expect(byKey.lifetimeValue?.chain).toEqual({ required: false, readonly: true, managed: true })
  expect(r.lines).toMatchObject({
    Company: 4,
    'Company.groups.billing': 6,
    'Company.properties.billingId': 10,
    'Company.properties.billingStatus.fieldType': 24,
    'Company.properties.billingStatus.options[1].as': 27,
    'Company.properties.billingStatus.lifecycle.ignoreChanges': 29,
  })
})

// The reader drops numeric separators and the writer writes plain digits, so the canonical text comes back.
test('a config with numeric separators is re-written without them', () => {
  const text = fixture('kalup.config.ts')
  const separated = text.replace('1111111', '1_111_111').replace('2222222', '2_222_222')
  expect(separated).not.toBe(text)
  expect(rewrite(read(separated, 'kalup.config.ts'))).toBe(text)
})

test('read handles a config file and its line map', () => {
  const r = read(fixture('kalup.config.ts'), 'kalup.config.ts')
  expect(r.kind).toBe('config')
  if (r.kind !== 'config') {
    return
  }
  expect(r.data.name).toBe('acme-crm')
  expect(r.data.objects.products).toEqual({ include: ['hs_object_id', 'name', 'hs_sku'], custom: false })
  expect(r.data.targets).toHaveProperty(['production', 'overrides', 'object:subscription'], { skip: true })
  expect(r.lines).toMatchObject({ name: 4, 'targets.production.portalId': 17, 'targets.production.overrides': 21 })
})

test('read keeps the header and the broken string arrays of the wide fixtures', () => {
  const c = read(fixture('scoped.config.ts'), 'scoped.config.ts')
  expect(c.kind === 'config' && c.data.header).toEqual(['The pull scope for the demo portal.'])
  expect(c.kind === 'config' && c.data.defaultTarget).toBe('sandbox')
  expect(c.lines.defaultTarget).toBe(7)
  const products = c.kind === 'config' ? c.data.objects.products : undefined
  expect(products?.include).toHaveLength(10)
  expect(c.kind === 'config' && c.data.objects.subscription).toEqual({})
  const o = read(fixture('products.ts'), 'products.ts')
  expect(o.kind === 'object' && o.data.header).toHaveLength(2)
  expect(o.kind === 'object' && o.data.exports[0]?.comments).toEqual(['Catalogue items, synced from the shop nightly.'])
  expect(o.kind === 'object' && o.data.exports[0]?.requiredProperties).toHaveLength(8)
  const tier = o.kind === 'object' ? o.data.exports.at(0)?.properties.find((p) => p.key === 'tier') : undefined
  expect(tier?.definition?.lifecycle?.removedOptions).toHaveLength(7)
  expect(o.lines['Product.properties.tier.lifecycle.ignoreChanges']).toBe(51)
})

test('read accepts double quotes, semicolons, trailing commas, any chain order and any field order', () => {
  const loose = [
    'import { p, defineObject, type InferProperties } from "@kalup/core";',
    'import { Meta } from "./meta";',
    'export const Thing = defineObject("things", {',
    '  properties: {',
    '    "b": p.string("b", { fieldType: "text", label: "B", group: "g", }).managed(false).readonly().required(),',
    '    a: p.json("a", Meta,),',
    '  },',
    '  groups: { g: { label: "G" } },',
    '},);',
    'export type ThingData = InferProperties<typeof Thing.properties> & { id: string };',
    '',
  ].join('\n')
  const r = read(loose, 'things.ts')
  expect(r.kind === 'object' && r.data.imports).toEqual(['import { Meta } from "./meta"'])
  expect(rewrite(r)).toBe(
    [
      "import { defineObject, type InferProperties, p } from '@kalup/core'",
      'import { Meta } from "./meta"',
      '',
      "export const Thing = defineObject('things', {",
      '  groups: {',
      "    g: { label: 'G' },",
      '  },',
      '  properties: {',
      "    a: p.json('a', Meta),",
      '    b: p',
      "      .string('b', {",
      "        label: 'B',",
      "        group: 'g',",
      "        fieldType: 'text',",
      '      })',
      '      .required()',
      '      .readonly()',
      '      .managed(false),',
      '  },',
      '})',
      '',
      'export type ThingData = InferProperties<typeof Thing.properties> & { id: string }',
      '',
    ].join('\n'),
  )
})

test.each([
  "z.object({ a: z.enum(['x', 'y)']), b: fn(1, 2) }).refine((v) => v, 'msg, with comma')",
  'z.string().regex(/^\\d+$/)',
  "z.string().regex(/[)'\"\\/]/, 'x')",
  'schéma /* c, ) */',
  'z.string().describe(`x, y)`)',
  'a / b',
  'z.object({\n  a: z.string(),\n})',
])('the p.json validator %s is opaque source up to the depth-zero comma', (src) => {
  const text = `import { defineObject, p } from '@kalup/core'\nexport const T = defineObject('t', { properties: { j: p.json('j', ${src}, { label: 'J' }) } })\n`
  const r = read(text, 't.ts')
  expect(r.kind === 'object' && r.data.exports[0]?.properties[0]).toMatchObject({
    json: { validatorSource: src },
    definition: { label: 'J' },
  })
  expect(r.lines['T.properties.j.label']).toBe(1 + src.split('\n').length)
})

// A present field is owned, so a value equal to HubSpot's default is written like any other.
test('the writer keeps explicit defaults and sorts properties and groups', () => {
  const x: ObjectFile = {
    imports: [],
    exports: [
      {
        name: 'Deal',
        builder: 'defineObject',
        object: 'deals',
        comments: [],
        groups: [
          { name: 'z', label: 'Z', comments: [] },
          { name: 'a', label: 'A', comments: [] },
        ],
        properties: [
          {
            key: 'stage',
            kind: 'enum',
            name: 'dealstage',
            definition: {
              label: 'Stage',
              group: 'a',
              fieldType: 'select',
              description: '',
              options: [{ value: 'won', label: 'Won', hidden: false }],
              hasUniqueValue: false,
              formField: false,
              lifecycle: { options: 'additive', removedOptions: [], ignoreChanges: [] },
            },
            chain: { required: false, readonly: false, managed: true },
            comments: [],
          },
          {
            key: 'amount',
            kind: 'number',
            name: 'amount',
            chain: { required: false, readonly: false, managed: true },
            comments: [],
          },
        ],
      },
    ],
  }
  expect(write('object', x)).toBe(
    [
      "import { defineObject, type InferProperties, p } from '@kalup/core'",
      '',
      "export const Deal = defineObject('deals', {",
      '  groups: {',
      "    a: { label: 'A' },",
      "    z: { label: 'Z' },",
      '  },',
      '  properties: {',
      "    amount: p.number('amount'),",
      "    stage: p.enum('dealstage', {",
      "      label: 'Stage',",
      "      group: 'a',",
      "      fieldType: 'select',",
      "      description: '',",
      "      options: [{ value: 'won', label: 'Won', hidden: false }],",
      '      hasUniqueValue: false,',
      '      formField: false,',
      "      lifecycle: { options: 'additive', removedOptions: [], ignoreChanges: [] },",
      '    }),',
      '  },',
      '})',
      '',
      'export type DealData = InferProperties<typeof Deal.properties> & { id: string }',
      '',
    ].join('\n'),
  )
})

// Two degenerate inputs the fuzz never generates: the tokenizer trims a comment line, and an empty header is no header.
test('read(write(x)) trims a trailing space from a header or comment line and drops an empty header', () => {
  const bare = { name: 'Deal', builder: 'defineObject' as const, object: 'deals', groups: [], properties: [] }
  const exports = [{ ...bare, comments: ['note '] }]
  const spaced = read(write('object', { header: ['top '], imports: [], exports }), 'deals.ts')
  expect(spaced.data).toMatchObject({ header: ['top'], exports: [{ comments: ['note'] }] })
  const empty = read(write('object', { header: [], imports: [], exports: [{ ...bare, comments: [] }] }), 'deals.ts')
  expect(empty.data).not.toHaveProperty('header')
})

// A small seeded generator so a failure is reproducible from the seed in its message.
function rng(seed: number): () => number {
  let a = seed
  return () => {
    // biome-ignore lint/suspicious/noBitwiseOperators: mulberry32 PRNG, its 32-bit bit mixing is the algorithm
    a = (a + 0x6d_2b_79_f5) | 0
    // biome-ignore lint/suspicious/noBitwiseOperators: mulberry32 bit mixing, as above
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    // biome-ignore lint/suspicious/noBitwiseOperators: mulberry32 bit mixing, as above
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    // biome-ignore lint/suspicious/noBitwiseOperators: mulberry32 bit mixing, as above
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const nasty = [
  "'",
  '"',
  '\\',
  '\n',
  '\r',
  '\t',
  '\0',
  '\x01',
  '\x1f',
  '\x7f',
  '\x85',
  String.fromCharCode(0x20_28),
  String.fromCharCode(0x20_29),
  '${',
  '`',
  '\u{d800}',
  '\u{dfff}',
  '\u{feff}',
  '\u{a0}',
  '\u{200b}',
  '</script>',
]
const plain = [
  'a',
  'b',
  'Z',
  '0',
  '9',
  ' ',
  '_',
  '-',
  '/',
  ',',
  ')',
  ']',
  '}',
  '//',
  '/*',
  '*/',
  'é',
  'ß',
  '日本',
  '😀',
]
const validators = [
  'Meta',
  'z.object({ a: z.string() })',
  'Meta.bar[0]',
  "z.array(Line).min(1).describe('x, y)')",
  'z.string().regex(/^\\d+$/)',
  'z.string() /* id, ) */',
]
// Everything that can carry a comment.
const holders = (f: ObjectFile) => f.exports.flatMap((e) => [e, ...e.groups, ...e.properties])
const skipped = /^(import|export type) /
const defaultExport = /^export default /m

function gen(seed: number) {
  const r = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)] as T
  const n = (max: number) => Math.floor(r() * (max + 1))
  const chance = (p: number) => r() < p
  const str = (max = 6) => Array.from({ length: n(max) }, () => (chance(0.4) ? pick(nasty) : pick(plain))).join('')
  const ident = () =>
    `${pick(['a', 'B', '_', '$'])}${Array.from({ length: n(5) }, () => pick(['a', 'z', 'Q', '9', '_'])).join('')}`
  const key = () => (chance(0.6) ? ident() : str())
  // credentials name an environment variable: the reader takes nothing else there.
  const variable = () =>
    `${pick(['A', 'Z', '_'])}${Array.from({ length: n(5) }, () => pick(['A', 'z', '9', '_'])).join('')}`
  // No line terminators: a JS engine ends the comment there. The separator fuzz below proves the reader refuses them.
  const line = () =>
    str(12)
      .replace(/[\r\n\p{Zl}\p{Zp}]/gu, ' ')
      .trimEnd()
  const comment = () => Array.from({ length: n(2) }, line)
  const header = () => (chance(0.3) ? { header: Array.from({ length: 1 + n(1) }, line) } : {})
  const uniq = <T extends { name: string }>(xs: T[]) =>
    xs.filter((x, i) => xs.findIndex((y) => y.name === x.name) === i)
  const strs = () => Array.from({ length: 1 + n(2) }, () => str())
  const definition = (): Definition => {
    const d: Definition = {}
    if (chance(0.7)) {
      Object.assign(d, { label: str(), group: str(), fieldType: pick(['text', 'select', 'number']) })
    }
    // Values equal to HubSpot's defaults (empty strings and lists, false, an empty lifecycle) are owned data too.
    if (chance(0.3)) {
      d.description = str()
    }
    if (chance(0.5)) {
      d.options = Array.from({ length: n(3) }, () => ({
        value: str(),
        label: str(),
        ...(chance(0.4) ? { as: str() } : {}),
        ...(chance(0.3) ? { hidden: chance(0.5) } : {}),
        ...(chance(0.3) ? { description: str() } : {}),
      }))
    }
    if (chance(0.2)) {
      d.hasUniqueValue = chance(0.5)
    }
    if (chance(0.2)) {
      d.formField = chance(0.5)
    }
    if (chance(0.3)) {
      d.lifecycle = {
        ...(chance(0.5) ? { options: pick<'additive' | 'exact'>(['additive', 'exact']) } : {}),
        ...(chance(0.5) ? { removedOptions: Array.from({ length: n(2) }, () => str()) } : {}),
        ...(chance(0.5) ? { ignoreChanges: Array.from({ length: n(2) }, () => str()) } : {}),
        ...(chance(0.5) ? { preventDestroy: true } : {}),
      }
    }
    return d
  }
  const property = (): Property => {
    const kind = pick(builderKinds as BuilderKind[])
    return {
      key: key(),
      kind,
      name: str(),
      ...(chance(0.7) ? { definition: definition() } : {}),
      chain: { required: chance(0.3), readonly: chance(0.3), managed: !chance(0.2) },
      ...(kind === 'json' ? { json: { validatorSource: pick(validators) } } : {}),
      comments: comment(),
    }
  }
  const byName = (a: { name: string }, b: { name: string }) => {
    if (a.name < b.name) {
      return -1
    }
    return a.name > b.name ? 1 : 0
  }
  const object = (): ObjectFile => ({
    ...header(),
    imports: chance(0.5) ? ["import { Meta, Line } from '../../src/meta'", 'import { z } from "zod"'] : [],
    exports: uniq(
      Array.from({ length: 1 + n(1) }, () => {
        const builder = pick(['defineObject', 'defineCustomObject'] as const)
        const props = Array.from({ length: n(6) }, property).filter(
          (p, i, xs) => xs.findIndex((q) => q.key === p.key) === i,
        )
        return {
          name: ident(),
          builder,
          object: str(),
          comments: comment(),
          ...(builder === 'defineCustomObject' && chance(0.7) ? { labels: { singular: str(), plural: str() } } : {}),
          ...(builder === 'defineCustomObject' && chance(0.5) ? { primaryDisplayProperty: str() } : {}),
          ...(builder === 'defineCustomObject' && chance(0.5) ? { requiredProperties: strs() } : {}),
          groups: uniq(Array.from({ length: n(3) }, () => ({ name: str(), label: str(), comments: comment() }))).sort(
            byName,
          ),
          properties: props.sort(byName),
        }
      }),
    ),
  })
  const config = (): ConfigFile => ({
    ...header(),
    imports: [],
    ...(chance(0.5) ? { name: str() } : {}),
    ...(chance(0.5) ? { prefix: str() } : {}),
    ...(chance(0.4) ? { defaultTarget: str() } : {}),
    objects: Object.fromEntries(
      Array.from({ length: n(3) }, () => [
        key(),
        {
          ...(chance(0.5) ? { include: strs() } : {}),
          ...(chance(0.5) ? { custom: chance(0.5) } : {}),
          ...(chance(0.5) ? { as: str() } : {}),
        },
      ]),
    ),
    targets: Object.fromEntries(
      Array.from({ length: n(3) }, () => [
        key(),
        {
          ...(chance(0.8) ? { portalId: n(99_999_999) } : {}),
          ...(chance(0.5) ? { protected: chance(0.5) } : {}),
          ...(chance(0.5) ? { drift: pick(['hold', 'overwrite'] as const) } : {}),
          ...(chance(0.4) ? { allowDestroy: chance(0.5) } : {}),
          ...(chance(0.5)
            ? { credentials: { read: { env: variable() }, ...(chance(0.5) ? { write: { env: variable() } } : {}) } }
            : {}),
          ...(chance(0.5)
            ? {
                overrides: Object.fromEntries(
                  Array.from({ length: n(3) }, () => [
                    str(),
                    {
                      ...(chance(0.3) ? { skip: true as const } : {}),
                      ...(chance(0.5) ? { name: str() } : {}),
                      ...(chance(0.3) ? { definition: definition() } : {}),
                      ...(chance(0.3)
                        ? { lookup: Object.fromEntries(Array.from({ length: n(2) }, () => [key(), str()])) }
                        : {}),
                    },
                  ]),
                ),
              }
            : {}),
        },
      ]),
    ),
  })
  // Keys are mostly addresses, of any type: the reader takes any key and validate checks it.
  const removed = (): RemovedFile => ({
    ...header(),
    imports: [],
    tombstones: Object.fromEntries(
      Array.from({ length: n(4) }, () => [
        chance(0.8) ? `${pick(['property', 'group', 'object'])}:${str()}` : key(),
        { action: pick(['destroy', 'release'] as const), ...(chance(0.5) ? { reason: str() } : {}) },
      ]),
    ),
  })
  return { object, config, removed }
}

test('fuzz: write then read then write is stable and read(write(x)) equals x', () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const g = gen(seed)
    for (const [kind, x] of [
      ['object', g.object()],
      ['config', g.config()],
      ['removed', g.removed()],
    ] as const) {
      const text = rewrite({ kind, data: x, lines: {} } as ReadResult)
      let r: ReadResult
      try {
        r = read(text, `${kind}.ts`)
      } catch (e) {
        throw new Error(`seed ${seed} ${kind}: ${(e as Error).message}\n${text}`, { cause: e })
      }
      expect(r.kind, `seed ${seed}`).toBe(kind)
      expect(r.data, `seed ${seed}\n${text}`).toEqual(x)
      expect(rewrite(r), `seed ${seed}`).toBe(text)
    }
  }
})

test('fuzz: a line or paragraph separator in a comment on any export, group or property is E_NOT_DATA', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const x = gen(seed).object()
    const hs = holders(x)
    const h = hs[seed % hs.length] as (typeof hs)[number]
    h.comments = [`note${seed % 2 ? '\u{2028}' : '\u{2029}'}process.exit(1)`]
    expect(() => read(write('object', x), 'object.ts'), `seed ${seed}`).toThrow('E_NOT_DATA')
  }
})

// Runs a written file with stub builders, the way the app's bundler would, and returns what it exports as plain data.
function evaluate(text: string): { exports: unknown[]; config: unknown } {
  const body = text
    .split('\n')
    .filter((l) => !skipped.test(l))
    .join('\n')
    .replace(/^export const ([\w$]+) = /gm, 'out.$1 = ')
    .replace(defaultExport, 'return ')
  const stub: unknown = new Proxy(() => stub, { get: () => stub, apply: () => stub })
  const p = new Proxy(
    {},
    {
      get:
        (_, kind) =>
        (name: string, ...args: unknown[]) => {
          const definition = args[kind === 'json' ? 1 : 0]
          const prop = {
            kind,
            name,
            definition,
            chain: { required: false, readonly: false, managed: true },
            comments: [],
          }
          const self = {
            prop,
            required() {
              prop.chain.required = true
              return self
            },
            readonly() {
              prop.chain.readonly = true
              return self
            },
            managed(v: boolean) {
              prop.chain.managed = v
              return self
            },
          }
          return self
        },
    },
  )
  const define = (builder: string) => (object: string, fields: object) => ({ builder, object, ...fields })
  const out: Record<string, Record<string, unknown>> = {}
  const params = [
    'out',
    'p',
    'defineObject',
    'defineCustomObject',
    'defineConfig',
    'defineRemoved',
    'Meta',
    'Line',
    'z',
  ]
  const run = new Function(...params, `'use strict'\n${body}`)
  const same = (c: unknown) => c
  const config = run(out, p, define('defineObject'), define('defineCustomObject'), same, same, stub, stub, stub)
  const exports = Object.entries(out).map(([name, e]) => ({
    ...e,
    name,
    comments: [],
    groups: Object.fromEntries(
      Object.entries((e.groups ?? {}) as Record<string, object>).map(([n, g]) => [n, { name: n, ...g, comments: [] }]),
    ),
    properties: Object.fromEntries(
      Object.entries((e.properties ?? {}) as Record<string, { prop: object }>).map(([k, s]) => [
        k,
        { ...s.prop, key: k },
      ]),
    ),
  }))
  return { exports, config }
}

// The input the way evaluate returns it: groups and properties keyed, no comments, no validator source.
function asEvaluated(f: ObjectFile) {
  return f.exports.map((e) => ({
    ...e,
    comments: [],
    groups: Object.fromEntries(e.groups.map((g) => [g.name, { ...g, comments: [] }])),
    properties: Object.fromEntries(e.properties.map(({ json: _json, ...p }) => [p.key, { ...p, comments: [] }])),
  }))
}

test('fuzz: the written file evaluates to the input, so escaping holds in context and not only per literal', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const g = gen(seed)
    const x = g.object()
    expect(evaluate(write('object', x)).exports, `seed ${seed}`).toEqual(asEvaluated(x))
    const { imports: _imports, header: _header, ...c } = g.config()
    // The writer omits an empty objects or targets section; the reader fills them back in, so the check does too.
    const config = evaluate(write('config', { imports: [], header: _header, ...c })).config as object
    expect({ objects: {}, targets: {}, ...config }, `seed ${seed}`).toEqual(c)
    const removed = g.removed()
    expect(evaluate(write('removed', removed)).config, `seed ${seed}`).toEqual(removed.tombstones)
  }
})
