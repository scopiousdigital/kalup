import type { Lifecycle } from './types.js'

/**
 * What an omitted field means. The writer omits these. The loader fills lifecycle only; an omitted definition field
 * belongs to the portal and stays out of the IR.
 */
export const DEFAULTS: {
  definition: Record<string, unknown>
  option: Record<string, unknown>
  lifecycle: Lifecycle
} = {
  definition: { description: '', options: [], hasUniqueValue: false, formField: false },
  option: { hidden: false },
  lifecycle: { options: 'additive' },
}
