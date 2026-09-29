// Written by kalup rm. Apply deletes or releases each entry in the targets that allow it.

import { defineRemoved } from '@kalup/core'

export default defineRemoved({
  'group:companies/old_billing': { action: 'release' },
  'property:companies/legacy_score': { action: 'destroy', reason: 'Replaced by lead_score' },
  'property:companies/renewal_notes_from_the_previous_account_manager': {
    action: 'destroy',
    reason: 'Moved to the renewal notes on the deal record',
  },
})
