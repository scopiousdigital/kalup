// The data dictionary: a Markdown page describing the config files or a snapshot. Every string a file or a portal
// supplies passes through escapeMarkdown, so none can form a link, HTML, emphasis, code, a heading or a table cell.
// Deterministic: objects, groups and properties sorted by code unit, options in display order, and no timestamp but a
// snapshot's own observedAt.
import { byCodeUnit, type Coverage, type IR, type IROption, type IRResource, parseAddress, type Ref } from '@kalup/core'
import { sanitize } from '../lib/sanitize.js'
import { nameOf, objectOf } from './units.js'

interface ObjectResources {
  groups: [string, IRResource][]
  object?: IRResource
  properties: [string, IRResource][]
}

const DESCRIPTION_MAX = 500
const NEWLINES = /\r\n|[\n\r\u2028\u2029]/g
const PUNCTUATION = /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g
// remark-gfm links a bare URL, www name or email address after it resolves the escapes, so a word joiner (U+2060)
// breaks each trigger: between www and the dot, between http or https and ://, and before an @ that joins an address.
const AUTOLINK = /(?<=www)(?=\.)|(?<=https?)(?=:\/\/)|(?<=[-+.\w])(?=@[-\w])/giu
const WORD_JOINER = '\u2060'

const CONFIG_COVERAGE =
  'Describes the config files, not a portal. A field a definition omits belongs to the portal and is not listed.'
const COMPLETE = 'The read was complete: every object in scope was read.'
const INCOMPLETE =
  'The read was incomplete: the objects and properties it could not read are listed below, and what they hold is unknown.'

const OVERRIDES =
  'Each field a target states here replaces the shared definition above on that target, options as a whole list.'
const OVERRIDE_COLUMNS = ['Address', 'Field', 'Target', 'Value']
// The fields a definition override may state, in the order a row lists them.
const OVERRIDE_FIELDS = ['label', 'description', 'group', 'fieldType', 'formField', 'options']
const LIFECYCLE_FIELDS = ['options', 'removedOptions', 'ignoreChanges']

const GROUP_COLUMNS = ['Internal name', 'Label']
const PROPERTY_COLUMNS = {
  config: ['Internal name', 'Key', 'Label', 'Type', 'Field type', 'Group', 'Managed or reference', 'Codec', 'Required'],
  snapshot: ['Internal name', 'Label', 'Type', 'Field type', 'Group', 'Managed or reference'],
}
const OPTION_COLUMNS = { config: ['Value', 'Alias', 'Label', 'Hidden'], snapshot: ['Value', 'Label', 'Hidden'] }

/**
 * The page for a config IR, or for a snapshot with the coverage of its read. A config definition lists only the fields
 * it states; a snapshot fills HubSpot's defaults for what the portal left out.
 */
export function dictionary(ir: IR): string {
  const { observation } = ir
  const source = observation
    ? `Source: a snapshot of target ${escapeMarkdown(observation.target.name)}, portal ${observation.target.portalId}, observed at ${escapeMarkdown(observation.observedAt)}.`
    : 'Source: the config files.'
  const lines = [`# ${escapeMarkdown(ir.project)} data dictionary`, '', source, '', '## Coverage', '']
  lines.push(...(observation ? coverageLines(observation.coverage) : [CONFIG_COVERAGE]))
  for (const [key, resources] of byObject(ir.resources)) {
    lines.push('', ...objectLines(key, resources, observation === undefined))
  }
  if (!observation) {
    lines.push(...overrideLines(ir.targets))
  }
  return `${lines.join('\n')}\n`
}

/**
 * Text from a file or a portal, shown literally in Markdown: newlines become spaces, control characters go, a word
 * joiner breaks what GFM would link as a bare URL or email address, and every ASCII punctuation character is
 * backslash-escaped. `max` caps the text before it is escaped, with an ellipsis.
 */
export function escapeMarkdown(text: string, max = Number.POSITIVE_INFINITY): string {
  return sanitize(text.replace(NEWLINES, ' '), max).replace(AUTOLINK, WORD_JOINER).replace(PUNCTUATION, '\\$&')
}

function coverageLines(coverage: Coverage): string[] {
  const objects = Object.entries(coverage.objects).sort(([a], [b]) => byCodeUnit(a, b))
  const md = (value: string) => escapeMarkdown(value)
  const facts: [string, string[], string][] = [
    [
      'Not read',
      objects
        .filter(([, o]) => o.status === 'unreadable')
        .map(([k, o]) => (o.missingScope === undefined ? md(k) : `${md(k)} (missing scope ${md(o.missingScope)})`)),
      ', ',
    ],
    ['Not in the portal', objects.filter(([, o]) => o.status === 'absent').map(([k]) => md(k)), ', '],
    [
      'Left out by skip overrides',
      objects
        .flatMap(([, o]) => o.excluded ?? [])
        .sort(byCodeUnit)
        .map(md),
      ', ',
    ],
    [
      'Unsupported properties, which no builder carries',
      objects.flatMap(([k, o]) =>
        (o.unsupported ?? []).map(
          (u) => `${md(u.name)} on ${md(k)} (type ${md(u.type)}, field type ${md(u.fieldType)})`,
        ),
      ),
      '; ',
    ],
    [
      'Custom objects without a singular or plural label',
      objects.filter(([, o]) => o.unsupportedSchema).map(([k]) => md(k)),
      ', ',
    ],
    [
      'Renamed by name overrides',
      objects
        .flatMap(([, o]) => Object.entries(o.renamed ?? {}))
        .sort(([a], [b]) => byCodeUnit(a, b))
        .map(([address, name]) => `${md(address)} is ${md(name)} in the portal`),
      ', ',
    ],
    [
      'Out of scope, not captured',
      objects.flatMap(([k, o]) =>
        o.outOfScope ? [`${count(o.outOfScope.length, 'property', 'properties')} on ${md(k)}`] : [],
      ),
      ', ',
    ],
    [
      'Config properties in a portal group no address can hold, not captured',
      objects.flatMap(([k, o]) => (o.unaddressable ?? []).map((name) => `${md(name)} on ${md(k)}`)),
      ', ',
    ],
    [
      'Shadowed by name overrides, not captured',
      objects.flatMap(([k, o]) => (o.shadowed ? [`${count(o.shadowed.length, 'name', 'names')} on ${md(k)}`] : [])),
      ', ',
    ],
  ]
  const { otherObjects, notCaptured } = coverage
  const others =
    otherObjects === 'unknown'
      ? 'unknown, the custom object schemas list was not read'
      : listOr([...otherObjects].sort(byCodeUnit).map(md))
  const fields = (['property', 'group', 'object'] as const)
    .map((type) => `${type}: ${[...notCaptured[type]].sort(byCodeUnit).map(md).join(', ')}`)
    .join('; ')
  return [
    coverage.complete ? COMPLETE : INCOMPLETE,
    '',
    ...facts.filter(([, items]) => items.length > 0).map(([label, items, glue]) => `- ${label}: ${items.join(glue)}.`),
    `- Custom objects in the portal that config does not name: ${others}.`,
    '- Reference properties, HubSpot-defined or calculated, record only their options.',
    `- Fields not captured: ${fields}.`,
  ]
}

// Resources grouped under their object key, keys sorted. A Map, so a key such as __proto__ is an ordinary key.
function byObject(resources: Record<string, IRResource>): [string, ObjectResources][] {
  const objects = new Map<string, ObjectResources>()
  for (const address of Object.keys(resources).sort(byCodeUnit)) {
    const { type } = parseAddress(address)
    const key = objectOf(address)
    const entry = objects.get(key) ?? { groups: [], properties: [] }
    objects.set(key, entry)
    const resource = resources[address] as IRResource
    if (type === 'object') {
      entry.object = resource
    } else if (type === 'group') {
      entry.groups.push([nameOf(address), resource])
    } else if (type === 'property') {
      entry.properties.push([nameOf(address), resource])
    }
  }
  return [...objects].sort(([a], [b]) => byCodeUnit(a, b))
}

function objectLines(key: string, { object, groups, properties }: ObjectResources, config: boolean): string[] {
  const lines = [`## ${escapeMarkdown(key)}`]
  if (object?.definition) {
    lines.push('', ...schemaLines(object.definition))
  }
  if (groups.length > 0) {
    const rows = groups.map(([name, g]) => [escapeMarkdown(name), escapeMarkdown(stringOf(g.definition?.label))])
    lines.push('', '### Groups', '', ...table(GROUP_COLUMNS, rows))
  }
  if (properties.length > 0) {
    const columns = [...PROPERTY_COLUMNS[config ? 'config' : 'snapshot'], 'Description']
    lines.push(
      '',
      '### Properties',
      '',
      ...table(
        columns,
        properties.map(([name, p]) => propertyRow(name, p, config)),
      ),
    )
  }
  for (const [name, p] of properties) {
    const options = p.definition?.options as IROption[] | undefined
    if (options && options.length > 0) {
      const columns = [...OPTION_COLUMNS[config ? 'config' : 'snapshot'], 'Description']
      const rows = options.map((o) => optionRow(o, p.binding?.aliases, config))
      lines.push('', `#### Options of ${escapeMarkdown(name)}`, '', ...table(columns, rows))
    }
  }
  return lines
}

// A custom object's own definition: only the fields it holds. Required and searchable properties are sets.
function schemaLines(definition: Record<string, unknown>): string[] {
  const labels = (definition.labels ?? {}) as { plural?: string; singular?: string }
  const names = (value: unknown, sort: boolean) => {
    if (!Array.isArray(value)) {
      return undefined
    }
    const list = (sort ? [...value].sort(byCodeUnit) : value).map((v) => escapeMarkdown(String(v)))
    return list.length > 0 ? list.join(', ') : 'none'
  }
  const facts: [string, string | undefined][] = [
    ['Singular label', labels.singular === undefined ? undefined : escapeMarkdown(labels.singular)],
    ['Plural label', labels.plural === undefined ? undefined : escapeMarkdown(labels.plural)],
    [
      'Primary display property',
      definition.primaryDisplayProperty === undefined
        ? undefined
        : escapeMarkdown(stringOf(definition.primaryDisplayProperty)),
    ],
    ['Required properties', names(definition.requiredProperties, true)],
    ['Searchable properties', names(definition.searchableProperties, true)],
    ['Secondary display properties', names(definition.secondaryDisplayProperties, false)],
  ]
  return facts.flatMap(([label, value]) => (value === undefined ? [] : [`- ${label}: ${value}`]))
}

function propertyRow(name: string, p: IRResource, config: boolean): string[] {
  const d = p.definition ?? {}
  const group = (d.group as Ref | undefined)?.$ref ?? ''
  const binding = p.binding ?? {}
  return [
    escapeMarkdown(name),
    ...(config ? [escapeMarkdown(binding.key ?? '')] : []),
    escapeMarkdown(stringOf(d.label)),
    escapeMarkdown(stringOf(d.type)),
    escapeMarkdown(stringOf(d.fieldType)),
    escapeMarkdown(group.slice(group.indexOf('/') + 1)),
    p.managed ? 'managed' : 'reference',
    ...(config ? [escapeMarkdown(binding.codec ?? ''), binding.required ? 'yes' : 'no'] : []),
    escapeMarkdown(stringOf(d.description), DESCRIPTION_MAX),
  ]
}

// Aliases are looked up as own keys: an option value such as constructor must not find Object.prototype.
function optionRow(o: IROption, aliases: Record<string, string> | undefined, config: boolean): string[] {
  const alias = aliases && Object.hasOwn(aliases, o.value) ? aliases[o.value] : undefined
  return [
    escapeMarkdown(o.value),
    ...(config ? [escapeMarkdown(alias ?? '')] : []),
    escapeMarkdown(o.label),
    hidden(o.hidden, config),
    escapeMarkdown(o.description ?? '', DESCRIPTION_MAX),
  ]
}

// Config leaves an unstated flag to the portal; a snapshot's missing flag is HubSpot's default, false.
function hidden(value: boolean | undefined, config: boolean): string {
  if (value === undefined) {
    return config ? '' : 'no'
  }
  return value ? 'yes' : 'no'
}

// The targets' definition overrides, one row per address, field and target, in that order; none, no section. A skip
// wins, so a skipped address's definition is not listed.
function overrideLines(targets: IR['targets']): string[] {
  const rows: { address: string; field: number; name: string; target: string; value: string }[] = []
  for (const [target, { overrides = {} }] of Object.entries(targets)) {
    for (const [address, override] of Object.entries(overrides)) {
      const d = override.skip === true ? {} : (override.definition ?? {})
      const lifecycle = (d.lifecycle ?? {}) as Record<string, unknown>
      const stated = [
        ...OVERRIDE_FIELDS.map((name) => [name, d[name]] as const),
        ...LIFECYCLE_FIELDS.map((name) => [`lifecycle.${name}`, lifecycle[name]] as const),
      ]
      for (const [field, [name, value]] of stated.entries()) {
        if (value !== undefined) {
          rows.push({ address, field, name, target, value: overrideValue(value) })
        }
      }
    }
  }
  if (rows.length === 0) {
    return []
  }
  rows.sort((a, b) => byCodeUnit(a.address, b.address) || a.field - b.field || byCodeUnit(a.target, b.target))
  const cells = rows.map((r) => [escapeMarkdown(r.address), r.name, escapeMarkdown(r.target), r.value])
  return ['', '## Per-target overrides', '', OVERRIDES, '', ...table(OVERRIDE_COLUMNS, cells)]
}

// An override value as a cell: text as written, (empty) for an empty string, an option as its label and value.
function overrideValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (typeof item === 'string') {
        return escapeMarkdown(item)
      }
      const option = item as { label: string; value: string }
      return `${escapeMarkdown(option.label)} (${escapeMarkdown(option.value)})`
    })
    return items.length > 0 ? items.join(', ') : '(none)'
  }
  const text = String(value)
  return text === '' ? '(empty)' : escapeMarkdown(text, DESCRIPTION_MAX)
}

function table(columns: string[], rows: string[][]): string[] {
  return [row(columns), row(columns.map(() => '---')), ...rows.map(row)]
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function listOr(items: string[]): string {
  return items.length > 0 ? items.join(', ') : 'none'
}
