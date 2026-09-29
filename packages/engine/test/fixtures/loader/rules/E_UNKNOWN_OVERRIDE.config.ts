import { defineConfig } from '@kalup/core'

export default defineConfig({
  targets: {
    sandbox: {
      portalId: 4141414,
      overrides: {
        'property:deals/amount': { skip: true },
        'property:deals/discount': { name: 'discount_pct' },
      },
    },
  },
})
