// Every tombstone field.

import { defineRemoved } from '@kalup/core'

export default defineRemoved({
  'group:companies/legacy': { action: 'release' },
  'property:companies/soil_kind': { action: 'destroy', reason: 'Replaced by soil_type' },
})
