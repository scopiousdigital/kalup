// Portal JSON to the grammar's shapes. Pure, so the API fixtures under test/fixtures/api test it offline.
import { type BuilderKind, type Definition, FIELD_TYPES, type Issue, type Option } from '@kalup/core'
import { sanitize } from '../sanitize.js'

/** The fields pull reads from GET /crm/properties/2026-09/{objectType}. */
export interface RawProperty {
  archived?: boolean
  calculated?: boolean
  description?: string
  fieldType: string
  formField?: boolean
  groupName: string
  hasUniqueValue?: boolean
  hubspotDefined?: boolean
  label: string
  name: string
  options?: RawOption[]
  type: string
}

export interface RawOption {
  description?: string
  displayOrder?: number
  hidden?: boolean
  label: string
  value: string
}

/** The fields pull reads from GET /crm/properties/2026-09/{objectType}/groups. */
export interface RawGroup {
  archived?: boolean
  label: string
  name: string
}

/** The fields pull reads from GET /crm-object-schemas/2026-09/schemas. */
export interface RawSchema {
  archived?: boolean
  labels: { singular: string; plural: string }
  name: string
  objectTypeId: string
  primaryDisplayProperty?: string
  requiredProperties?: string[]
  searchableProperties?: string[]
  secondaryDisplayProperties?: string[]
}

export interface LiveProperty {
  calculated: boolean
  /** The full definition of a managed property, the options of an enum reference, nothing for another reference. */
  definition?: Definition
  hubspotDefined: boolean
  kind: BuilderKind
  name: string
  /** HubSpot-defined or calculated: never created, changed or removed. */
  reference: boolean
  /** HubSpot's `type`, for the codec conflict warning. */
  type: string
}

export type LiveCustom = Pick<
  RawSchema,
  'labels' | 'primaryDisplayProperty' | 'requiredProperties' | 'searchableProperties' | 'secondaryDisplayProperties'
>

export interface LiveObject {
  custom?: LiveCustom
  /** Unarchived groups, name to label. */
  groups: Map<string, string>
  /** The config key. */
  object: string
  /** Unarchived properties with a builder, in portal order. */
  properties: LiveProperty[]
}

const KINDS: Record<string, BuilderKind> = {
  string: 'string',
  number: 'number',
  bool: 'boolean',
  date: 'date',
  datetime: 'datetime',
}

function kindOf(type: string, fieldType: string): BuilderKind | undefined {
  if (type === 'enumeration') {
    return fieldType === 'checkbox' ? 'multiEnum' : 'enum'
  }
  return KINDS[type]
}

/**
 * Live properties in portal order. Archived properties are skipped. A property whose type no builder carries
 * (object_coordinates, json, anything unknown), or whose fieldType no builder accepts, is skipped with one warning.
 */
export function normalizeProperties(object: string, raw: RawProperty[], issues: Issue[]): LiveProperty[] {
  const out: LiveProperty[] = []
  for (const p of raw) {
    if (p.archived) {
      continue
    }
    const reference = Boolean(p.hubspotDefined || p.calculated)
    const kind = kindOf(p.type, p.fieldType)
    if (kind === undefined || !(reference || FIELD_TYPES[kind].includes(p.fieldType))) {
      issues.push({
        code: 'W_UNSUPPORTED_TYPE',
        message: `property:${object}/${sanitize(p.name)} has type ${sanitize(p.type)} and fieldType ${sanitize(p.fieldType)}, which no builder carries; skipped`,
      })
      continue
    }
    const options = kind === 'enum' || kind === 'multiEnum' ? normalizeOptions(p.options ?? []) : undefined
    out.push({
      name: p.name,
      hubspotDefined: Boolean(p.hubspotDefined),
      type: p.type,
      kind,
      reference,
      calculated: Boolean(p.calculated),
      definition: definitionOf(p, reference, options),
    })
  }
  return out
}

// The full definition of a managed property, the options of an enum reference, nothing for another reference.
function definitionOf(p: RawProperty, reference: boolean, options: Option[] | undefined): Definition | undefined {
  if (!reference) {
    return compact({
      label: p.label,
      group: p.groupName,
      fieldType: p.fieldType,
      description: p.description || undefined,
      options: options?.length ? options : undefined,
      hasUniqueValue: p.hasUniqueValue || undefined,
      formField: p.formField || undefined,
    })
  }
  if (options?.length) {
    return { options: options.map((o) => ({ value: o.value, label: o.label })) }
  }
  return undefined
}

// Display order: lowest positive first, -1 (or none) after any positive value, ties in portal order.
function normalizeOptions(raw: RawOption[]): Option[] {
  const order = (o: RawOption) =>
    o.displayOrder === undefined || o.displayOrder < 0 ? Number.MAX_SAFE_INTEGER : o.displayOrder
  return [...raw]
    .sort((a, b) => order(a) - order(b))
    .map((o) =>
      compact({
        value: o.value,
        label: o.label,
        hidden: o.hidden || undefined,
        description: o.description || undefined,
      }),
    )
}

export function normalizeGroups(raw: RawGroup[]): Map<string, string> {
  return new Map(raw.filter((g) => !g.archived).map((g) => [g.name, g.label]))
}

/** The schema fields the object file carries. Empty lists are left out, so the writer omits them. */
export function normalizeSchema(schema: RawSchema): LiveCustom {
  const list = (v: string[] | undefined) => (v?.length ? v : undefined)
  return compact({
    labels: { singular: schema.labels.singular, plural: schema.labels.plural },
    primaryDisplayProperty: schema.primaryDisplayProperty,
    requiredProperties: list(schema.requiredProperties),
    searchableProperties: list(schema.searchableProperties),
    secondaryDisplayProperties: list(schema.secondaryDisplayProperties),
  })
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
