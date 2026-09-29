// Builder to HubSpot tables, as data. validate reads FIELD_TYPES; the loader writes HUBSPOT_TYPES into every definition.
import type { BuilderKind } from '../grammar/types.js'

/** The HubSpot `type` each builder implies. Never written in config. */
export const HUBSPOT_TYPES: Record<BuilderKind, 'string' | 'number' | 'bool' | 'date' | 'datetime' | 'enumeration'> = {
  string: 'string',
  number: 'number',
  boolean: 'bool',
  date: 'date',
  datetime: 'datetime',
  enum: 'enumeration',
  multiEnum: 'enumeration',
  stringArray: 'string',
  json: 'string',
}

const TEXT = ['text', 'textarea', 'file', 'phonenumber']

/**
 * The fieldTypes each builder accepts. p.enum refuses checkbox and p.multiEnum takes only checkbox. Taken from the
 * spec's E_TYPE_FIELDTYPE rule; not yet confirmed against the 2026-09 properties guide.
 */
export const FIELD_TYPES: Record<BuilderKind, string[]> = {
  string: TEXT,
  stringArray: TEXT,
  json: TEXT,
  number: ['number'],
  boolean: ['booleancheckbox'],
  enum: ['select', 'radio', 'booleancheckbox'],
  multiEnum: ['checkbox'],
  date: ['date'],
  datetime: ['date'],
}
