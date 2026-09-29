import { defineCustomObject, defineObject, type InferProperties, p } from '@kalup/core'
import { parcelMeta } from '../../src/parcel-meta.js'

// One property per builder, every chain form, a quoted key, and both reference forms. Read as text by the loader
// and executed by vitest against the built @kalup/core.
export const Parcel = defineCustomObject('parcel', {
  labels: { singular: 'Parcel', plural: 'Parcels' },
  primaryDisplayProperty: 'tracking_code',
  requiredProperties: ['tracking_code'],
  groups: {
    parcel_details: { label: 'Parcel details' },
    routing: { label: 'Routing' },
  },
  properties: {
    fragile: p.boolean('fragile', {
      label: 'Fragile',
      group: 'parcel_details',
      fieldType: 'booleancheckbox',
      formField: true,
    }),
    handling: p.multiEnum('handling', {
      label: 'Handling',
      group: 'routing',
      fieldType: 'checkbox',
      options: [
        { value: 'cold', label: 'Cold chain', as: 'coldChain' },
        { value: 'signature', label: 'Signature' },
      ],
    }),
    // Kept for reference, out of plan and apply.
    legacyRef: p
      .string('legacy_ref', {
        label: 'Legacy reference',
        group: 'parcel_details',
        fieldType: 'text',
        lifecycle: { preventDestroy: true },
      })
      .managed(false),
    meta: p.json('meta', parcelMeta, {
      label: 'Meta',
      group: 'parcel_details',
      fieldType: 'textarea',
    }),
    'route-codes': p.stringArray('route_codes', {
      label: 'Route codes',
      group: 'routing',
      fieldType: 'text',
    }),
    scannedAt: p.datetime('scanned_at', {
      label: 'Scanned at',
      group: 'routing',
      fieldType: 'date',
    }),
    shippedOn: p.date('shipped_on', {
      label: 'Shipped on',
      group: 'routing',
      fieldType: 'date',
    }),
    status: p
      .enum('status', {
        label: 'Status',
        group: 'routing',
        fieldType: 'select',
        options: [
          { value: 'packed', label: 'Packed' },
          { value: 'IN TRANSIT', label: 'In transit', as: 'in_transit' },
          { value: 'lost', label: 'Lost', hidden: true, description: 'Claim opened' },
        ],
        lifecycle: {
          options: 'exact',
          removedOptions: ['returned'],
          ignoreChanges: ['description'],
          preventDestroy: true,
        },
      })
      .required(),
    // Set by the scanner. Never edited by hand.
    trackingCode: p
      .string('tracking_code', {
        label: 'Tracking code',
        group: 'parcel_details',
        fieldType: 'text',
        hasUniqueValue: true,
      })
      .required()
      .readonly(),
    // Calculated. Reference, read-only in the app.
    volumeScore: p.number('volume_score').readonly(),
    weightKg: p.number('weight_kg', {
      label: 'Weight (kg)',
      group: 'parcel_details',
      fieldType: 'number',
      description: 'Gross weight',
    }),
  },
})

export type ParcelData = InferProperties<typeof Parcel.properties> & { id: string }

export const Deal = defineObject('deals', {
  properties: {
    amount: p.number('amount'),
    // HubSpot-defined enum. Options exist only for typing.
    stage: p.enum('dealstage', {
      options: [
        { value: 'appointmentscheduled', label: 'Appointment scheduled', as: 'scheduled' },
        { value: 'closedwon', label: 'Closed won' },
      ],
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
