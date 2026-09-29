import { defineConfig } from 'kalup'

export default defineConfig({
  targets: {
    sandbox: { portalId: 4141414 },
    staging: { portalId: 5151515 },
    qa: { portalId: 4141414 },
    review: { portalId: 4141414, allowDestroy: true },
  },
})
