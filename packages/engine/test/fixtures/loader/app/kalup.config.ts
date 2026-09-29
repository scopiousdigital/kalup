import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'parcel-app',
  objects: {
    parcel: {},
    deals: { include: ['amount', 'dealstage'] },
  },
  targets: {
    sandbox: { portalId: 3131313 },
  },
})
