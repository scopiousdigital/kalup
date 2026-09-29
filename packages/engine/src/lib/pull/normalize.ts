// Portal JSON to the grammar's shapes. Pure, so the API fixtures under test/fixtures/api test it offline.
import type { Definition } from '@kalup/core'
import type { BuilderKind, Option } from '../../grammar/types.js'
import type { Issue } from '../../ir/types.js'
import { byCodeUnit } from '../../loader/load.js'
import { FIELD_TYPES } from '../../loader/tables.js'
import { sanitize } from '../sanitize.js'

/**
 * A portal resource a name override shadows belongs to no address. Where another resource refers to it (a property's
 * group, a name in a custom object schema), the read records `shadowed:<name>`, which no HubSpot internal name and so
 * no config name equals.
 */
export const SHADOWED = 'shadowed:'

/** The fields pull reads from GET /crm/properties/2026-09/{objectType}. */
export interface RawProperty {
  archived?: boolean
  archivedAt?: string
  calculated?: boolean
  createdAt?: string
  description?: string
  fieldType: string
  formField?: boolean
  groupName: string
  hasUniqueValue?: boolean
  hubspotDefined?: boolean
  label: string
  modificationMetadata?: { archivable?: boolean; readOnlyDefinition?: boolean; readOnlyOptions?: boolean }
  name: string
  options?: RawOption[]
  type: string
  updatedAt?: string
}

/** HubSpot lists one data sensitivity per request; a property read singly must name the one it was listed under. */
export type Sensitivity = 'non_sensitive' | 'sensitive' | 'highly_sensitive'

/** A property as one of the three lists returned it, with the list's sensitivity. */
export type ListedProperty = RawProperty & { sensitivity: Sensitivity }

/**
 * What a read learned about one property beyond its definition, for planning and apply. Never part of the IR, a
 * snapshot or coverage.
 */
export interface PropertyMeta {
  createdAt?: string
  /**
   * HubSpot's flag, as returned. A reference is HubSpot-defined or calculated, and only a HubSpot-defined one needs
   * `include` to be in the pull scope, so the plan's advice for it depends on this.
   */
  hubspotDefined?: boolean
  /** HubSpot's flags, as returned: archivable, and whether the definition or the options are read-only. */
  modificationMetadata?: { archivable?: boolean; readOnlyDefinition?: boolean; readOnlyOptions?: boolean }
  /** Each option's value and HubSpot's raw displayOrder, in portal order. Absent when the property has no options. */
  options?: { value: string; displayOrder?: number }[]
  /** The list that returned it. */
  sensitivity: Sensitivity
  updatedAt?: string
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

/** The fields pull reads from GET /crm-object-schemas/2026-09/schemas. HubSpot marks both labels optional. */
export interface RawSchema {
  archived?: boolean
  labels?: { singular?: string; plural?: string }
  name: string
  objectTypeId: string
  primaryDisplayProperty?: string
  requiredProperties?: string[]
  searchableProperties?: string[]
  secondaryDisplayProperties?: string[]
}

export interface LiveProperty {
  calculated: boolean
  /**
   * The full definition of a managed property, the options of an enum reference (hidden and description included,
   * though pull writes value and label alone), nothing for another reference.
   */
  definition?: Definition
  /** HubSpot's `fieldType`, for the codec conflict warning: a reference's definition does not carry it. */
  fieldType: string
  hubspotDefined: boolean
  kind: BuilderKind
  name: string
  /** HubSpot-defined or calculated: never created, changed or removed. */
  reference: boolean
  /** HubSpot's `type`, for the codec conflict warning. */
  type: string
}

/**
 * A property no builder carries, skipped with W_UNSUPPORTED_TYPE. Its absence from the file proves nothing. It still
 * carries the fields a comparison needs; `group` is the local group name, `shadowed:<name>` for a shadowed one.
 */
export interface UnsupportedProperty {
  description?: string
  fieldType: string
  group: string
  hubspotDefined: boolean
  label: string
  name: string
  options?: Option[]
  type: string
}

/** A label HubSpot left out stays out: pull cannot write the object, and the observation records it. */
export type LiveCustom = Pick<
  RawSchema,
  'primaryDisplayProperty' | 'requiredProperties' | 'searchableProperties' | 'secondaryDisplayProperties'
> & { labels: { singular?: string; plural?: string } }

export interface LiveObject {
  /** Names of the archived groups, sorted. */
  archivedGroups: string[]
  custom?: LiveCustom
  /** Unarchived groups, name to label. */
  groups: Map<string, string>
  /**
   * Per portal group name, the portal names of the unarchived properties the lists returned in it, sorted: skipped and
   * unaddressable ones included, since a group delete must know every one.
   */
  members: Map<string, string[]>
  /** Per unarchived property, supported or not, by local name. */
  meta: Map<string, PropertyMeta>
  /** The config key. */
  object: string
  /** A custom object's type ID. */
  objectTypeId?: string
  /** Unarchived properties with a builder, in portal order. */
  properties: LiveProperty[]
  /** Unarchived properties no builder carries, in portal order. */
  unsupported: UnsupportedProperty[]
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
  // An own key only: a portal type such as 'constructor' names no builder.
  return Object.hasOwn(KINDS, type) ? KINDS[type] : undefined
}

/**
 * Live properties in portal order. Archived properties are skipped. A property whose type no builder carries
 * (object_coordinates, json, anything unknown), or whose fieldType no builder accepts, is listed as unsupported with
 * one warning.
 */
export function normalizeProperties(
  object: string,
  raw: RawProperty[],
  issues: Issue[],
): Pick<LiveObject, 'properties' | 'unsupported'> {
  const properties: LiveProperty[] = []
  const unsupported: UnsupportedProperty[] = []
  for (const p of raw) {
    if (p.archived) {
      continue
    }
    const hubspotDefined = Boolean(p.hubspotDefined)
    const reference = Boolean(p.hubspotDefined || p.calculated)
    const kind = kindOf(p.type, p.fieldType)
    if (kind === undefined || !(reference || FIELD_TYPES[kind].includes(p.fieldType))) {
      issues.push({
        code: 'W_UNSUPPORTED_TYPE',
        message: `property:${object}/${sanitize(p.name)} has type ${sanitize(p.type)} and fieldType ${sanitize(p.fieldType)}, which no builder carries; skipped`,
      })
      unsupported.push(
        compact({
          name: p.name,
          label: p.label,
          group: p.groupName,
          description: p.description || undefined,
          type: p.type,
          fieldType: p.fieldType,
          options: p.options?.length ? normalizeOptions(p.options) : undefined,
          hubspotDefined,
        }),
      )
      continue
    }
    const options = kind === 'enum' || kind === 'multiEnum' ? normalizeOptions(p.options ?? []) : undefined
    properties.push({
      name: p.name,
      hubspotDefined,
      type: p.type,
      fieldType: p.fieldType,
      kind,
      reference,
      calculated: Boolean(p.calculated),
      definition: definitionOf(p, reference, options),
    })
  }
  return { properties, unsupported }
}

/** The portal names of the unarchived properties in each portal group, sorted. */
export function groupMembers(raw: RawProperty[]): Map<string, string[]> {
  const members = new Map<string, string[]>()
  for (const p of raw.filter((property) => !property.archived)) {
    members.set(p.groupName, [...(members.get(p.groupName) ?? []), p.name])
  }
  return new Map([...members].map(([group, names]) => [group, names.sort(byCodeUnit)]))
}

/** The meta of each unarchived property, by name. */
export function propertyMeta(raw: ListedProperty[]): Map<string, PropertyMeta> {
  return new Map(raw.filter((p) => !p.archived).map((p) => [p.name, metaOf(p)]))
}

// Only the documented fields, each only when HubSpot sent it with its documented type.
function metaOf(p: ListedProperty): PropertyMeta {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : undefined)
  const flags = p.modificationMetadata
  const modificationMetadata =
    flags === undefined
      ? undefined
      : compact({
          archivable: flag(flags.archivable),
          readOnlyDefinition: flag(flags.readOnlyDefinition),
          readOnlyOptions: flag(flags.readOnlyOptions),
        })
  const options = p.options?.map((o) =>
    compact({ value: o.value, displayOrder: typeof o.displayOrder === 'number' ? o.displayOrder : undefined }),
  )
  return compact({
    sensitivity: p.sensitivity,
    hubspotDefined: flag(p.hubspotDefined),
    modificationMetadata,
    createdAt: text(p.createdAt),
    updatedAt: text(p.updatedAt),
    options: options?.length ? options : undefined,
  })
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
  return options?.length ? { options } : undefined
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

export function normalizeGroups(raw: RawGroup[]): Pick<LiveObject, 'groups' | 'archivedGroups'> {
  return {
    groups: new Map(raw.filter((g) => !g.archived).map((g) => [g.name, g.label])),
    archivedGroups: raw
      .filter((g) => g.archived)
      .map((g) => g.name)
      .sort(byCodeUnit),
  }
}

/** The schema fields the object file carries, the three lists as HubSpot returned them. */
export function normalizeSchema(schema: RawSchema): LiveCustom {
  return compact({
    labels: compact({ singular: schema.labels?.singular, plural: schema.labels?.plural }),
    primaryDisplayProperty: schema.primaryDisplayProperty,
    requiredProperties: schema.requiredProperties,
    searchableProperties: schema.searchableProperties,
    secondaryDisplayProperties: schema.secondaryDisplayProperties,
  })
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
