import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  properties: {
    amount: p.number('amount'),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }

export const DealExtra = defineObject('deals', {
  properties: {
    amount: p.number('amount_in_home_currency'),
  },
})

export type DealExtraData = InferProperties<typeof DealExtra.properties> & { id: string }
