// Orchard CRM: company properties. Keys and aliases are hand-picked.

import { defineObject, type InferProperties, p } from '@kalup/core'
import { rowMeta } from '../../src/row-meta'

export const Company = defineObject('companies', {
  groups: {
    // Removed in the portal, kept here on purpose.
    legacy: { label: 'Legacy' },
    orchard: { label: 'Orchard details' },
    plots: { label: 'Plots' },
  },
  properties: {
    // Retired in the portal. Kept until rm exists.
    harvestWindow: p.string('harvest_window', {
      label: 'Harvest window',
      group: 'orchard',
      fieldType: 'text',
    }),
    irrigationNotes: p.string('irrigation_notes', {
      label: 'Irrigation notes',
      group: 'orchard',
      fieldType: 'textarea',
      formField: true,
    }),
    lifecyclestage: p.enum('lifecyclestage', {
      options: [
        { value: 'subscriber', label: 'Subscriber' },
        { value: 'lead', label: 'Lead' },
        { value: 'customer', label: 'Customer', as: 'paying' },
      ],
    }),
    // HubSpot-defined. Reference only.
    name: p.string('name'),
    plot_count: p.number('plot_count', {
      label: 'Plot count',
      group: 'plots',
      fieldType: 'number',
      description: 'Number of plots on the estate',
    }),
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
    pruned: p.boolean('pruned', {
      label: 'Pruned this season',
      group: 'orchard',
      fieldType: 'booleancheckbox',
    }),
    rowMeta: p.json('row_meta', rowMeta, {
      label: 'Row meta',
      group: 'orchard',
      fieldType: 'textarea',
      description: 'Row layout as JSON',
    }),
    soilPh: p.number('soil_ph').readonly(),
    // Set by the yield sync. Do not edit by hand.
    yieldTier: p
      .enum('yield_tier', {
        label: 'Yield band',
        group: 'orchard',
        fieldType: 'select',
        description: 'Set by the yield sync',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'HIGH', label: 'High', as: 'high' },
          { value: 'peak', label: 'Peak', hidden: true },
          { value: 'trial', label: 'Trial' },
        ],
        lifecycle: { ignoreChanges: ['description'] },
      })
      .required(),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
