import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
  },
  properties: {
    // Strict with options: the IR binding carries strict.
    paymentTerms: p.enum('payment_terms', { options: [{ value: 'net30', label: 'Net 30' }] }).strict(),
    stage: p.enum('dealstage').strict(),
    termKinds: p
      .multiEnum('term_kinds', {
        label: 'Term kinds',
        group: 'deal_terms',
        fieldType: 'checkbox',
      })
      .strict(),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
