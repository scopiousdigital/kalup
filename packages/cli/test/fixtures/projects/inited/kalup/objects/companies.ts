import { defineObject, type InferProperties, p } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: {
    orchard: { label: 'Orchard details' },
    plots: { label: 'Plots' },
  },
  properties: {
    irrigationNotes: p.string('irrigation_notes', {
      label: 'Irrigation notes',
      group: 'orchard',
      fieldType: 'textarea',
      formField: true,
    }),
    plotCount: p.number('plot_count', {
      label: 'Plot count',
      group: 'plots',
      fieldType: 'number',
      description: 'Number of plots on the estate',
    }),
    plotTags: p.string('plot_tags', {
      label: 'Plot tags',
      group: 'orchard',
      fieldType: 'text',
    }),
    plotTotal: p.number('plot_total', {
      label: 'Plot total',
      group: 'orchard',
      fieldType: 'number',
    }),
    pruned: p.boolean('pruned', {
      label: 'Pruned this season',
      group: 'orchard',
      fieldType: 'booleancheckbox',
    }),
    rowMeta: p.string('row_meta', {
      label: 'Row meta',
      group: 'orchard',
      fieldType: 'textarea',
      description: 'Row layout as JSON',
    }),
    soilPh: p.number('soil_ph').readonly(),
    yieldTier: p.enum('yield_tier', {
      label: 'Yield band',
      group: 'orchard',
      fieldType: 'select',
      description: 'Set by the yield sync',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'HIGH', label: 'High' },
        { value: 'peak', label: 'Peak', hidden: true },
      ],
    }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
