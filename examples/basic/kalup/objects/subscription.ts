import { defineCustomObject, type InferProperties, p } from '@kalup/core'

export const Subscription = defineCustomObject('subscription', {
  labels: { singular: 'Subscription', plural: 'Subscriptions' },
  primaryDisplayProperty: 'plan_name',
  requiredProperties: ['plan_name'],
  searchableProperties: ['plan_name'],
  groups: {
    subscription_information: { label: 'Subscription information' },
  },
  properties: {
    monthlyAmount: p.number('monthly_amount', {
      label: 'Monthly amount',
      group: 'subscription_information',
      fieldType: 'number',
    }),
    planName: p
      .string('plan_name', {
        label: 'Plan name',
        group: 'subscription_information',
        fieldType: 'text',
        hasUniqueValue: true,
      })
      .required(),
    startedOn: p.date('started_on', {
      label: 'Started on',
      group: 'subscription_information',
      fieldType: 'date',
    }),
    status: p.enum('status', {
      label: 'Status',
      group: 'subscription_information',
      fieldType: 'select',
      options: [
        { value: 'trial', label: 'Trial' },
        { value: 'paying', label: 'Paying' },
        { value: 'churned', label: 'Churned' },
      ],
    }),
  },
})

export type SubscriptionData = InferProperties<typeof Subscription.properties> & { id: string }
