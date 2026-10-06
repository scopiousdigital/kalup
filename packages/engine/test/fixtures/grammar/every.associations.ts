// Every associations file field.

import { defineAssociations } from '@kalup/core'

// The labels between the objects.
export const Associations = defineAssociations({
  // Every association field.
  grower: { from: 'harvest', to: 'companies', name: 'harvest_grower', label: 'Grower', inverseLabel: 'Grown harvest' },
  plain: { from: 'harvest', to: 'contacts', name: 'harvest_to_contact' },
})
