import { defineConfig } from 'kalup'

export default defineConfig({
  targets: {
    sandbox: {
      portalId: 4141414,
      overrides: {
        'property:deals/term_days': { name: 'amount' },
      },
    },
    production: {
      portalId: 5151515,
      overrides: {
        'property:deals/amount': { name: 'term_days' },
        'property:deals/term_days': { name: 'amount' },
      },
    },
    staging: {
      portalId: 6161616,
      overrides: {
        'property:deals/term_days': { name: 'term_days' },
      },
    },
  },
})
