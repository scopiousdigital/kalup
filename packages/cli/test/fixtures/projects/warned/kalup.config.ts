import { defineConfig } from 'kalup'

export default defineConfig({
  name: 'orchard-warned',
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
