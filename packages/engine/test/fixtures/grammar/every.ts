// Every object field.

import { defineCustomObject, type InferProperties, p } from '@kalup/core'
import { rowMeta } from '../../src/row-meta.js'

// Every field a custom object takes.
export const Harvest = defineCustomObject('harvest', {
  labels: { singular: 'Harvest', plural: 'Harvests' },
  description: 'One picking of one row.',
  primaryDisplayProperty: 'batch_code',
  requiredProperties: ['batch_code'],
  searchableProperties: ['batch_code'],
  secondaryDisplayProperties: ['row_meta'],
  groups: {
    // Kept by hand.
    orchard: { label: 'Orchard details' },
  },
  properties: {
    // Every definition field and every chain call.
    rowMeta: p
      .json('row_meta', rowMeta, {
        label: 'Row meta',
        group: 'orchard',
        fieldType: 'textarea',
        description: 'The dominant soil',
        options: [],
        hasUniqueValue: false,
        formField: true,
        hidden: false,
        displayOrder: -1,
        numberDisplayHint: 'percentage',
        showCurrencySymbol: true,
        currencyPropertyName: 'orch_currency',
        textDisplayHint: 'multi_line',
        calculationFormula: 'orch_rows * 2',
        dataSensitivity: 'non_sensitive',
        lifecycle: { options: 'exact', removedOptions: ['sand'], ignoreChanges: ['description'], preventDestroy: true },
      })
      .required()
      .readonly()
      .managed(false),
    soilType: p
      .enum('soil_type', {
        label: 'Soil type',
        group: 'orchard',
        fieldType: 'select',
        description: 'The dominant soil',
        options: [
          { value: 'CLAY', label: 'Clay', as: 'clay', hidden: false, description: 'Heavy soil' },
          { value: 'loam', label: 'Loam' },
        ],
        hasUniqueValue: false,
        formField: true,
        hidden: false,
        displayOrder: -1,
        numberDisplayHint: 'percentage',
        showCurrencySymbol: true,
        currencyPropertyName: 'orch_currency',
        textDisplayHint: 'multi_line',
        calculationFormula: 'orch_rows * 2',
        dataSensitivity: 'non_sensitive',
        lifecycle: { options: 'exact', removedOptions: ['sand'], ignoreChanges: ['description'], preventDestroy: true },
      })
      .strict()
      .required()
      .readonly()
      .managed(false),
  },
})

export type HarvestData = InferProperties<typeof Harvest.properties> & { id: string }
