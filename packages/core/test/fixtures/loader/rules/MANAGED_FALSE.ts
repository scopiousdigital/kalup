import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    deal_terms: { label: 'Deal terms' },
  },
  properties: {
    // Kept for reference. Every definition rule still applies; only plan and apply leave it out.
    kind: p
      .enum('kind', {
        label: 'Kind',
        group: 'other',
        fieldType: 'checkbox',
        options: [{ value: 'x', label: 'X' }],
        lifecycle: { removedOptions: ['x'], ignoreChanges: ['nope'], preventDestroy: true },
      })
      .managed(false),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
