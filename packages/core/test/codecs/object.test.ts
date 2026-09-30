import { describe, expect, expectTypeOf, test } from 'vitest'
import type { Unlisted } from '../../src/codecs/builders.js'
import { p } from '../../src/codecs/builders.js'
import type { Codec, ReadonlyCodec } from '../../src/codecs/codec.js'
import {
  type DefinedObject,
  defineCustomObject,
  defineObject,
  type InferProperties,
  type PropertyName,
  propertyNames,
} from '../../src/codecs/object.js'
import { Fleet, type FleetData, Shipment, type ShipmentData } from '../fixtures/codecs/fleet.js'
import { type FleetMeta, fleetMeta } from '../fixtures/codecs/fleet-meta.js'

describe('defineObject', () => {
  test('carries name, groups and the codecs', () => {
    expect(Fleet.name).toBe('companies')
    expect(Fleet.groups).toEqual({ fleet: { label: 'Fleet' } })
    expect(Fleet.properties.fleetSize.property).toBe('fleet_size')
    expect(Object.keys(Fleet.properties)).toHaveLength(12)
  })

  test('groups default to empty', () => {
    expect(defineObject('contacts', { properties: { email: p.string('email') } }).groups).toEqual({})
  })

  // The canonical writer leaves out an empty properties block, as rm leaves an object whose last property it took.
  test('properties default to none, so an export the writer leaves as {} still types and runs', () => {
    const Deal = defineObject('deals', {})
    expect(Deal.properties).toEqual({})
    expectTypeOf<InferProperties<typeof Deal.properties>>().toEqualTypeOf<Record<never, never>>()
    const Plot = defineCustomObject('plot', {
      labels: { singular: 'Plot', plural: 'Plots' },
      primaryDisplayProperty: 'plot_code',
      groups: { plots: { label: 'Plots' } },
    })
    expect(Plot.properties).toEqual({})
    expect(Plot.groups).toEqual({ plots: { label: 'Plots' } })
  })

  test('defineCustomObject adds the custom-object fields', () => {
    expect(Shipment.name).toBe('shipment')
    expect(Shipment.labels).toEqual({ singular: 'Shipment', plural: 'Shipments' })
    expect(Shipment.primaryDisplayProperty).toBe('tracking_code')
    expect(Shipment.requiredProperties).toEqual(['tracking_code'])
    expect(Shipment.properties.trackingCode.definition?.hasUniqueValue).toBe(true)
  })

  test('defineCustomObject carries searchableProperties and secondaryDisplayProperties when given', () => {
    const Invoice = defineCustomObject('invoice', {
      labels: { singular: 'Invoice', plural: 'Invoices' },
      primaryDisplayProperty: 'invoice_number',
      searchableProperties: ['invoice_number'],
      secondaryDisplayProperties: ['due_date'],
      properties: { invoiceNumber: p.string('invoice_number') },
    })
    expect(Invoice.searchableProperties).toEqual(['invoice_number'])
    expect(Invoice.secondaryDisplayProperties).toEqual(['due_date'])
    expect(Shipment.searchableProperties).toBeUndefined()
    expect(Shipment.secondaryDisplayProperties).toBeUndefined()
  })

  test('propertyNames lists the internal names', () => {
    expect(propertyNames(Shipment)).toEqual(['status', 'tracking_code'])
    expect(propertyNames(Fleet)).toContain('fleet_status')
  })
})

describe('types', () => {
  test('InferProperties maps every key to the codec value type', () => {
    expectTypeOf<FleetData>().branded.toEqualTypeOf<{
      fleetActive: boolean | null
      fleetAuditDate: string | null
      fleetMeta: FleetMeta | null
      fleetRegions: ('eu_west' | 'apac' | Unlisted)[] | null
      fleetScore: number | null
      fleetSize: number | null
      fleetStatus: 'active' | 'in_service' | 'retired'
      fleetSyncedAt: string | null
      fleetTags: string[] | null
      legacyCode: string | null
      lifecycleStage: 'lead' | 'customer' | Unlisted | null
      name: string | null
      id: string
    }>()
    expectTypeOf<ShipmentData>().branded.toEqualTypeOf<{
      status: 'packed' | 'in_transit' | Unlisted | null
      trackingCode: string | null
      id: string
    }>()
  })

  test('aliases replace values; a lenient enum adds Unlisted, a strict one lists the aliases alone', () => {
    expectTypeOf(Fleet.properties.fleetStatus.get).returns.toEqualTypeOf<'active' | 'in_service' | 'retired'>()
    expectTypeOf(Fleet.properties.fleetRegions.get).returns.toEqualTypeOf<('eu_west' | 'apac' | Unlisted)[] | null>()
    expectTypeOf(p.enum('bare').codec.get).returns.toEqualTypeOf<Unlisted | null>()
    expectTypeOf(p.multiEnum('bare').codec.get).returns.toEqualTypeOf<Unlisted[] | null>()
    const options = [{ value: 'a', label: 'A', as: 'alpha' }] as const
    expectTypeOf(p.enum('x', { options }).strict().codec.get).returns.toEqualTypeOf<'alpha' | null>()
    expectTypeOf(p.multiEnum('x', { options }).strict().codec.get).returns.toEqualTypeOf<'alpha'[] | null>()
    expectTypeOf(p.enum('x', { options }).strict().required().codec.get).returns.toEqualTypeOf<'alpha'>()
  })

  test('a lenient set takes a listed alias or an Unlisted value, never a plain string', () => {
    const tier = p.enum('tier', { options: [{ value: 'gold', label: 'Gold' }] }).codec
    expectTypeOf(tier.set).parameter(1).toEqualTypeOf<'gold' | Unlisted | null | undefined>()
    const stored = tier.get({ tier: 'platinum' })
    tier.set({}, stored)
    tier.set({}, 'gold')
    // @ts-expect-error a plain string is neither a listed alias nor a value read back
    tier.set({}, 'platinum' as string)
    const strict = p.enum('tier', { options: [{ value: 'gold', label: 'Gold' }] }).strict().codec
    expectTypeOf(strict.set).parameter(1).toEqualTypeOf<'gold' | null | undefined>()
  })

  test('required drops null from get and keeps set nullable', () => {
    expectTypeOf(Fleet.properties.fleetSize.get).returns.toEqualTypeOf<number | null>()
    expectTypeOf(Fleet.properties.fleetSize.set).parameter(1).toEqualTypeOf<number | null | undefined>()
    expectTypeOf(Fleet.properties.fleetStatus.get).returns.not.toEqualTypeOf<
      'active' | 'in_service' | 'retired' | null
    >()
    expectTypeOf(Fleet.properties.fleetStatus.set)
      .parameter(1)
      .toEqualTypeOf<'active' | 'in_service' | 'retired' | null | undefined>()
  })

  test('each codec carries its internal name as a literal type', () => {
    expectTypeOf(Fleet.properties.fleetSize.property).toEqualTypeOf<'fleet_size'>()
    expectTypeOf(Fleet.properties.fleetStatus.property).toEqualTypeOf<'fleet_status'>()
    expectTypeOf(Fleet.properties.fleetScore.property).toEqualTypeOf<'fleet_score'>()
    expectTypeOf(Fleet.properties.legacyCode.property).toEqualTypeOf<'legacy_code'>()
    expectTypeOf(p.json('route', fleetMeta).codec.property).toEqualTypeOf<'route'>()
    const dynamic: string = 'route'
    expectTypeOf(p.string(dynamic).codec.property).toEqualTypeOf<string>()
  })

  test('PropertyName is the union of internal names, and propertyNames returns it', () => {
    expectTypeOf<PropertyName<typeof Shipment>>().toEqualTypeOf<'status' | 'tracking_code'>()
    expectTypeOf(propertyNames(Shipment)).toEqualTypeOf<('status' | 'tracking_code')[]>()
    expectTypeOf<PropertyName<typeof Fleet>>().toEqualTypeOf<
      | 'fleet_active'
      | 'fleet_audit_date'
      | 'fleet_meta'
      | 'fleet_regions'
      | 'fleet_score'
      | 'fleet_size'
      | 'fleet_status'
      | 'fleet_synced_at'
      | 'fleet_tags'
      | 'legacy_code'
      | 'lifecyclestage'
      | 'name'
    >()
    expectTypeOf<PropertyName<DefinedObject<Record<never, never>>>>().toBeNever()
    // A raw bag keyed by the names still passes to get, and a typo is caught.
    const bag: Record<PropertyName<typeof Shipment>, string | null> = { status: 'packed', tracking_code: null }
    Shipment.properties.status.get(bag)
    // @ts-expect-error trackingCode is the app-side key, not the internal name
    const typo: Partial<Record<PropertyName<typeof Shipment>, string>> = { trackingCode: 'T-1' }
    expect(typo).toBeDefined()
  })

  test('clear is on a nullable codec and refused on a required or readonly one', () => {
    expectTypeOf(Fleet.properties.fleetSize.clear).toEqualTypeOf<(properties: Record<string, string>) => void>()
    expectTypeOf(Fleet.properties.fleetStatus.clear).toBeNever()
    // @ts-expect-error a required codec cannot be cleared
    Fleet.properties.fleetStatus.clear({})
    // @ts-expect-error a readonly codec has neither set nor clear
    Fleet.properties.fleetScore.clear({})
  })

  test('readonly makes set a type error', () => {
    expectTypeOf(Fleet.properties.fleetScore).not.toHaveProperty('set')
    // @ts-expect-error a readonly codec has no set
    Fleet.properties.fleetScore.set({}, 1)
    expectTypeOf(Fleet.properties.fleetScore).toMatchTypeOf<ReadonlyCodec<number | null>>()
    expectTypeOf(Fleet.properties.fleetSize).toMatchTypeOf<Codec<number | null>>()
  })

  test('the chain runs in canonical order only', () => {
    p.number('n').required().readonly().managed(false)
    p.enum('e').strict().required().readonly().managed(false)
    // strict is for p.enum and p.multiEnum only, it comes first, and it cannot repeat.
    expectTypeOf(p.string('s')).not.toHaveProperty('strict')
    expectTypeOf(p.enum('e').required()).not.toHaveProperty('strict')
    expectTypeOf(p.multiEnum('e').strict()).not.toHaveProperty('strict')
    // @ts-expect-error required comes before readonly
    p.number('n').readonly().required()
    // @ts-expect-error managed(false) ends the chain
    p.number('n').managed(false).required()
    // @ts-expect-error managed(true) is not a chain call
    p.number('n').managed(true)
    // @ts-expect-error required cannot repeat
    p.number('n').required().required()
  })

  test('a definition is all or nothing', () => {
    // @ts-expect-error an empty object is neither a definition nor a reference
    p.string('x', {})
    // @ts-expect-error an empty object is neither a definition nor a reference
    p.enum('x', {})
    // @ts-expect-error group without label
    p.string('x', { group: 'fleet', fieldType: 'text' })
    // @ts-expect-error label without group and fieldType
    p.number('x', { label: 'X' })
    // @ts-expect-error options alone are not a definition on a non-enum builder
    p.string('x', { options: [{ value: 'a', label: 'A' }] })
    // @ts-expect-error an enum reference carries options and nothing else
    p.enum('x', { group: 'fleet', options: [{ value: 'a', label: 'A' }] })
    // @ts-expect-error an enum reference carries options and nothing else
    p.multiEnum('x', { options: [{ value: 'a', label: 'A' }], description: 'd' })
  })

  test('a definition rejects unknown fields', () => {
    // @ts-expect-error bogus is not a definition field
    p.string('x', { label: 'X', group: 'g', fieldType: 'text', bogus: 1 })
  })

  test('InferProperties accepts an object built inline', () => {
    const Truck = defineObject('trucks', {
      properties: {
        plate: p.string('plate').required(),
        axles: p.number('axles'),
      },
    })
    expectTypeOf<InferProperties<typeof Truck.properties>>().toEqualTypeOf<{ plate: string; axles: number | null }>()
  })
})
