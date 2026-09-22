import { defineObject, type InferProperties, p } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: {
    billing: { label: 'Billing' },
  },
  properties: {
    billingNotes: p.string('billing_notes', {
      label: 'Billing notes',
      group: 'billing',
      fieldType: 'textarea',
      formField: true,
    }),
    // Set by the billing sync. Do not edit by hand.
    billingStatus: p.enum('billing_status', {
      label: 'Billing status',
      group: 'billing',
      fieldType: 'select',
      description: 'Set by the billing sync',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'PAST DUE', label: 'Past due', as: 'past_due' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    }),
    domain: p.string('domain'),
    name: p.string('name'),
    renewalDate: p.date('renewal_date', {
      label: 'Renewal date',
      group: 'billing',
      fieldType: 'date',
    }),
    seatCount: p.number('seat_count', {
      label: 'Seat count',
      group: 'billing',
      fieldType: 'number',
    }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
