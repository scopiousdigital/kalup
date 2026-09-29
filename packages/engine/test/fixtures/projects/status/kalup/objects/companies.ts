import { defineObject, type InferProperties, p } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: {
    orchard: { label: 'Orchard' },
  },
  properties: {
    // HubSpot-defined. Reference only.
    name: p.string('name'),
    plotCount: p.number('plot_count', {
      label: 'Plot count',
      group: 'orchard',
      fieldType: 'number',
    }),
    yieldTier: p.enum('yield_tier', {
      label: 'Yield tier',
      group: 'orchard',
      fieldType: 'select',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'HIGH', label: 'High', as: 'high' },
      ],
    }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
