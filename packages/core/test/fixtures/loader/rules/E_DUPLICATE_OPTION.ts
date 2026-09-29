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
        { value: 'net30', label: 'Net 30 again', as: 'net30Again' },
      ],
    }),
    kind: p.multiEnum('deal_kind', {
      options: [
        { value: '__proto__', label: 'Proto' },
        { value: 'constructor', label: 'Constructor' },
        { value: '__proto__', label: 'Proto again' },
      ],
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
