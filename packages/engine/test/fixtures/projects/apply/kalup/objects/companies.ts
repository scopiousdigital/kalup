// Orchard CRM: the company group and properties the apply tests write.

import { defineObject, type InferProperties, p } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: {
    orchard: { label: 'Orchard' },
  },
  properties: {
    soilPh: p.number('soil_ph', {
      label: 'Soil pH',
      group: 'orchard',
      fieldType: 'number',
    }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
