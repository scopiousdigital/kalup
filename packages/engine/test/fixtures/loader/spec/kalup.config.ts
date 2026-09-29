import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'acme-crm',
  prefix: '',
  objects: {
    companies: { include: ['name', 'domain'] },
    products: { include: ['hs_object_id', 'name', 'hs_sku'], custom: false },
    subscription: {},
  },
  targets: {
    sandbox: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } },
    production: {
      portalId: 2222222,
      protected: true,
      drift: 'hold',
      credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' }, write: { env: 'HUBSPOT_PROD_WRITE_KEY' } },
      overrides: { 'property:subscription/customer_status': { name: 'customerstatus' } },
    },
  },
})
