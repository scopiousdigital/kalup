import { defineObject, type InferProperties, p } from '@kalup/core'
import { depotMeta } from '../../src/depot-meta'

// Every create-body field set on every managed property, so the payload must carry each one. properties.json and
// groups.json beside this project hold the same resources as the API returns them.
export const Depot = defineObject('companies', {
  groups: {
    depot: { label: 'Depot' },
  },
  properties: {
    depotActive: p.boolean('depot_active', {
      label: 'Depot active',
      group: 'depot',
      fieldType: 'booleancheckbox',
      description: 'Cleared for dispatch',
      hasUniqueValue: false,
      formField: true,
    }),
    depotCapacity: p.number('depot_capacity', {
      label: 'Depot capacity',
      group: 'depot',
      fieldType: 'number',
      description: 'Pallet slots',
      hasUniqueValue: false,
      formField: false,
    }),
    depotCode: p.string('depot_code', {
      label: 'Depot code',
      group: 'depot',
      fieldType: 'text',
      description: 'Short code from the routing system',
      hasUniqueValue: true,
      formField: false,
    }),
    depotMeta: p.json('depot_meta', depotMeta, {
      label: 'Depot meta',
      group: 'depot',
      fieldType: 'textarea',
      description: 'Opening hours as JSON',
      hasUniqueValue: false,
      formField: false,
    }),
    depotOpenedOn: p.date('depot_opened_on', {
      label: 'Depot opened on',
      group: 'depot',
      fieldType: 'date',
      description: 'First day of operation',
      hasUniqueValue: false,
      formField: false,
    }),
    depotRegion: p.enum('depot_region', {
      label: 'Depot region',
      group: 'depot',
      fieldType: 'select',
      description: 'Sales region the depot serves',
      options: [
        { value: 'north', label: 'North', hidden: false, description: 'Above the river' },
        { value: 'SOUTH', label: 'South', as: 'south', hidden: false, description: 'Below the river' },
        { value: 'closed', label: 'Closed', hidden: true, description: 'No longer served' },
      ],
      hasUniqueValue: false,
      formField: false,
    }),
    depotServices: p.multiEnum('depot_services', {
      label: 'Depot services',
      group: 'depot',
      fieldType: 'checkbox',
      description: 'Services offered on site',
      options: [
        { value: 'cold', label: 'Cold storage', hidden: false, description: 'Chilled and frozen' },
        { value: 'customs', label: 'Customs', hidden: false, description: 'Bonded area' },
      ],
      hasUniqueValue: false,
      formField: false,
    }),
    depotSyncedAt: p.datetime('depot_synced_at', {
      label: 'Depot synced at',
      group: 'depot',
      fieldType: 'date',
      description: 'Last sync from the routing system',
      hasUniqueValue: false,
      formField: false,
    }),
    depotTags: p.stringArray('depot_tags', {
      label: 'Depot tags',
      group: 'depot',
      fieldType: 'text',
      description: 'Comma-separated tags',
      hasUniqueValue: false,
      formField: false,
    }),
    // HubSpot-defined. Reference only.
    name: p.string('name'),
  },
})

export type DepotData = InferProperties<typeof Depot.properties> & { id: string }
