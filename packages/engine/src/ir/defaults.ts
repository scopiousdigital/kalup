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
  definition: { description: '', options: [], hasUniqueValue: false, formField: false },
  option: { hidden: false },
  lifecycle: { options: 'additive' },
}
