// Orchard CRM: company properties. Keys and aliases are hand-picked.

import { defineObject, type InferProperties, p } from '@kalup/core'
import { rowMeta } from '../../src/row-meta.js'

export const Company = defineObject('companies', {
  groups: {
    // Removed in the portal, kept here on purpose.
    legacy: { label: 'Legacy' },
    orchard: { label: 'Orchard' },
  },
  properties: {
    // Retired in the portal. Kept until rm exists.
    harvestWindow: p.string('harvest_window', {
      label: 'Harvest window',
      group: 'orchard',
      fieldType: 'text',
    }),
    lifecyclestage: p.enum('lifecyclestage', {
      options: [
        { value: 'lead', label: 'Lead' },
        { value: 'customer', label: 'Customer', as: 'paying' },
      ],
    }),
    // HubSpot-defined. Reference only.
    name: p.string('name'),
    plotTags: p.stringArray('plot_tags', {
      label: 'Plot tags',
      group: 'orchard',
      fieldType: 'text',
    }),
    plotCount: p.number('plot_total', {
      label: 'Plot total',
      group: 'orchard',
      fieldType: 'number',
    }),
    rowMeta: p.json('row_meta', rowMeta, {
      label: 'Row meta',
      group: 'orchard',
      fieldType: 'textarea',
    }),
    // Set by the yield sync. Do not edit by hand.
    yieldTier: p
      .enum('yield_tier', {
        label: 'Yield tier',
        group: 'orchard',
        fieldType: 'select',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'HIGH', label: 'High', as: 'high' },
          { value: 'trial', label: 'Trial' },
        ],
        lifecycle: { ignoreChanges: ['description'] },
      })
      .required(),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
