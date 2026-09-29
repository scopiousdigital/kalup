import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'basic',
  objects: {
    companies: { include: ['name', 'domain'] },
    subscription: {},
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
    production: {
      portalId: 2222222,
      protected: true,
      credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } },
    },
  },
})
