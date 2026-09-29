import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
  },
  properties: {
    paymentTerms: p.enum('payment_terms', {
      label: 'Payment terms',
      group: 'deal_terms',
      fieldType: 'select',
      options: [
        { value: 'net30', label: 'Net 30' },
        { value: 'net60', label: 'Net 60' },
      ],
      lifecycle: { removedOptions: ['net60'], ignoreChanges: ['lable'] },
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
