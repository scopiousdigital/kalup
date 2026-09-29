import { defineConfig } from 'kalup'

export default defineConfig({
  name: 'orchard-apply',
  objects: {
    companies: {},
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
  },
})
