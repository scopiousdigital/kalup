import { defineConfig } from 'kalup'

export default defineConfig({
  name: 'orchard-crm',
  objects: {
    companies: { include: ['name'] },
    harvest: {},
  },
  targets: {
    sandbox: {
      portalId: 3131313,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
  },
})
