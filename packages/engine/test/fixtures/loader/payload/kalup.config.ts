import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'depot-fixture',
  objects: {
    companies: { include: ['name'] },
  },
  targets: {
    sandbox: { portalId: 5151515 },
  },
})
