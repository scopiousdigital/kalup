import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
  },
  properties: {
    // A reference may carry HubSpot's prefix.
    dealScore: p.number('hs_deal_score'),
    forecast: p.number('hs_forecast_amount', {
      label: 'Forecast amount',
      group: 'deal_terms',
      fieldType: 'number',
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
