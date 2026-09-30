// Every config field, at every level it is allowed.

import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'orchard-crm',
  dir: 'lib/config/hubspot',
  state: 'repo',
  prefix: 'orch_',
  defaultTarget: 'sandbox',
  mode: 'takeover',
  objects: {
    companies: {
      mode: 'takeover',
      include: ['name', 'lifecyclestage'],
      exclude: ['zi_*', 'orch_legacy'],
      custom: false,
      as: 'Firm',
    },
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      mode: 'addon',
      protected: true,
      drift: 'overwrite',
      adopt: 'overwrite',
      allowDestroy: true,
      yesLimit: 100,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' }, write: { env: 'HUBSPOT_SANDBOX_WRITE_KEY' } },
      objects: {
        companies: { mode: 'takeover' },
      },
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
            hidden: false,
            displayOrder: -1,
            numberDisplayHint: 'percentage',
            showCurrencySymbol: true,
            currencyPropertyName: 'orch_currency',
            textDisplayHint: 'multi_line',
            calculationFormula: 'orch_rows * 2',
            dataSensitivity: 'non_sensitive',
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
