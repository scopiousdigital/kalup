import { defineObject, type InferProperties, p } from '@kalup/core'
import { dealMeta } from '../../src/deal-meta'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
  },
  properties: {
    meta: p.json('deal_meta', dealMeta, {
      label: 'Deal meta',
      group: 'deal_terms',
      fieldType: 'text',
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
