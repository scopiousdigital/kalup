import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
  },
  properties: {
    amount: p.number('amount'),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }

export const DealAgain = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Terms of the deal' },
  },
  properties: {
    discount: p.number('discount'),
  },
})

export type DealAgainData = InferProperties<typeof DealAgain.properties> & { id: string }
