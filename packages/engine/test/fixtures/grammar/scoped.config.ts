// The pull scope for the demo portal.

import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'demo-crm',
  defaultTarget: 'sandbox',
  objects: {
    companies: { include: ['name', 'domain'] },
    products: {
      include: [
        'hs_object_id',
        'name',
        'hs_sku',
        'description',
        'price',
        'hs_cost_of_goods_sold',
        'hs_recurring_billing_period',
        'hs_recurring_billing_start_date',
        'hs_product_type',
        'hs_folder_id',
      ],
      custom: false,
    },
    subscription: {},
  },
  targets: {
    sandbox: {
      portalId: 3333333,
    },
  },
})
