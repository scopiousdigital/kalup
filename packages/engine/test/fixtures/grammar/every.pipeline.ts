// Every pipeline file field.

import { definePipeline } from '@kalup/core'

// Every pipeline field.
export const HarvestsPipeline = definePipeline('harvest', {
  id: 'harvests',
  label: 'Harvests',
  displayOrder: 3,
  stages: {
    // Every stage field, whatever the object.
    picked: { id: 'harvests_picked', label: 'Picked', probability: 0.5, ticketState: 'OPEN', state: 'CLOSED' },
    sold: { id: 'harvests_sold', label: 'Sold' },
  },
})
