import { defineObject, type InferProperties, p } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: {
    orchard: { label: 'Orchard' },
  },
  properties: {
    // No orc_ prefix: W_PREFIX.
    zoneCode: p.string('zone_code', {
      label: 'Zone code',
      group: 'orchard',
      fieldType: 'text',
    }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
