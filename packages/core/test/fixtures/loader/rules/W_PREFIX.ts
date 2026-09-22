import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
  },
  properties: {
    // A reference needs no prefix.
    amount: p.number('amount'),
    acmeScore: p.number('acme_score', {
      label: 'Acme score',
      group: 'deal_terms',
      fieldType: 'number',
    }),
    termDays: p.number('term_days', {
      label: 'Term days',
      group: 'deal_terms',
      fieldType: 'number',
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
