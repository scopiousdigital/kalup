import type { Lifecycle } from './types.js'

/**
 * What an omitted field means. The loader fills lifecycle only; an omitted definition field belongs to the portal and
 * stays out of the IR. The writer keeps an explicit default, because a present field is owned.
 */
export const DEFAULTS: {
  definition: Record<string, unknown>
  option: Record<string, unknown>
  lifecycle: Lifecycle
} = {
  definition: {
    description: '',
    options: [],
    hasUniqueValue: false,
    formField: false,
    hidden: false,
    displayOrder: -1,
    numberDisplayHint: 'formatted',
    showCurrencySymbol: false,
    dataSensitivity: 'non_sensitive',
  },
  option: { hidden: false },
  lifecycle: { options: 'additive' },
}

/** A property's definition fields in the order the IR writes them. */
export const PROPERTY_FIELDS = [
  'label',
  'group',
  'type',
  'fieldType',
  'description',
  'options',
  'hasUniqueValue',
  'formField',
  'hidden',
  'displayOrder',
  'numberDisplayHint',
  'showCurrencySymbol',
  'currencyPropertyName',
  'textDisplayHint',
  'calculationFormula',
  'dataSensitivity',
  'externalOptions',
  'referencedObjectType',
] as const
