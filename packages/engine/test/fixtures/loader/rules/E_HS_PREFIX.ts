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
    // An integration's property may be referenced too.
    appScore: p.number('a12345_score'),
    appRank: p.number('a12345_rank', {
      label: 'App rank',
      group: 'deal_terms',
      fieldType: 'number',
    }),
    // Not reserved: no digits, or digits after a letter.
    absent: p.number('a_absent', { label: 'Absent', group: 'deal_terms', fieldType: 'number' }),
    abort: p.number('ab1_abort', { label: 'Abort', group: 'deal_terms', fieldType: 'number' }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
