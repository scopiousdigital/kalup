import { defineCustomObject, type InferProperties, p } from '@kalup/core'

export const Harvest = defineCustomObject('harvest', {
  labels: { singular: 'Harvest', plural: 'Harvests' },
  primaryDisplayProperty: 'batch_code',
  requiredProperties: ['batch_code'],
  searchableProperties: ['batch_code', 'orchard_ref'],
  secondaryDisplayProperties: ['picked_on'],
  groups: {
    harvest_details: { label: 'Harvest details' },
  },
  properties: {
    batchCode: p.string('batch_code', {
      label: 'Batch code',
      group: 'harvest_details',
      fieldType: 'text',
      hasUniqueValue: true,
    }),
    orchardRef: p.string('orchard_ref', {
      label: 'Orchard ref',
      group: 'harvest_details',
      fieldType: 'text',
    }),
    pickedOn: p.date('picked_on', {
      label: 'Picked on',
      group: 'harvest_details',
      fieldType: 'date',
    }),
    weightKg: p.number('weight_kg', {
      label: 'Weight (kg)',
      group: 'harvest_details',
      fieldType: 'number',
    }),
  },
})

export type HarvestData = InferProperties<typeof Harvest.properties> & { id: string }
