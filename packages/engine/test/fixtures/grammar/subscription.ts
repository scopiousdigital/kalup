import { defineCustomObject, type InferProperties, p } from '@kalup/core'

export const Subscription = defineCustomObject('subscription', {
  labels: { singular: 'Subscription', plural: 'Subscriptions' },
  primaryDisplayProperty: 'name',
  requiredProperties: ['name'],
  groups: {
    subscription_information: { label: 'Subscription information' },
  },
  properties: {
    customerStatus: p.enum('customer_status', {
      label: 'Customer status',
      group: 'subscription_information',
      fieldType: 'select',
      options: [
        { value: 'trial', label: 'Trial' },
        { value: 'paying', label: 'Paying' },
      ],
    }),
    name: p.string('name', {
      label: 'Name',
      group: 'subscription_information',
      fieldType: 'text',
    }),
  },
})

export type SubscriptionData = InferProperties<typeof Subscription.properties> & { id: string }
