// Portal JSON to the grammar's shapes. Pure, so the API fixtures under test/fixtures/api test it offline.
import type { Definition } from '@kalup/core'
import type { BuilderKind, Option, StageState } from '../../grammar/types.js'
import { DEFAULTS } from '../../ir/defaults.js'
import type { Issue } from '../../ir/types.js'
import { byCodeUnit } from '../../loader/load.js'
import {
  CALCULATION,
  FIELD_TYPES,
  RESERVED_PREFIX,
  type StageField,
  stageField,
  TYPE_FIELDS,
} from '../../loader/tables.js'
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
  /** True on a HubSpot-computed property, and on a custom calculation property as well (observed). */
  calculated?: boolean
  calculationFormula?: string
  createdAt?: string
  currencyPropertyName?: string
  dataSensitivity?: string
  /** Returned, but HubSpot ignores it on create and update (observed), so Kalup does not capture it. */
  dateDisplayHint?: string
  description?: string
  displayOrder?: number
  /** HubSpot fills the options from elsewhere, such as owners or teams. */
  externalOptions?: boolean
  fieldType: string
  formField?: boolean
  groupName: string
  hasUniqueValue?: boolean
  hidden?: boolean
  hubspotDefined?: boolean
  label: string
  modificationMetadata?: Flags
  name: string
  numberDisplayHint?: string
  options?: RawOption[]
  /** `OWNER` on an owner property. */
  referencedObjectType?: string
  showCurrencySymbol?: boolean
  textDisplayHint?: string
  type: string
  updatedAt?: string
}

/** HubSpot's modificationMetadata: whether the property can be archived, and what of it is read-only. */
export interface Flags {
  archivable?: boolean
  readOnlyDefinition?: boolean
  readOnlyOptions?: boolean
  /** A record's value cannot be written through the API: pull writes `.readonly()`. */
  readOnlyValue?: boolean
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
   * HubSpot's `currencyPropertyName` as returned, `''` included: once any value was set, even `''`, HubSpot never
   * turns showCurrencySymbol off again (observed 2026-10-01). The definition drops `''`; this keeps it for that check.
   */
  currencyPropertyName?: string
  /**
   * HubSpot's flag, as returned. A reference is HubSpot-defined or calculated, and only a HubSpot-defined one the
   * files do not define needs `include` to be in the pull scope; takeover never archives one.
   */
  hubspotDefined?: boolean
  /** HubSpot's flags, as returned: archivable, and whether the definition, the options or the value are read-only. */
  modificationMetadata?: Flags
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
  /**
   * HubSpot fills its options (an owner or externalOptions property), so it reads as `p.string` whatever its type, and
   * the file's builder is the app's choice.
   */
  external?: true
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
 * A property Kalup does not write, with W_UNSUPPORTED_TYPE: its type or fieldType is outside the builder tables, or it is
 * a custom owner or externalOptions property. Pull writes it as a `p.string` reference; plan never creates, changes or
 * archives it. It still carries the fields a comparison needs; `group` is the local group name, `shadowed:<name>` for a
 * shadowed one.
 */
export interface UnsupportedProperty {
  description?: string
  externalOptions?: boolean
  fieldType: string
  group: string
  hubspotDefined: boolean
  label: string
  name: string
  options?: Option[]
  referencedObjectType?: string
  type: string
}

/** A label HubSpot left out stays out: pull cannot write the object, and the observation records it. */
export type LiveCustom = Pick<
  RawSchema,
  'primaryDisplayProperty' | 'requiredProperties' | 'searchableProperties' | 'secondaryDisplayProperties'
> & { labels: { singular?: string; plural?: string } }

export interface LiveObject {
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
  /** Its pipelines, when they are in scope and the key could read them, under their local IDs. */
  pipelines?: LivePipeline[]
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
  phone_number: 'phoneNumber',
}

function kindOf(type: string, fieldType: string): BuilderKind | undefined {
  if (type === 'enumeration') {
    return fieldType === 'checkbox' ? 'multiEnum' : 'enum'
  }
  // An own key only: a portal type such as 'constructor' names no builder.
  return Object.hasOwn(KINDS, type) ? KINDS[type] : undefined
}

// The builder a property reads as: p.owner for an owner property, p.string for any other that HubSpot fills the options
// of, else the one its type implies.
function builderOf(p: RawProperty, external: boolean): BuilderKind | undefined {
  if (isOwner(p)) {
    return 'owner'
  }
  return external ? 'string' : kindOf(p.type, p.fieldType)
}

// Whether Kalup writes a custom property of this kind: its builder takes the fieldType, and HubSpot does not fill its
// options, unless it is an owner property.
function writable(p: RawProperty, kind: BuilderKind, external: boolean): boolean {
  return (kind === 'owner' || !external) && FIELD_TYPES[kind].includes(p.fieldType)
}

/** A HubSpot user property p.owner writes: an enumeration HubSpot fills with owners, as a select or radio. */
function isOwner(p: Pick<RawProperty, 'type' | 'fieldType' | 'referencedObjectType' | 'externalOptions'>): boolean {
  return (
    p.referencedObjectType === 'OWNER' &&
    p.externalOptions === true &&
    p.type === 'enumeration' &&
    FIELD_TYPES.owner.includes(p.fieldType)
  )
}

/** Why Kalup does not write a property: its options come from HubSpot, or its type and fieldType fit no builder. */
export function unsupportedReason(
  p: Pick<UnsupportedProperty, 'type' | 'fieldType' | 'externalOptions' | 'referencedObjectType'>,
): string {
  if (p.referencedObjectType === 'OWNER') {
    return `is a HubSpot user property with fieldType ${sanitize(p.fieldType)}`
  }
  if (p.externalOptions) {
    return 'takes its options from HubSpot (externalOptions)'
  }
  return `has type ${sanitize(p.type)} and fieldType ${sanitize(p.fieldType)}`
}

/**
 * Live properties in portal order. Archived properties are skipped. An owner property (a select or radio HubSpot fills
 * with users) is `p.owner`. HubSpot fills the options of any other externalOptions property, so it reads as a string: a
 * HubSpot-defined or HubSpot-calculated one is a `p.string` reference, a custom one is unsupported. So is a property
 * whose type no builder carries (object_coordinates, json, anything unknown), or a custom one whose fieldType no builder
 * accepts (a calculation_rollup), each with one warning when `warn` says the project cares about it: a property outside
 * the pull scope and the files is noise. A custom calculation_equation property is managed: HubSpot marks it
 * `calculated`, but its formula is Kalup's to write.
 */
export function normalizeProperties(
  object: string,
  raw: RawProperty[],
  issues: Issue[],
  warn: (p: RawProperty) => boolean = () => true,
): Pick<LiveObject, 'properties' | 'unsupported'> {
  const properties: LiveProperty[] = []
  const unsupported: UnsupportedProperty[] = []
  for (const p of raw) {
    if (p.archived) {
      continue
    }
    const hubspotDefined = Boolean(p.hubspotDefined)
    // HubSpot's own, a rollup it calculates, or a name under a prefix HubSpot reserves (an integration's property, or
    // an hs_ name HubSpot does not flag): never Kalup's to manage, so a reference.
    const reference = Boolean(
      p.hubspotDefined || (p.calculated && p.fieldType !== CALCULATION) || RESERVED_PREFIX.test(p.name),
    )
    const external = p.externalOptions === true || p.referencedObjectType === 'OWNER'
    const kind = builderOf(p, external)
    if (kind === undefined || !(reference || writable(p, kind, external))) {
      const u = unsupportedOf(p)
      warnUnsupported(issues, object, u, warn(p))
      unsupported.push(u)
      continue
    }
    const options = kind === 'enum' || kind === 'multiEnum' ? normalizeOptions(p.options ?? []) : undefined
    properties.push({
      name: p.name,
      ...(external ? { external: true as const } : {}),
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

// W_UNSUPPORTED_TYPE for one property, when `wanted`: the project pulls or names it.
function warnUnsupported(issues: Issue[], object: string, u: UnsupportedProperty, wanted: boolean): void {
  if (wanted) {
    issues.push({
      code: 'W_UNSUPPORTED_TYPE',
      message: `property:${object}/${sanitize(u.name)} ${unsupportedReason(u)}, which Kalup does not write; read as a p.string reference`,
    })
  }
}

function unsupportedOf(p: RawProperty): UnsupportedProperty {
  return compact({
    name: p.name,
    label: p.label,
    group: p.groupName,
    description: p.description || undefined,
    type: p.type,
    fieldType: p.fieldType,
    options: p.options?.length ? normalizeOptions(p.options) : undefined,
    hubspotDefined: Boolean(p.hubspotDefined),
    externalOptions: p.externalOptions === true || undefined,
    referencedObjectType: p.referencedObjectType,
  })
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
          readOnlyValue: flag(flags.readOnlyValue),
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
    currencyPropertyName: text(p.currencyPropertyName),
  })
}

// The full definition of a managed property, the options of an enum reference, nothing for another reference. A field
// holding what omitting it means is left out, as pull leaves it out of the file; a display field is kept only on the
// types that show it, since HubSpot stores any of them on any property.
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
      hidden: p.hidden || undefined,
      displayOrder: typeof p.displayOrder === 'number' && p.displayOrder !== -1 ? p.displayOrder : undefined,
      ...displayOf(p),
      calculationFormula: p.fieldType === CALCULATION ? filled(p.calculationFormula) : undefined,
      dataSensitivity: unlessDefault('dataSensitivity', p.dataSensitivity),
    } as Definition)
  }
  return options?.length ? { options } : undefined
}

// The display fields of the types that show them, each left out at HubSpot's default.
function displayOf(p: RawProperty): Partial<Definition> {
  const shown = (field: keyof typeof TYPE_FIELDS) => TYPE_FIELDS[field]?.includes(p.type) === true
  return {
    numberDisplayHint: shown('numberDisplayHint')
      ? (unlessDefault('numberDisplayHint', p.numberDisplayHint) as Definition['numberDisplayHint'])
      : undefined,
    showCurrencySymbol: shown('showCurrencySymbol') ? p.showCurrencySymbol || undefined : undefined,
    currencyPropertyName: shown('currencyPropertyName') ? filled(p.currencyPropertyName) : undefined,
    textDisplayHint: shown('textDisplayHint')
      ? (filled(p.textDisplayHint) as Definition['textDisplayHint'])
      : undefined,
  }
}

// A string that is not empty, else undefined.
function filled(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

// A string field's value, or undefined when it is HubSpot's default or not a string.
function unlessDefault(field: string, value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value !== DEFAULTS.definition[field] ? value : undefined
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

/** The fields pull reads from GET /crm/pipelines/2026-09/{objectType}: every pipeline with its stages. */
export interface RawPipeline {
  archived?: boolean
  displayOrder: number
  id: string
  label: string
  stages: RawStage[]
}

/** A stage as a pipeline read returns it. Every metadata value is a string. */
export interface RawStage {
  archived?: boolean
  displayOrder: number
  id: string
  label: string
  metadata?: Record<string, string>
}

/** A pipeline with its stages in display order, each stage's metadata as its object's one field. */
export interface LivePipeline {
  displayOrder: number
  id: string
  label: string
  stages: LiveStage[]
}

export interface LiveStage {
  id: string
  label: string
  probability?: number
  state?: StageState
  ticketState?: StageState
}

const STATES = new Set(['OPEN', 'CLOSED'])

/**
 * The unarchived pipelines of `object`, by displayOrder then ID, since pipelines may share a number and the list is not
 * sorted; each one's stages by displayOrder, which HubSpot never stores tied (observed 2026-10-05). A stage keeps the
 * one metadata field its object takes: a deal's probability as a number, a ticket's ticketState, a custom object's
 * state. `isClosed` is HubSpot's own, derived from that field, and is dropped; so is the metadata of a stage on an
 * object whose pipelines Kalup does not write.
 */
export function normalizePipelines(object: string, raw: RawPipeline[], custom: boolean): LivePipeline[] {
  const field = stageField(object, custom)
  const ordered = <T extends { displayOrder: number; id: string }>(list: T[]) =>
    [...list].sort((a, b) => a.displayOrder - b.displayOrder || byCodeUnit(a.id, b.id))
  return ordered(raw.filter((p) => !p.archived)).map((p) => ({
    id: p.id,
    label: p.label,
    displayOrder: p.displayOrder,
    stages: ordered(p.stages.filter((st) => !st.archived)).map((st) => ({
      id: st.id,
      label: st.label,
      ...stageMetadata(field, st.metadata ?? {}),
    })),
  }))
}

function stageMetadata(field: StageField | undefined, metadata: Record<string, string>): Partial<LiveStage> {
  const value = field === undefined ? undefined : metadata[field]
  if (field === 'probability') {
    const probability = Number(value)
    return value !== undefined && Number.isFinite(probability) ? { probability } : {}
  }
  return field !== undefined && value !== undefined && STATES.has(value) ? { [field]: value as StageState } : {}
}

export function normalizeGroups(raw: RawGroup[]): Pick<LiveObject, 'groups'> {
  return { groups: new Map(raw.filter((g) => !g.archived).map((g) => [g.name, g.label])) }
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
