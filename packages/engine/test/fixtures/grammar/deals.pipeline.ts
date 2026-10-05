import { definePipeline } from '@kalup/core'

export const OrchardSalesPipeline = definePipeline('deals', {
  id: 'orchard_sales',
  label: 'Orchard sales',
  displayOrder: 1,
  stages: {
    tasting: { id: 'orchard_tasting', label: 'Tasting booked', probability: 0.2 },
    // Signed for the season.
    signed: { id: 'orchard_signed', label: 'Signed', probability: 1 },
    lost: { id: 'orchard_lost', label: 'Lost', probability: 0 },
  },
})

export const CiderPipeline = definePipeline('deals', {
  id: '512700418',
  label: "Cider makers' contracts",
  displayOrder: 2,
  stages: {
    stage512700419: { id: '512700419', label: 'Pressed', probability: 0.5 },
  },
})
