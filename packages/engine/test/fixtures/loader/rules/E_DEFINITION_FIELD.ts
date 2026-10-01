import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
  },
  properties: {
    dealOwner: p.owner('deal_owner', {
      label: 'Deal owner',
      group: 'deal_terms',
      fieldType: 'select',
      options: [{ value: 'x', label: 'X' }],
    }),
    discount: p.number('discount', {
      label: 'Discount',
      group: 'deal_terms',
      fieldType: 'number',
      displayOrder: -2,
      currencyPropertyName: 'deal_currency_code',
      calculationFormula: 'amount * 2',
    }),
    fee: p.number('fee', {
      label: 'Fee',
      group: 'deal_terms',
      fieldType: 'number',
      showCurrencySymbol: true,
      currencyPropertyName: '',
    }),
    termNote: p.string('term_note', {
      label: 'Term note',
      group: 'deal_terms',
      fieldType: 'text',
      numberDisplayHint: 'percentage',
      textDisplayHint: 'multi_line',
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
