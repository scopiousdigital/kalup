import { defineConfig } from '@kalup/core'

export default defineConfig({
  objects: {
    companies: {},
    harvest: {},
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      credentials: { read: { env: 'HUBSPOT_SERVICE_KEY' } },
    },
  },
})
