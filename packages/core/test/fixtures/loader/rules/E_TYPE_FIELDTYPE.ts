import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
  },
  properties: {
    paymentTerms: p.enum('payment_terms', {
      label: 'Payment terms',
      group: 'deal_terms',
      fieldType: 'checkbox',
      options: [{ value: 'net30', label: 'Net 30' }],
    }),
    termDays: p.number('term_days', {
      label: 'Term days',
      group: 'deal_terms',
      fieldType: 'text',
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
