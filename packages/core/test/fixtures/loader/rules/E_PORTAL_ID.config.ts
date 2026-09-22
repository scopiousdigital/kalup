import { defineConfig } from 'kalup'

export default defineConfig({
  targets: {
    missing: {},
    zero: { portalId: 0 },
    fraction: { portalId: 12.5 },
    negative: { portalId: -3 },
    sandbox: { portalId: 4141414 },
  },
})
