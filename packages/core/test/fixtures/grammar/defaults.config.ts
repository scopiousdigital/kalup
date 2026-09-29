import { defineConfig } from 'kalup'

export default defineConfig({
  targets: {
    sandbox: {
      portalId: 3131313,
      overrides: {
        'property:crates/handling_code': {
          definition: {
            description: '',
            options: [{ value: 'std', label: 'Standard', hidden: false, description: '' }],
            hasUniqueValue: false,
            formField: false,
            lifecycle: { options: 'additive', removedOptions: [], ignoreChanges: [] },
          },
        },
        'property:crates/route': { definition: { options: [], lifecycle: {} } },
      },
    },
  },
})
