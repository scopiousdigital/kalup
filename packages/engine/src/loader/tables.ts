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
