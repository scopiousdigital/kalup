import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'orchard-broken',
  prefix: 'orc_',
  objects: {
    companies: {},
  },
  targets: {
    sandbox: {
      portalId: 3131313,
    },
  },
})
