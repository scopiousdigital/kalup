import { defineObject, type InferProperties, p } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: {
    orchard: { label: 'Orchard' },
  },
  properties: {
    orcPlotCount: p.number('orc_plot_count', {
      label: 'Plot count',
      group: 'orchard',
      fieldType: 'number',
    }),
    // The group 'yield' is not declared above: E_UNKNOWN_GROUP.
    orcYieldTier: p.string('orc_yield_tier', {
      label: 'Yield tier',
      group: 'yield',
      fieldType: 'text',
    }),
    // No orc_ prefix: W_PREFIX.
    zoneCode: p.string('zone_code', {
      label: 'Zone code',
      group: 'orchard',
      fieldType: 'text',
    }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
