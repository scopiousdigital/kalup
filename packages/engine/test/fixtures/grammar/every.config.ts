// Every config field, at every level it is allowed.

import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'orchard-crm',
  prefix: 'orch_',
  defaultTarget: 'sandbox',
  objects: {
    companies: { include: ['name', 'lifecyclestage'], custom: false, as: 'Firm' },
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      protected: true,
      drift: 'overwrite',
      allowDestroy: true,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' }, write: { env: 'HUBSPOT_SANDBOX_WRITE_KEY' } },
      overrides: {
        'property:companies/soil_type': {
          skip: true,
          name: 'orch_soil_type',
          definition: {
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
            lifecycle: {
              options: 'exact',
              removedOptions: ['sand'],
              ignoreChanges: ['description'],
              preventDestroy: true,
            },
          },
          lookup: { pipeline: 'orchard_sales' },
        },
      },
    },
  },
})
