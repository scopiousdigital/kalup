import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  properties: {
    amount: p.number('amount').managed(false),
    currency: p.string('currency', {
      options: [{ value: 'EUR', label: 'Euro' }],
    }),
    discount: p.number('discount', {
      label: 'Discount',
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
