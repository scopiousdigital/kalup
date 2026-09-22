import { defineCustomObject, defineObject, type InferProperties, p } from '../../../src/codecs/index.js'
import { fleetMeta } from './fleet-meta.js'

// One property per builder, plus every reference and chain form.
export const Fleet = defineObject('companies', {
  groups: {
    fleet: { label: 'Fleet' },
  },
  properties: {
    fleetActive: p.boolean('fleet_active', { label: 'Fleet active', group: 'fleet', fieldType: 'booleancheckbox' }),
    fleetAuditDate: p.date('fleet_audit_date', { label: 'Fleet audit date', group: 'fleet', fieldType: 'date' }),
    fleetMeta: p.json('fleet_meta', fleetMeta, { label: 'Fleet meta', group: 'fleet', fieldType: 'textarea' }),
    fleetRegions: p.multiEnum('fleet_regions', {
      label: 'Fleet regions',
      group: 'fleet',
      fieldType: 'checkbox',
      options: [
        { value: 'EU West', label: 'EU West', as: 'eu_west' },
        { value: 'apac', label: 'APAC' },
      ],
    }),
    // Calculated. Reference, read-only in the app.
    fleetScore: p.number('fleet_score').readonly(),
    fleetSize: p.number('fleet_size', { label: 'Fleet size', group: 'fleet', fieldType: 'number' }),
    fleetStatus: p
      .enum('fleet_status', {
        label: 'Fleet status',
        group: 'fleet',
        fieldType: 'select',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'IN SERVICE', label: 'In service', as: 'in_service' },
          { value: 'retired', label: 'Retired', hidden: true },
        ],
        lifecycle: { options: 'additive', ignoreChanges: ['description'] },
      })
      .required(),
    fleetSyncedAt: p.datetime('fleet_synced_at', { label: 'Fleet synced at', group: 'fleet', fieldType: 'date' }),
    fleetTags: p.stringArray('fleet_tags', { label: 'Fleet tags', group: 'fleet', fieldType: 'text' }),
    // Kept for reference, out of plan and apply.
    legacyCode: p.string('legacy_code', { label: 'Legacy code', group: 'fleet', fieldType: 'text' }).managed(false),
    // HubSpot-defined enum. Options exist only for typing.
    lifecycleStage: p.enum('lifecyclestage', {
      options: [
        { value: 'lead', label: 'Lead' },
        { value: 'customer', label: 'Customer' },
      ],
    }),
    // HubSpot-defined. Reference only.
    name: p.string('name'),
  },
})

export type FleetData = InferProperties<typeof Fleet.properties> & { id: string }

export const Shipment = defineCustomObject('shipment', {
  labels: { singular: 'Shipment', plural: 'Shipments' },
  primaryDisplayProperty: 'tracking_code',
  requiredProperties: ['tracking_code'],
  groups: { shipment_information: { label: 'Shipment information' } },
  properties: {
    status: p.enum('status', {
      label: 'Status',
      group: 'shipment_information',
      fieldType: 'select',
      options: [
        { value: 'packed', label: 'Packed' },
        { value: 'in_transit', label: 'In transit' },
      ],
    }),
    trackingCode: p.string('tracking_code', {
      label: 'Tracking code',
      group: 'shipment_information',
      fieldType: 'text',
      hasUniqueValue: true,
    }),
  },
})

export type ShipmentData = InferProperties<typeof Shipment.properties> & { id: string }
