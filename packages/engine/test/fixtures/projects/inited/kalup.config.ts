import { defineConfig } from '@kalup/core'

export default defineConfig({
  objects: {
    companies: { associations: true },
    harvest: { associations: true },
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      credentials: { read: { env: 'HUBSPOT_SERVICE_KEY' } },
    },
  },
})
