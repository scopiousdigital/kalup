import { defineCustomObject, defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
    deal_terms_eu: { label: 'Deal terms (EU)' },
  },
  properties: {
    amount: p.number('amount'),
    paymentTerms: p.enum('payment_terms', {
      label: 'Payment terms',
      group: 'deal_terms',
      fieldType: 'select',
      options: [
        { value: 'net30', label: 'Net 30' },
        { value: 'NET 60', label: 'Net 60', as: 'net60' },
      ],
    }),
    sealed: p.string('sealed', { label: 'Sealed', group: 'deal_terms', fieldType: 'text' }).managed(false),
    stage: p.enum('stage', { options: [{ value: 'open', label: 'Open' }] }),
    termDays: p.number('term_days', {
      label: 'Term days',
      group: 'deal_terms',
      fieldType: 'number',
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }

export const Crate = defineCustomObject('crate', {
  labels: { singular: 'Crate', plural: 'Crates' },
  primaryDisplayProperty: 'crate_code',
  properties: {
    crateCode: p.string('crate_code'),
  },
})

export type CrateData = InferProperties<typeof Crate.properties> & { id: string }
