import { defineObject, type InferProperties, p } from '@kalup/core'
import { BillingMeta } from '../../src/billing'

export const Company = defineObject('companies', {
  groups: {
    billing: { label: 'Billing' },
  },
  properties: {
    // Managed. Carries its full definition.
    billingId: p.stringArray('billing_id', {
      label: 'Billing ID',
      group: 'billing',
      fieldType: 'text',
    }),

    billingMeta: p.json('billing_meta', BillingMeta, {
      label: 'Billing meta',
      group: 'billing',
      fieldType: 'textarea',
    }),

    billingStatus: p
      .enum('billing_status', {
        label: 'Billing status',
        group: 'billing',
        fieldType: 'select',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'PAST DUE', label: 'Past due', as: 'past_due' },
        ],
        lifecycle: { options: 'additive', ignoreChanges: ['description'] },
      })
      .required(),

    // Calculated. Reference, read-only in the app.
    lifetimeValue: p.number('lifetime_value').readonly(),

    // HubSpot-defined. Reference only. Never created, changed or removed.
    name: p.string('name'),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
