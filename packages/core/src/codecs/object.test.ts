import { describe, expect, expectTypeOf, test } from 'vitest'
import { Fleet, type FleetData, Shipment, type ShipmentData } from '../../test/fixtures/codecs/fleet.js'
import type { FleetMeta } from '../../test/fixtures/codecs/fleet-meta.js'
import { p } from './builders.js'
import type { Codec, ReadonlyCodec } from './codec.js'
import { defineObject, type InferProperties, propertyNames } from './object.js'

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

  test('defineCustomObject adds the custom-object fields', () => {
    expect(Shipment.name).toBe('shipment')
    expect(Shipment.labels).toEqual({ singular: 'Shipment', plural: 'Shipments' })
    expect(Shipment.primaryDisplayProperty).toBe('tracking_code')
    expect(Shipment.requiredProperties).toEqual(['tracking_code'])
    expect(Shipment.properties.trackingCode.definition?.hasUniqueValue).toBe(true)
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
      fleetRegions: ('eu_west' | 'apac')[] | null
      fleetScore: number | null
      fleetSize: number | null
      fleetStatus: 'active' | 'in_service' | 'retired'
      fleetSyncedAt: string | null
      fleetTags: string[] | null
      legacyCode: string | null
      lifecycleStage: 'lead' | 'customer' | null
      name: string | null
      id: string
    }>()
    expectTypeOf<ShipmentData>().branded.toEqualTypeOf<{
      status: 'packed' | 'in_transit' | null
      trackingCode: string | null
      id: string
    }>()
  })

  test('aliases replace values, options-less enums have no values', () => {
    expectTypeOf(Fleet.properties.fleetStatus.get).returns.toEqualTypeOf<'active' | 'in_service' | 'retired'>()
    expectTypeOf(Fleet.properties.fleetRegions.get).returns.toEqualTypeOf<('eu_west' | 'apac')[] | null>()
    expectTypeOf(p.enum('bare').codec.get).returns.toEqualTypeOf<null>()
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

  test('readonly makes set a type error', () => {
    expectTypeOf(Fleet.properties.fleetScore).not.toHaveProperty('set')
    // @ts-expect-error a readonly codec has no set
    Fleet.properties.fleetScore.set({}, 1)
    expectTypeOf(Fleet.properties.fleetScore).toMatchTypeOf<ReadonlyCodec<number | null>>()
    expectTypeOf(Fleet.properties.fleetSize).toMatchTypeOf<Codec<number | null>>()
  })

  test('the chain runs in canonical order only', () => {
    p.number('n').required().readonly().managed(false)
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
