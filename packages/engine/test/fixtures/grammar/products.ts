// Written by the tool. Keys, aliases, chains and comments are yours; definitions follow the portal.
// Second header line.

import { defineCustomObject, type InferProperties, p } from '@kalup/core'

// Catalogue items, synced from the shop nightly.
export const Product = defineCustomObject('product', {
  labels: { singular: 'Product', plural: 'Products' },
  primaryDisplayProperty: 'sku',
  requiredProperties: [
    'sku',
    'name',
    'list_price',
    'currency_code',
    'tax_category',
    'fulfilment_channel',
    'availability_status',
    'catalogue_section',
  ],
  searchableProperties: ['sku', 'name'],
  groups: {
    catalogue: { label: 'Catalogue' },
  },
  properties: {
    ownerName: p.string('owner_name', {
      label: "Customer's name",
      group: 'catalogue',
      fieldType: 'text',
      description: 'Shown as "owner" in the app.',
    }),
    tier: p
      .enum('tier', {
        label: 'Tier',
        group: 'catalogue',
        fieldType: 'select',
        options: [
          { value: 'basic', label: 'Basic' },
          { value: 'plus', label: 'Plus' },
        ],
        lifecycle: {
          options: 'exact',
          removedOptions: [
            'legacy_silver',
            'legacy_gold',
            'legacy_platinum',
            'legacy_bronze',
            'legacy_trial',
            'legacy_partner',
            'legacy_internal',
          ],
          ignoreChanges: ['label', 'description'],
          preventDestroy: true,
        },
      })
      .required(),
  },
})

export type ProductData = InferProperties<typeof Product.properties> & { id: string }
