import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'orchard-crm',
  objects: {
    companies: { include: ['name', 'lifecyclestage'] },
    harvest: {},
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
  },
})
