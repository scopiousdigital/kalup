import { defineCustomObject, type InferProperties, p } from '@kalup/core'

export const Harvest = defineCustomObject('harvest', {
  labels: { singular: 'Harvest', plural: 'Harvests' },
  primaryDisplayProperty: 'batch_code',
  requiredProperties: ['batch_code'],
  groups: {
    harvest_details: { label: 'Harvest details' },
  },
  properties: {
    batchCode: p.string('batch_code', {
      label: 'Batch code',
      group: 'harvest_details',
      fieldType: 'text',
    }),
    pickedOn: p.date('picked_on', {
      label: 'Picked on',
      group: 'harvest_details',
      fieldType: 'date',
    }),
  },
})

export type HarvestData = InferProperties<typeof Harvest.properties> & { id: string }
