import { defineConfig } from 'kalup'

export default defineConfig({
  name: 'depot-fixture',
  objects: {
    companies: { include: ['name'] },
  },
  targets: {
    sandbox: { portalId: 5151515 },
  },
})
