// Explicit values equal to HubSpot's defaults. A field that is present is owned, so the writer keeps every one.

import { defineObject, type InferProperties, p } from '@kalup/core'

export const Crate = defineObject('crates', {
  groups: {
    handling: { label: 'Handling' },
  },
  properties: {
    // A reference with typed options, none of them yet.
    crateKind: p.enum('crate_kind', {
      options: [],
    }),
    fragile: p.boolean('fragile', {
      label: 'Fragile',
      group: 'handling',
      fieldType: 'booleancheckbox',
      description: '',
      hasUniqueValue: false,
      formField: false,
    }),
    handlingCode: p.enum('handling_code', {
      label: 'Handling code',
      group: 'handling',
      fieldType: 'select',
      description: '',
      options: [
        { value: 'std', label: 'Standard', hidden: false, description: '' },
        { value: 'COLD', label: 'Cold chain', as: 'cold', hidden: false },
      ],
      lifecycle: { options: 'additive', removedOptions: [], ignoreChanges: [] },
    }),
    route: p.enum('route', {
      label: 'Route',
      group: 'handling',
      fieldType: 'radio',
      options: [],
      lifecycle: {},
    }),
  },
})

export type CrateData = InferProperties<typeof Crate.properties> & { id: string }
