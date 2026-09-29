import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  properties: {
    termDays: p.number('term_days', {
      label: 'Term days',
      group: 'deal_terms',
      fieldType: 'number',
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
