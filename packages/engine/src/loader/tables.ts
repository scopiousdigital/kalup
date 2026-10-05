// Builder to HubSpot tables, as data. validate reads FIELD_TYPES; the loader writes HUBSPOT_TYPES into every definition.
import type { BuilderKind } from '../grammar/types.js'

/** The HubSpot `type` each builder implies. Never written in config. */
export const HUBSPOT_TYPES: Record<
  BuilderKind,
  'string' | 'number' | 'bool' | 'date' | 'datetime' | 'enumeration' | 'phone_number'
> = {
  string: 'string',
  number: 'number',
  boolean: 'bool',
  date: 'date',
  datetime: 'datetime',
  enum: 'enumeration',
  multiEnum: 'enumeration',
  stringArray: 'string',
  json: 'string',
  phoneNumber: 'phone_number',
  owner: 'enumeration',
}

const TEXT = ['text', 'textarea', 'file', 'phonenumber']
/** HubSpot computes the value from `calculationFormula`. The properties guide lists it for these four types. */
export const CALCULATION = 'calculation_equation'

/**
 * The fieldTypes each builder accepts, from the 2026-09 properties guide and live runs (docs/hubspot.md). p.enum refuses
 * checkbox and p.multiEnum takes only checkbox. A calculation is a number, bool, string or enumeration.
 */
export const FIELD_TYPES: Record<BuilderKind, string[]> = {
  string: [...TEXT, 'html', CALCULATION],
  stringArray: TEXT,
  json: TEXT,
  number: ['number', CALCULATION],
  boolean: ['booleancheckbox', CALCULATION],
  enum: ['select', 'radio', 'booleancheckbox', CALCULATION],
  multiEnum: ['checkbox'],
  date: ['date'],
  datetime: ['date'],
  phoneNumber: ['phonenumber'],
  owner: ['select', 'radio'],
}

/**
 * Definition fields only some builders take: the number display fields on p.number, the text display hint on the text
 * builders. Every other field fits every builder.
 */
export const BUILDER_FIELDS: Record<string, readonly BuilderKind[]> = {
  numberDisplayHint: ['number'],
  showCurrencySymbol: ['number'],
  currencyPropertyName: ['number'],
  textDisplayHint: ['string', 'stringArray', 'json', 'phoneNumber'],
}

/** The HubSpot `type`s whose properties carry each builder-bound field in the portal. */
export const TYPE_FIELDS: Record<string, readonly string[]> = {
  numberDisplayHint: ['number'],
  showCurrencySymbol: ['number'],
  currencyPropertyName: ['number'],
  textDisplayHint: ['string', 'phone_number'],
}

/**
 * The name prefixes HubSpot reserves: `hs_` for its own properties and `a<appId>_` for an integration's. A create with
 * either is refused (400, live runs 2026-10-01). Kalup never manages such a property; pull writes it as a reference.
 */
export const RESERVED_PREFIX = /^(hs_|a\d+_)/

/** The reserved prefix a name carries, or undefined. */
export function reservedPrefix(name: string): string | undefined {
  return RESERVED_PREFIX.exec(name)?.[1]
}

/** A stage metadata field, by the object a pipeline belongs to: one each, never `isClosed`, which HubSpot derives. */
export type StageField = 'probability' | 'ticketState' | 'state'

/** Every stage metadata field Kalup manages, in the order the writer and the plan list them. */
export const STAGE_FIELDS: readonly StageField[] = ['probability', 'ticketState', 'state']

// Deals take a probability, tickets a ticketState (observed 2026-10-01 and 2026-10-05). A custom object's stage takes
// `state`, OPEN or CLOSED (observed 2026-10-05).
const FIELD_BY_OBJECT: Readonly<Record<string, StageField>> = { deals: 'probability', tickets: 'ticketState' }

/**
 * The standard objects that have pipelines: the pipelines path answered for each on 2026-10-05 (leads with a 403 for a
 * missing scope). Every custom object may have them too.
 */
const PIPELINE_OBJECTS: ReadonlySet<string> = new Set([
  'appointments',
  'companies',
  'contacts',
  'courses',
  'deals',
  'leads',
  'listings',
  'orders',
  'services',
  'tickets',
])

/** Whether an object can have pipelines: one of PIPELINE_OBJECTS, or a custom object. */
export function hasPipelines(object: string, custom: boolean): boolean {
  return custom || PIPELINE_OBJECTS.has(object)
}

/** The longest pipeline and stage IDs HubSpot stores; a longer one answers 500 and creates nothing (2026-10-05). */
export const PIPELINE_ID_MAX = 36
export const STAGE_ID_MAX = 100

/**
 * The metadata field of a stage of `object`, or undefined for an object whose pipelines Kalup reads and compares but
 * does not write: every standard object but deals and tickets. `custom` says whether the object is a custom object.
 */
export function stageField(object: string, custom: boolean): StageField | undefined {
  if (custom) {
    return 'state'
  }
  return Object.hasOwn(FIELD_BY_OBJECT, object) ? FIELD_BY_OBJECT[object] : undefined
}

/** A custom object schema's fields as config states them, labels first: the order the writer and the plan use. */
export const OBJECT_FIELDS = [
  'labels',
  'description',
  'primaryDisplayProperty',
  'requiredProperties',
  'searchableProperties',
  'secondaryDisplayProperties',
] as const

/** The custom object fields that name its properties: HubSpot refuses one naming a property it does not hold. */
export const OBJECT_DISPLAY_FIELDS = [
  'primaryDisplayProperty',
  'secondaryDisplayProperties',
  'requiredProperties',
  'searchableProperties',
] as const

/** The property names one display, required or searchable field holds, a single name or a list. */
export function fieldNames(fields: Record<string, unknown>, field: string): string[] {
  return ([fields[field] ?? []].flat() as unknown[]).filter((name): name is string => typeof name === 'string')
}

/** Every property name a custom object's display, required and searchable fields hold, each once, in field order. */
export function displayNames(fields: Record<string, unknown>): string[] {
  return [...new Set(OBJECT_DISPLAY_FIELDS.flatMap((field) => fieldNames(fields, field)))]
}

/** HubSpot's rule for a custom object's name, and the longest name and label it stores (observed 2026-10-05). */
export const OBJECT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/
export const OBJECT_NAME_MAX = 50

/**
 * The properties HubSpot gives every custom object it creates, all HubSpot-defined (observed 2026-10-05). A display,
 * required or searchable field may name them without the object file listing them, and a new object's create names
 * only these: its own properties do not exist yet.
 */
export const OBJECT_DEFAULT_PROPERTIES: ReadonlySet<string> = new Set([
  'hs_all_accessible_team_ids',
  'hs_all_assigned_business_unit_ids',
  'hs_all_owner_ids',
  'hs_all_team_ids',
  'hs_avatar_filemanager_key',
  'hs_created_by_user_id',
  'hs_createdate',
  'hs_lastmodifieddate',
  'hs_merged_object_ids',
  'hs_object_id',
  'hs_object_source',
  'hs_object_source_detail_1',
  'hs_object_source_detail_2',
  'hs_object_source_detail_3',
  'hs_object_source_id',
  'hs_object_source_label',
  'hs_object_source_user_id',
  'hs_owning_teams',
  'hs_pinned_engagement_id',
  'hs_read_only',
  'hs_shared_team_ids',
  'hs_shared_user_ids',
  'hs_unique_creation_key',
  'hs_updated_by_user_id',
  'hs_user_ids_of_all_notification_followers',
  'hs_user_ids_of_all_notification_recipients',
  'hs_user_ids_of_all_notification_unfollowers',
  'hs_user_ids_of_all_owners',
  'hs_was_imported',
  'hubspot_owner_assigneddate',
  'hubspot_owner_id',
  'hubspot_team_id',
])

/**
 * Whether `name` is HubSpot's own on a custom object: one of the properties it gives every custom object, or any `hs_`
 * name, a prefix HubSpot reserves. A display field may name it with no entry in the object file; plan warns about an
 * `hs_` name outside the known list.
 */
export function hubspotName(name: string): boolean {
  return name.startsWith('hs_') || OBJECT_DEFAULT_PROPERTIES.has(name)
}
