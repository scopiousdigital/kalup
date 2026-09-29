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
        { value: 'net30', label: 'Net 30', as: 'net' },
        { value: 'net60', label: 'Net 60', as: 'net' },
        { value: 'upfront', label: 'Upfront', as: 'cod' },
        { value: 'cod', label: 'Cash on delivery' },
      ],
    }),
    kind: p.multiEnum('deal_kind', {
      options: [
        { value: 'constructor', label: 'Constructor', as: 'toString' },
        { value: 'toString', label: 'To string', as: 'constructor' },
        { value: '__proto__', label: 'Proto', as: 'toString' },
      ],
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
