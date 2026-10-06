import { readFileSync } from 'node:fs'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { expect, test } from 'vitest'
import { dictionary, escapeMarkdown } from '../../src/engine/dictionary.js'
import { parseSnapshot } from '../../src/engine/snapshot.js'
import type { IR, IRObservation, IRResource, ObjectCoverage } from '../../src/ir/types.js'
import { load, project } from '../support/project.js'

function golden(name: string): string {
  return readFileSync(new URL(`../fixtures/dictionary/${name}`, import.meta.url), 'utf8')
}

// The pull fixture project's config, and the snapshot the snapshot tests pin: its read of the orchard portal.
const config = load(project('pull')).ir
const snapshotText = readFileSync(new URL('../fixtures/snapshot/orchard.json', import.meta.url), 'utf8')

type Snapshot = IR & { observation: IRObservation }

function snapshot(): Snapshot {
  return parseSnapshot(snapshotText, 'orchard.json') as Snapshot
}

function reversed<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).reverse())
}

const escapePair = /\\./gu
const markup = /[<>[\]`*_&~!\\]/u
// biome-ignore lint/suspicious/noControlCharactersInRegex: the test looks for control characters in the page
const controls = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/u
const escapedChar = /\\(.)/gu

// A line with its escapes taken out: what is left is the Markdown the page itself writes.
function unescaped(line: string): string {
  return line.replace(escapePair, '')
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`)
  const end = markdown.indexOf('\n## ', start + heading.length + 2)
  return markdown.slice(start + 1, end === -1 ? undefined : end)
}

test('the config dictionary of the pull project', () => {
  expect(dictionary(config)).toBe(golden('pull.config.md'))
})

test('the snapshot dictionary of the orchard read', () => {
  expect(dictionary(snapshot())).toBe(golden('orchard.snapshot.md'))
})

test('deterministic: two runs are byte-identical, whatever order the resources and objects come in', () => {
  expect(dictionary(config)).toBe(dictionary(config))
  expect(dictionary({ ...config, resources: reversed(config.resources) })).toBe(dictionary(config))
  const read = snapshot()
  const shuffled: Snapshot = {
    ...read,
    resources: reversed(read.resources),
    observation: {
      ...read.observation,
      coverage: { ...read.observation.coverage, objects: reversed(read.observation.coverage.objects) },
    },
  }
  expect(dictionary(shuffled)).toBe(dictionary(read))
})

test('objects come in key order even when a later key has the first address; schema sets are sorted', () => {
  const markdown = dictionary({
    ...config,
    resources: {
      'group:zeta/terms': { type: 'group', managed: true, definition: { label: 'Terms' } },
      'object:alpha': {
        type: 'object',
        managed: true,
        definition: {
          labels: { singular: 'Alpha', plural: 'Alphas' },
          requiredProperties: ['sku', 'code'],
          searchableProperties: [],
          secondaryDisplayProperties: ['sku', 'code'],
        },
      },
    },
  })
  expect(markdown.indexOf('\n## alpha\n')).toBeLessThan(markdown.indexOf('\n## zeta\n'))
  expect(section(markdown, '## alpha')).toBe(
    [
      '## alpha',
      '',
      '- Singular label: Alpha',
      '- Plural label: Alphas',
      '- Required properties: code, sku',
      '- Searchable properties: none',
      '- Secondary display properties: sku, code',
      '',
    ].join('\n'),
  )
})

test('the config coverage section says what the page describes', () => {
  expect(section(dictionary(config), '## Coverage')).toMatchInlineSnapshot(`
    "## Coverage

    Describes the config files, not a portal. A field a definition omits belongs to the portal and is not listed.
    "
  `)
})

test('an incomplete snapshot: what was not read, skipped, renamed, shadowed, out of scope, unaddressable and unsupported', () => {
  const read = snapshot()
  const { coverage } = read.observation
  const objects: Record<string, ObjectCoverage> = {
    companies: { status: 'unreadable', missingScope: 'crm.schemas.companies.read', issue: 'E_SCOPE' },
    deals: { status: 'excluded', excluded: ['object:deals'] },
    harvest: {
      status: 'read',
      objectTypeId: '2-4242001',
      outOfScope: ['hs_object_id', 'hs_pipeline'],
      unaddressable: ['crate_note'],
      shadowed: ['picked_on'],
      excluded: ['property:harvest/weight_kg'],
      renamed: { 'property:harvest/picked_on': 'pickedon' },
      unsupportedSchema: { labels: { plural: 'Harvests' } },
    },
    lots: { status: 'absent' },
    tickets: { status: 'unreadable', issue: 'E_SCOPE' },
  }
  const incomplete: Snapshot = {
    ...read,
    resources: Object.fromEntries(Object.entries(read.resources).filter(([a]) => !a.includes(':companies/'))),
    observation: { ...read.observation, coverage: { ...coverage, complete: false, objects, otherObjects: 'unknown' } },
  }
  const text = section(dictionary(incomplete), '## Coverage')
  expect(text).toBe(
    [
      '## Coverage',
      '',
      'The read was incomplete: the objects and properties it could not read are listed below, and what they hold is unknown.',
      '',
      '- Not read: companies (missing scope crm\\.schemas\\.companies\\.read), tickets.',
      '- Not in the portal: lots.',
      '- Left out by skip overrides: object\\:deals, property\\:harvest\\/weight\\_kg.',
      '- Custom objects without a singular or plural label: harvest.',
      '- Renamed by name overrides: property\\:harvest\\/picked\\_on is pickedon in the portal.',
      '- Out of scope, not captured: 2 properties on harvest.',
      '- Config properties in a portal group no address can hold, not captured: crate\\_note on harvest.',
      '- Shadowed by name overrides, not captured: 1 name on harvest.',
      '- Custom objects in the portal that config does not name: unknown, the custom object schemas list was not read.',
      '- Reference properties, HubSpot-defined or calculated, record only their options.',
      `- Fields not captured: ${notCaptured(coverage.notCaptured)}.`,
      '',
    ].join('\n'),
  )
  expect(dictionary(incomplete)).not.toContain('\n## companies\n')
})

function notCaptured(fields: Record<string, string[]>): string {
  return ['property', 'group', 'object', 'pipeline', 'stage', 'association']
    .map((type) => `${type}: ${(fields[type] ?? []).map((f) => escapeMarkdown(f)).join(', ')}`)
    .join('; ')
}

test('escapeMarkdown: no text forms a link, an autolink, HTML, emphasis, code, a heading or a table cell', () => {
  const cases: [string, string][] = [
    ['<script>alert(1)</script>', '\\<script\\>alert\\(1\\)\\<\\/script\\>'],
    ['[x](javascript:alert(1))', '\\[x\\]\\(javascript\\:alert\\(1\\)\\)'],
    ['a | b', 'a \\| b'],
    ['`rm -rf`', '\\`rm \\-rf\\`'],
    // A word joiner (U+2060) breaks what remark-gfm would still link.
    ['www.example.com', 'www\u2060\\.example\\.com'],
    ['https://example.com', 'https\u2060\\:\\/\\/example\\.com'],
    ['grower@example.com', 'grower\u2060\\@example\\.com'],
    ['*bold* _em_ ~~gone~~', '\\*bold\\* \\_em\\_ \\~\\~gone\\~\\~'],
    ['# Heading', '\\# Heading'],
    ['1. first', '1\\. first'],
    ['&lt; &#60;', '\\&lt\\; \\&\\#60\\;'],
    ['back\\slash', 'back\\\\slash'],
    ['![img](x.png)', '\\!\\[img\\]\\(x\\.png\\)'],
    ['Naročnina (mesečna) 🍎', 'Naročnina \\(mesečna\\) 🍎'],
  ]
  for (const [text, escaped] of cases) {
    expect(escapeMarkdown(text), text).toBe(escaped)
  }
  const punctuation = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
  expect(escapeMarkdown(punctuation)).toBe(Array.from(punctuation, (c) => `\\${c}`).join(''))
})

interface MarkdownNode {
  children?: MarkdownNode[]
  type: string
  url?: string
}

// Every link remark-gfm finds in `markdown`. It is the parser many Markdown sites use, this project's docs site too, and
// it links bare URLs, www names and email addresses in text after the backslash escapes are resolved.
function links(markdown: string): string[] {
  const found: string[] = []
  const walk = (node: MarkdownNode) => {
    if (node.type === 'link') {
      found.push(node.url ?? '')
    }
    for (const child of node.children ?? []) {
      walk(child)
    }
  }
  walk(unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode)
  return found
}

const autolinks = [
  'www.example.com',
  'WWW.Example.com',
  '(www.example.com)',
  'https://example.com/a?b=1',
  'HTTP://EXAMPLE.COM',
  'grower@example.com',
  'mailto:grower@example.com',
  'xmpp:grower@example.com',
  '<https://evil.example> www.evil.example a@b.example',
]

test('escapeMarkdown: remark-gfm finds no literal autolink either, in a line or a table cell', () => {
  for (const text of autolinks) {
    // Unescaped, remark-gfm links each one, so the check has teeth.
    expect(links(text), text).not.toEqual([])
    const escaped = escapeMarkdown(text)
    expect(links(`${escaped}\n`), text).toEqual([])
    expect(links(`| a |\n|---|\n| ${escaped} |\n`), text).toEqual([])
  }
})

test('escapeMarkdown: newlines become spaces and control characters go', () => {
  expect(escapeMarkdown('line one\nline two\r\nthree\rfour')).toBe('line one line two three four')
  expect(escapeMarkdown(`a${String.fromCodePoint(0x20_28)}b${String.fromCodePoint(0x20_29)}c`)).toBe('a b c')
  expect(escapeMarkdown('bell\u0007 tab\t \u001b[31mred\u001b[0m \u009b31mcsi del\u007f')).toBe(
    'bell tab red 31mcsi del',
  )
})

test('escapeMarkdown: bidirectional formatting characters go, so a label cannot reorder a docs cell', () => {
  const [rlo, rli, pdi] = [0x20_2e, 0x20_67, 0x20_69].map((code) => String.fromCodePoint(code))
  expect(escapeMarkdown(`Plot ${rlo}sgat${rli} x${pdi}`)).toBe('Plot sgat x')
})

test('escapeMarkdown: a cap counts the text, not the escapes, and ends in an ellipsis', () => {
  const long = escapeMarkdown('word '.repeat(120), 500)
  expect(Array.from(long)).toHaveLength(500)
  expect(long.endsWith('…')).toBe(true)
  expect(escapeMarkdown('.'.repeat(600), 500)).toBe(`${'\\.'.repeat(499)}…`)
  expect(escapeMarkdown('a'.repeat(500), 500)).toBe('a'.repeat(500))
})

const hostile = {
  script: '<script>alert(1)</script>',
  link: '[x](javascript:alert(1))',
  pipe: 'a | b | c',
  code: '`code` and ``more``',
  autolink: 'www.example.com',
  newline: 'first line\nsecond line',
  control: `bell\u0007 csi${String.fromCodePoint(0x9b)}31m end`,
  long: `${'Harvest notes. '.repeat(40)}`,
}

// Config with a hostile string in every place a file can put one.
function hostileConfig(): IR {
  const property = (definition: Record<string, unknown>, binding: IRResource['binding']): IRResource => ({
    type: 'property',
    managed: true,
    definition,
    binding,
    lifecycle: { options: 'additive' },
  })
  return {
    ...config,
    project: hostile.link,
    resources: {
      'group:companies/orchard': { type: 'group', managed: true, definition: { label: hostile.script } },
      'property:companies/grade': property(
        {
          label: hostile.pipe,
          group: { $ref: 'group:companies/orchard' },
          type: 'enumeration',
          fieldType: 'select',
          description: hostile.long,
          options: [
            { value: 'a|b', label: hostile.code, description: hostile.newline },
            { value: 'constructor', label: hostile.autolink, hidden: false },
            { value: '__proto__', label: hostile.control, hidden: true },
          ],
        },
        { key: 'grade', codec: 'enum', aliases: { 'a|b': hostile.script }, required: true },
      ),
      'property:companies/notes': property(
        {
          label: hostile.newline,
          group: { $ref: 'group:companies/orchard' },
          type: 'string',
          fieldType: 'textarea',
          description: hostile.control,
        },
        { key: 'notes', codec: 'string' },
      ),
    },
  }
}

test('hostile labels and descriptions stay inside their cells: every row has its columns and no raw markup', () => {
  const markdown = dictionary(hostileConfig())
  const lines = markdown.split('\n')
  expect(lines[0]).toBe('# \\[x\\]\\(javascript\\:alert\\(1\\)\\) data dictionary')
  for (const line of lines.filter((l) => l.startsWith('|'))) {
    const pipes = unescaped(line).split('|').length - 1
    expect([3, 6, 11], line).toContain(pipes)
  }
  for (const line of lines) {
    expect(unescaped(line), line).not.toMatch(markup)
  }
  expect(markdown).not.toMatch(controls)
  expect(markdown).toContain('| \\<script\\>alert\\(1\\)\\<\\/script\\> |')
  expect(markdown).toContain('first line second line')
  expect(markdown).toContain('bell csi31m end')
})

test('a dictionary of config or of a snapshot whose labels hold URLs and email addresses holds no link', () => {
  const ir = hostileConfig()
  ir.resources['group:companies/orchard'] = { type: 'group', managed: true, definition: { label: autolinks.join(' ') } }
  expect(links(dictionary(ir))).toEqual([])
  const read = snapshot()
  const group = read.resources['group:companies/plots']
  if (group?.definition) {
    group.definition.label = autolinks.join(' ')
  }
  expect(dictionary(read)).toContain('www')
  expect(links(dictionary(read))).toEqual([])
})

test('descriptions are capped at 500 characters with an ellipsis; labels are not', () => {
  const markdown = dictionary(hostileConfig())
  const row = markdown.split('\n').find((l) => l.startsWith('| grade |')) ?? ''
  const description = row.slice(row.lastIndexOf(' | ') + 3, -2)
  expect(Array.from(description.replace(escapedChar, '$1'))).toHaveLength(500)
  expect(description.endsWith('…')).toBe(true)
})

test('config options: the alias column, hidden only where the file states it, and no inherited alias', () => {
  const markdown = dictionary(hostileConfig())
  expect(section(markdown, '#### Options of grade')).toContain(
    [
      '| Value | Alias | Label | Hidden | Description |',
      '| --- | --- | --- | --- | --- |',
      '| a\\|b | \\<script\\>alert\\(1\\)\\<\\/script\\> | \\`code\\` and \\`\\`more\\`\\` |  | first line second line |',
      '| constructor |  | www\u2060\\.example\\.com | no |  |',
      '| \\_\\_proto\\_\\_ |  | bell csi31m end | yes |  |',
    ].join('\n'),
  )
})

test('config properties: key, codec and required beside the HubSpot fields', () => {
  const markdown = dictionary(hostileConfig())
  expect(markdown).toContain(
    '| Internal name | Key | Label | Type | Field type | Group | Managed or reference | Codec | Required | Description |',
  )
  expect(markdown).toContain(
    '| notes | notes | first line second line | string | textarea | orchard | managed | string | no | bell csi31m end |',
  )
})

test('snapshot options: hidden and description take the portal defaults when HubSpot left them out', () => {
  const markdown = dictionary(snapshot())
  expect(section(markdown, '#### Options of yield\\_tier')).toContain(
    [
      '| Value | Label | Hidden | Description |',
      '| --- | --- | --- | --- |',
      '| low | Low | no |  |',
      '| HIGH | High | no |  |',
      '| peak | Peak | yes |  |',
    ].join('\n'),
  )
})

test('an unreadable object has no section of its own; the others keep theirs', () => {
  const read = snapshot()
  const markdown = dictionary({
    ...read,
    resources: Object.fromEntries(Object.entries(read.resources).filter(([a]) => !a.includes(':harvest'))),
    observation: {
      ...read.observation,
      coverage: {
        ...read.observation.coverage,
        complete: false,
        objects: {
          ...read.observation.coverage.objects,
          harvest: { status: 'unreadable', missingScope: 'crm.schemas.custom.read', issue: 'E_SCOPE' },
        },
      },
    },
  })
  expect(markdown).toContain('\n## companies\n')
  expect(markdown).not.toContain('\n## harvest\n')
  expect(markdown).toContain('harvest (missing scope crm\\.schemas\\.custom\\.read)')
})

test('definition overrides: one row per address, field and target, sorted, after the shared definitions', () => {
  const targets: IR['targets'] = {
    'acme-us': {
      portalId: 5_151_515,
      overrides: {
        'property:companies/yield_tier': { definition: { label: 'Yield grade' } },
        'property:companies/plot_total': { name: 'plot_sum' },
      },
    },
    'acme-eu': {
      portalId: 4_141_414,
      overrides: {
        'property:companies/yield_tier': {
          definition: {
            options: [
              { value: 'low', label: 'Low' },
              { value: 'peak', label: 'Peak [EU]' },
            ],
            description: '',
            formField: false,
            label: 'Yield band',
            lifecycle: { removedOptions: [], options: 'exact' },
          },
        },
        'group:companies/orchard': { definition: { label: 'Orchard (EU)' } },
        // A skip wins, so nothing of this override applies.
        'property:companies/plot_tags': { skip: true, definition: { label: 'Tags' } },
      },
    },
  }
  const markdown = dictionary({ ...config, targets })
  expect(markdown.endsWith(section(markdown, '## Per-target overrides'))).toBe(true)
  expect(section(markdown, '## Per-target overrides')).toBe(
    [
      '## Per-target overrides',
      '',
      'Each field a target states here replaces the shared definition above on that target, options as a whole list.',
      '',
      '| Address | Field | Target | Value |',
      '| --- | --- | --- | --- |',
      '| group\\:companies\\/orchard | label | acme\\-eu | Orchard \\(EU\\) |',
      '| property\\:companies\\/yield\\_tier | label | acme\\-eu | Yield band |',
      '| property\\:companies\\/yield\\_tier | label | acme\\-us | Yield grade |',
      '| property\\:companies\\/yield\\_tier | description | acme\\-eu | (empty) |',
      '| property\\:companies\\/yield\\_tier | formField | acme\\-eu | no |',
      '| property\\:companies\\/yield\\_tier | options | acme\\-eu | Low (low), Peak \\[EU\\] (peak) |',
      '| property\\:companies\\/yield\\_tier | lifecycle.options | acme\\-eu | exact |',
      '| property\\:companies\\/yield\\_tier | lifecycle.removedOptions | acme\\-eu | (none) |',
      '',
    ].join('\n'),
  )
  // Deterministic whatever order the targets and their overrides come in.
  const reversedTargets = Object.fromEntries(
    Object.entries(targets)
      .reverse()
      .map(([name, t]) => [name, { ...t, overrides: reversed(t.overrides ?? {}) }]),
  )
  expect(dictionary({ ...config, targets: reversedTargets })).toBe(markdown)
  // No definition override, no section: the pull project's page is its golden.
  expect(dictionary(config)).not.toContain('## Per-target overrides')
})

test('a snapshot a later version took: its later types are left out and named', () => {
  const read = snapshot()
  const later = {
    ...read,
    resources: { ...read.resources, 'list:renewals_due': { type: 'list', managed: true, definition: { name: 'Due' } } },
  }
  const page = dictionary(later)
  expect(page).toContain('Not described here: list resources, which a later version of kalup handles.')
  expect(page).not.toContain('renewals')
  expect(page.replace('\nNot described here: list resources, which a later version of kalup handles.\n', '')).toBe(
    dictionary(read),
  )
})
