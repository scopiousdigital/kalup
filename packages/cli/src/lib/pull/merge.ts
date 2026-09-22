// The re-pull merge with no base: the portal wins for what HubSpot owns, the file wins for what HubSpot cannot know.
// Pure: one object's export in, the merged export and the report out.
import {
  DEFAULTS,
  type Definition,
  HUBSPOT_TYPES,
  type Issue,
  type ObjectExport,
  type Option,
  type Property,
} from '@kalup/core'
import { sanitize } from '../sanitize.js'
import { camelCase } from './keys.js'
import type { LiveObject, LiveProperty } from './normalize.js'
import { inScope, type Scope } from './scope.js'

export interface Change {
  /** `local-only` and `out-of-scope` are notes; the other three decide the resource's count. */
  kind: 'added' | 'changed' | 'missing' | 'local-only' | 'out-of-scope'
  address: string
  /** `label`, `options[value].label`, ... when the change is one field of the resource. */
  field?: string
  before?: unknown
  after?: unknown
}

export interface Counts {
  added: number
  changed: number
  unchanged: number
  missing: number
}

export interface MergeInput {
  live: LiveObject
  scope: Scope
  /** The export that holds this object today, or none on a first pull. */
  local?: ObjectExport
  /** The name and builder of the export when there is none yet. */
  fresh: { name: string; builder: ObjectExport['builder'] }
  /** The --only filter over addresses. */
  only: (address: string) => boolean
}

export interface Merged {
  export: ObjectExport
  counts: Counts
  changes: Change[]
  issues: Issue[]
}

const HUBSPOT_FIELDS = ['label', 'group', 'fieldType', 'description', 'hasUniqueValue', 'formField'] as const
const OPTION_FIELDS = ['label', 'hidden', 'description'] as const
const CUSTOM_FIELDS = [
  'labels',
  'primaryDisplayProperty',
  'requiredProperties',
  'searchableProperties',
  'secondaryDisplayProperties',
] as const

export function mergeObject(input: MergeInput): Merged {
  const { live, scope, local, only } = input
  const object = live.object
  const counts: Counts = { added: 0, changed: 0, unchanged: 0, missing: 0 }
  const changes: Change[] = []
  const issues: Issue[] = []
  const next: ObjectExport = local
    ? { ...local, groups: [], properties: [] }
    : { name: input.fresh.name, builder: input.fresh.builder, object, comments: [], groups: [], properties: [] }

  const note = (change: Change) => changes.push(scrub(change))
  const added = (address: string) => {
    counts.added++
    note({ kind: 'added', address })
  }
  const missing = (address: string) => {
    counts.missing++
    note({ kind: 'missing', address })
  }
  // A resource with a field change is changed; one with only local-only notes is unchanged.
  const settle = (fields: Change[]) => {
    if (fields.some((c) => c.kind !== 'local-only')) counts.changed++
    else counts.unchanged++
    for (const change of fields) note(change)
  }

  const objectAddress = `object:${object}`
  if (live.custom && next.builder === 'defineCustomObject' && only(objectAddress)) {
    const fields: Change[] = []
    for (const field of CUSTOM_FIELDS) {
      const before = list(next[field])
      const after = list(live.custom[field])
      if (!same(before, after)) fields.push({ kind: 'changed', address: objectAddress, field, before, after })
      Object.assign(next, { [field]: after })
    }
    if (local) settle(fields)
    else added(objectAddress)
  }

  const liveByName = new Map(live.properties.map((p) => [p.name, p]))
  const seen = new Set<string>()
  for (const p of local?.properties ?? []) {
    const address = `property:${object}/${p.name}`
    seen.add(p.name)
    const l = liveByName.get(p.name)
    if (!only(address)) {
      next.properties.push(p)
    } else if (!l) {
      next.properties.push(p)
      missing(address)
    } else if (!inScope(scope, l)) {
      next.properties.push(p)
      note({ kind: 'out-of-scope', address })
    } else {
      const fields: Change[] = []
      next.properties.push(mergeProperty(p, l, address, fields, issues))
      settle(fields)
    }
  }
  for (const l of [...live.properties].sort((a, b) => cmp(a.name, b.name))) {
    const address = `property:${object}/${l.name}`
    if (seen.has(l.name) || !inScope(scope, l) || !only(address)) continue
    next.properties.push(newProperty(l, next.properties, address, issues))
    added(address)
  }

  // Every group a managed property references is written, whatever --only says, so the file stays valid.
  const needed = new Set<string>()
  for (const p of next.properties) if (p.definition?.group !== undefined) needed.add(p.definition.group)
  for (const g of local?.groups ?? []) {
    const address = `group:${object}/${g.name}`
    needed.delete(g.name)
    const label = live.groups.get(g.name)
    if (!only(address)) {
      next.groups.push(g)
    } else if (label === undefined) {
      next.groups.push(g)
      missing(address)
    } else {
      next.groups.push({ ...g, label })
      settle(label === g.label ? [] : [{ kind: 'changed', address, field: 'label', before: g.label, after: label }])
    }
  }
  for (const name of [...needed].sort(cmp)) {
    next.groups.push({ name, label: live.groups.get(name) ?? name, comments: [] })
    added(`group:${object}/${name}`)
  }

  return { export: next, counts, changes, issues }
}

// Key, kind, chain, json source and comments come from the file. Everything in the definition that HubSpot owns comes
// from the portal; `as` per option value and lifecycle stay. A property whose kind conflicts with the portal type is
// left as written, because the portal's fieldType and options would not validate against the file's builder.
function mergeProperty(p: Property, l: LiveProperty, address: string, fields: Change[], issues: Issue[]): Property {
  if (HUBSPOT_TYPES[p.kind] !== l.type) {
    issues.push({
      code: 'W_CODEC_MISMATCH',
      message: `${sanitize(address)} is p.${p.kind} in the file but type ${sanitize(l.type)} in the portal; the file keeps p.${p.kind} and nothing is refreshed`,
      fix: 'change the builder to match the portal type, or keep it if the app relies on it',
    })
    return p
  }
  const mine = p.definition ?? {}
  const managed = mine.label !== undefined && mine.group !== undefined && mine.fieldType !== undefined
  // Nothing owns a .managed(false) definition, and a reference cannot carry one, so it stays as written.
  if (l.reference && !p.chain.managed) return p
  if (l.reference) {
    if (managed) fields.push({ kind: 'changed', address, field: 'definition', before: 'managed', after: 'reference' })
    const options = mergeOptions(mine.options, l.definition?.options, address, fields)
    return {
      ...p,
      chain: { ...p.chain, managed: true },
      definition: options
        ? { options: options.map((o) => compact({ value: o.value, label: o.label, as: o.as })) }
        : undefined,
    }
  }
  if (!managed) fields.push({ kind: 'changed', address, field: 'definition', before: 'reference', after: 'managed' })
  const theirs = l.definition ?? {}
  for (const field of HUBSPOT_FIELDS) {
    const before = own(mine[field], DEFAULTS.definition[field])
    const after = theirs[field]
    if (before !== after) fields.push({ kind: 'changed', address, field, before, after })
  }
  const definition: Definition = compact({
    ...theirs,
    options: mergeOptions(mine.options, theirs.options, address, fields),
    lifecycle: mine.lifecycle,
  })
  return { ...p, definition }
}

// Options are keyed by value. A member in both takes the portal's label, hidden and description and keeps the local
// `as`; members follow portal order. A portal-only member is added. A local-only member is kept and noted.
function mergeOptions(
  local: Option[] | undefined,
  live: Option[] | undefined,
  address: string,
  fields: Change[],
): Option[] | undefined {
  const mine = new Map((local ?? []).map((o) => [o.value, o]))
  const out: Option[] = []
  for (const o of live ?? []) {
    const m = mine.get(o.value)
    const at = `options[${o.value}]`
    if (!m) fields.push({ kind: 'added', address, field: at })
    else {
      for (const field of OPTION_FIELDS) {
        const before = own(m[field], DEFAULTS.option[field])
        if (before !== o[field])
          fields.push({ kind: 'changed', address, field: `${at}.${field}`, before, after: o[field] })
      }
    }
    out.push(compact({ value: o.value, label: o.label, as: m?.as, hidden: o.hidden, description: o.description }))
  }
  for (const m of local ?? []) {
    if (live?.some((o) => o.value === m.value)) continue
    out.push(m)
    fields.push({ kind: 'local-only', address, field: `options[${m.value}]` })
  }
  return out.length ? out : undefined
}

// The default key is camelCase of the internal name. When that key is taken, the internal name is the key.
function newProperty(l: LiveProperty, existing: Property[], address: string, issues: Issue[]): Property {
  const wanted = camelCase(l.name)
  const taken = existing.some((p) => p.key === wanted)
  if (taken) {
    issues.push({
      code: 'W_KEY_COLLISION',
      message: `${sanitize(address)}: the key ${sanitize(wanted)} is taken, so its internal name is the key`,
      fix: 'rename one of the two keys',
    })
  }
  return {
    key: taken ? l.name : wanted,
    kind: l.kind,
    name: l.name,
    definition: l.definition,
    chain: { required: false, readonly: l.calculated, managed: true },
    comments: [],
  }
}

function own<T>(value: T | undefined, dflt: unknown): T | undefined {
  return value === dflt ? undefined : value
}

function list<T>(value: T | undefined): T | undefined {
  return Array.isArray(value) && value.length === 0 ? undefined : value
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Portal strings are untrusted, so every string in a change line is sanitized before it reaches any output.
function scrub(change: Change): Change {
  return compact({
    ...change,
    address: sanitize(change.address),
    field: change.field === undefined ? undefined : sanitize(change.field),
    before: clean(change.before),
    after: clean(change.after),
  })
}

function clean(value: unknown): unknown {
  if (typeof value === 'string') return sanitize(value)
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [sanitize(k), clean(v)]))
  }
  return value
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
