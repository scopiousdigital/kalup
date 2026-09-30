import { describe, expect, test } from 'vitest'
import { p } from '../../src/codecs/builders.js'
import { Fleet } from '../fixtures/codecs/fleet.js'
import { fleetMeta } from '../fixtures/codecs/fleet-meta.js'

const { properties: c } = Fleet
const strictRegions = p
  .multiEnum('fleet_regions', {
    options: [
      { value: 'EU West', label: 'EU West', as: 'eu_west' },
      { value: 'apac', label: 'APAC' },
    ],
  })
  .strict().codec
const strictStage = p.enum('lifecyclestage', { options: [{ value: 'lead', label: 'Lead' }] }).strict().codec

// Wire errors name the property, then the value.
const FLEET_SIZE_TWELVE = /fleet_size.*twelve/
const FLEET_ACTIVE_YES = /fleet_active.*yes/
const FLEET_STATUS_BOGUS = /fleet_status.*bogus/
const FLEET_REGIONS_MARS = /fleet_regions.*mars/
const LIFECYCLESTAGE_EVANGELIST = /lifecyclestage.*evangelist/
const FLEET_META_DEPOT = /fleet_meta.*depot/
const LAZY_SYNCHRONOUSLY = /lazy.*synchronously/

function roundTrip<T>(
  codec: { get: (bag: Record<string, string | null>) => T; set: (bag: Record<string, string>, v: T) => void },
  value: T,
) {
  const bag: Record<string, string> = {}
  codec.set(bag, value)
  return { bag, back: codec.get(bag) }
}

describe('round trip', () => {
  test('string', () => {
    expect(roundTrip(c.name, 'Acme Haulage')).toEqual({ bag: { name: 'Acme Haulage' }, back: 'Acme Haulage' })
  })

  test('number', () => {
    expect(roundTrip(c.fleetSize, 12.5)).toEqual({ bag: { fleet_size: '12.5' }, back: 12.5 })
    expect(c.fleetSize.get({ fleet_size: '0' })).toBe(0)
  })

  test('boolean', () => {
    expect(roundTrip(c.fleetActive, true)).toEqual({ bag: { fleet_active: 'true' }, back: true })
    expect(roundTrip(c.fleetActive, false)).toEqual({ bag: { fleet_active: 'false' }, back: false })
  })

  test('date and datetime pass through', () => {
    expect(roundTrip(c.fleetAuditDate, '2026-09-22')).toEqual({
      bag: { fleet_audit_date: '2026-09-22' },
      back: '2026-09-22',
    })
    const at = '2026-09-22T10:15:00.000Z'
    expect(roundTrip(c.fleetSyncedAt, at)).toEqual({ bag: { fleet_synced_at: at }, back: at })
  })

  test('enum maps value to alias and back', () => {
    expect(roundTrip(c.fleetStatus, 'in_service')).toEqual({ bag: { fleet_status: 'IN SERVICE' }, back: 'in_service' })
    expect(roundTrip(c.fleetStatus, 'active')).toEqual({ bag: { fleet_status: 'active' }, back: 'active' })
    expect(c.fleetStatus.enumValues).toEqual({ active: 'active', 'IN SERVICE': 'in_service', retired: 'retired' })
  })

  test('multiEnum', () => {
    expect(roundTrip(c.fleetRegions, ['eu_west', 'apac'])).toEqual({
      bag: { fleet_regions: 'EU West;apac' },
      back: ['eu_west', 'apac'],
    })
  })

  test('stringArray', () => {
    expect(roundTrip(c.fleetTags, ['a', 'b'])).toEqual({ bag: { fleet_tags: 'a,b' }, back: ['a', 'b'] })
  })

  test('json with a hand-rolled Standard Schema', () => {
    const meta = { depot: 'north', trucks: 3 }
    expect(roundTrip(c.fleetMeta, meta)).toEqual({ bag: { fleet_meta: '{"depot":"north","trucks":3}' }, back: meta })
  })
})

describe('empty values', () => {
  test.each([
    ['name', c.name],
    ['fleetSize', c.fleetSize],
    ['fleetActive', c.fleetActive],
    ['fleetAuditDate', c.fleetAuditDate],
    ['fleetSyncedAt', c.fleetSyncedAt],
    ['fleetRegions', c.fleetRegions],
    ['fleetTags', c.fleetTags],
    ['fleetMeta', c.fleetMeta],
    ['lifecycleStage', c.lifecycleStage],
  ])('%s reads missing, null, empty and whitespace as null', (_, codec) => {
    expect(codec.get({})).toBeNull()
    expect(codec.get({ [codec.property]: null })).toBeNull()
    expect(codec.get({ [codec.property]: '' })).toBeNull()
    expect(codec.get({ [codec.property]: '  \n' })).toBeNull()
  })

  test('set with null or undefined leaves the bag untouched', () => {
    const bag = { name: 'kept' }
    c.name.set(bag, null)
    c.name.set(bag, undefined)
    expect(bag).toEqual({ name: 'kept' })
  })

  test('a non-empty string is not trimmed', () => {
    expect(c.name.get({ name: ' Acme ' })).toBe(' Acme ')
  })

  test('an empty array writes an empty string and reads back as null', () => {
    expect(roundTrip(c.fleetRegions, [])).toEqual({ bag: { fleet_regions: '' }, back: null })
    expect(roundTrip(c.fleetTags, [])).toEqual({ bag: { fleet_tags: '' }, back: null })
  })

  test('the phantom type is not an own property', () => {
    expect('~type' in c.name).toBe(false)
  })
})

describe('required', () => {
  test('get throws when the value is missing or blank', () => {
    expect(() => c.fleetStatus.get({})).toThrow('fleet_status')
    expect(() => c.fleetStatus.get({ fleet_status: '' })).toThrow('fleet_status')
  })

  test('get returns the value when present', () => {
    expect(c.fleetStatus.get({ fleet_status: 'active' })).toBe('active')
  })

  test('a required reference throws on blank too', () => {
    const name = p.string('name').required().codec
    expect(() => name.get({ name: ' ' })).toThrow("'name'")
    expect(name.get({ name: 'Acme' })).toBe('Acme')
  })
})

describe('invalid wire values', () => {
  test('number throws on NaN', () => {
    expect(() => c.fleetSize.get({ fleet_size: 'twelve' })).toThrow(FLEET_SIZE_TWELVE)
  })

  test('boolean throws on anything but true or false', () => {
    expect(() => c.fleetActive.get({ fleet_active: 'yes' })).toThrow(FLEET_ACTIVE_YES)
  })

  test('a strict enum throws naming the property and the value', () => {
    expect(() => c.fleetStatus.get({ fleet_status: 'bogus' })).toThrow(FLEET_STATUS_BOGUS)
    expect(() => strictRegions.get({ fleet_regions: 'apac;mars' })).toThrow(FLEET_REGIONS_MARS)
    expect(() => strictStage.get({ lifecyclestage: 'evangelist' })).toThrow(LIFECYCLESTAGE_EVANGELIST)
  })

  test('a strict enum set throws on an alias that is not an option', () => {
    expect(() => c.fleetStatus.set({}, 'bogus' as never)).toThrow("Unknown enum alias 'bogus'")
    expect(() => strictRegions.set({}, ['apac', 'mars'] as never)).toThrow("Unknown enum alias 'mars'")
  })

  test('json throws with the schema issues', () => {
    expect(() => c.fleetMeta.get({ fleet_meta: '{"depot":"north"}' })).toThrow(FLEET_META_DEPOT)
    expect(() => c.fleetMeta.get({ fleet_meta: 'not json' })).toThrow()
  })

  test('json refuses a schema that validates asynchronously', () => {
    const lazy = p.json('lazy', {
      '~standard': {
        version: 1,
        vendor: 'kalup-test',
        validate: async (value: unknown) => ({ value }),
      },
    }).codec
    expect(() => lazy.get({ lazy: '1' })).toThrow(LAZY_SYNCHRONOUSLY)
  })
})

describe('lenient enums', () => {
  test('get returns a value the options do not list as it is stored', () => {
    expect(c.lifecycleStage.get({ lifecyclestage: 'evangelist' })).toBe('evangelist')
    expect(c.fleetRegions.get({ fleet_regions: 'apac;mars;EU West' })).toEqual(['apac', 'mars', 'eu_west'])
  })

  test('set writes an unlisted value back unchanged, so read then write keeps it', () => {
    for (const wire of ['evangelist', 'lead']) {
      const bag: Record<string, string> = {}
      c.lifecycleStage.set(bag, c.lifecycleStage.get({ lifecyclestage: wire }))
      expect(bag, wire).toEqual({ lifecyclestage: wire })
    }
    const bag: Record<string, string> = {}
    c.fleetRegions.set(bag, c.fleetRegions.get({ fleet_regions: 'mars;EU West' }))
    expect(bag).toEqual({ fleet_regions: 'mars;EU West' })
  })

  test('set maps a listed alias to its value', () => {
    expect(roundTrip(c.fleetRegions, ['eu_west'])).toEqual({ bag: { fleet_regions: 'EU West' }, back: ['eu_west'] })
  })

  test('a bare reference never throws on a value', () => {
    const bare = p.enum('bare').codec
    expect(bare.get({ bare: 'anything' })).toBe('anything')
    expect(bare.enumValues).toEqual({})
    expect(p.multiEnum('many').codec.get({ many: 'a;b' })).toEqual(['a', 'b'])
  })

  test('an unlisted value that is the alias of another option throws, since set would write that option', () => {
    expect(() => c.fleetRegions.get({ fleet_regions: 'eu_west' })).toThrow(
      "Property 'fleet_regions' has unlisted value 'eu_west', which is the alias of option 'EU West'",
    )
  })

  test('strict keeps the chain state and the definition', () => {
    const strict = p
      .enum('tier', { label: 'Tier', group: 'g', fieldType: 'select', options: [{ value: 'gold', label: 'Gold' }] })
      .strict()
    expect(strict.codec.managed).toBe(true)
    expect(strict.codec.enumValues).toEqual({ gold: 'gold' })
    expect(() => strict.required().codec.get({})).toThrow("'tier'")
    expect(strict.managed(false).codec.managed).toBe(false)
  })
})

describe('enum values and aliases are unique and reversible', () => {
  const INHERITED = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']
  const plain = p.enum('plain', { options: [{ value: 'a', label: 'A' }] }).strict().codec
  const tricky = p
    .enum('tricky', {
      options: [
        { value: '__proto__', label: 'Proto' },
        { value: 'constructor', label: 'Constructor', as: 'toString' },
        { value: 'toString', label: 'To string', as: 'constructor' },
        { value: 'plain', label: 'Plain', as: 'hasOwnProperty' },
      ],
    })
    .strict().codec
  const aliases = ['__proto__', 'toString', 'constructor', 'hasOwnProperty'] as const
  const values = ['__proto__', 'constructor', 'toString', 'plain']

  test('decode of an unknown or inherited value throws the unknown value error', () => {
    for (const wire of INHERITED) {
      expect(() => plain.get({ plain: wire }), wire).toThrow(`Property 'plain' has unknown value '${wire}'`)
    }
    expect(() => tricky.get({ tricky: 'valueOf' })).toThrow("Property 'tricky' has unknown value 'valueOf'")
  })

  test('encode of an unknown or inherited alias throws', () => {
    for (const alias of INHERITED) {
      expect(() => plain.set({}, alias as never), alias).toThrow(`Unknown enum alias '${alias}'`)
    }
    expect(() => tricky.set({}, 'plain' as never)).toThrow("Unknown enum alias 'plain'")
  })

  test('a lenient enum reads an inherited name as an unlisted value, not an Object.prototype member', () => {
    const lenient = p.enum('plain', { options: [{ value: 'a', label: 'A' }] }).codec
    for (const wire of INHERITED) {
      expect(lenient.get({ plain: wire }), wire).toBe(wire)
      const bag: Record<string, string> = {}
      lenient.set(bag, lenient.get({ plain: wire }))
      expect(bag, wire).toEqual({ plain: wire })
    }
  })

  test('every alias and every value round-trips, prototype names included', () => {
    for (const alias of aliases) {
      expect(roundTrip(tricky, alias).back, alias).toBe(alias)
    }
    for (const value of values) {
      const bag: Record<string, string> = {}
      tricky.set(bag, tricky.get({ tricky: value }))
      expect(bag, value).toEqual({ tricky: value })
    }
    const many = p.multiEnum('many', { options: [{ value: '__proto__', label: 'P', as: 'constructor' }] }).codec
    expect(roundTrip(many, ['constructor'])).toEqual({ bag: { many: '__proto__' }, back: ['constructor'] })
  })

  test('enumValues holds own string entries only', () => {
    expect(Object.entries(tricky.enumValues)).toEqual([
      ['__proto__', '__proto__'],
      ['constructor', 'toString'],
      ['toString', 'constructor'],
      ['plain', 'hasOwnProperty'],
    ])
    for (const name of INHERITED) {
      expect(plain.enumValues[name], name).toBeUndefined()
    }
  })

  test('a repeated value or a shared alias (as ?? value) throws when the builder runs', () => {
    const twice = [
      { value: 'a', label: 'A' },
      { value: 'a', label: 'A again' },
    ]
    expect(() => p.enum('twice', { options: twice })).toThrow("Property 'twice': option value 'a' is listed twice")
    const sameAs = [
      { value: 'a', label: 'A', as: 'x' },
      { value: 'b', label: 'B', as: 'x' },
    ]
    expect(() => p.multiEnum('same_as', { options: sameAs })).toThrow(
      "Property 'same_as': options 'a' and 'b' share the alias 'x'",
    )
    const asIsValue = [
      { value: 'a', label: 'A', as: 'b' },
      { value: 'b', label: 'B' },
    ]
    expect(() => p.enum('as_is_value', { options: asIsValue })).toThrow(
      "Property 'as_is_value': options 'a' and 'b' share the alias 'b'",
    )
    const proto = [
      { value: '__proto__', label: 'P' },
      { value: 'other', label: 'O', as: '__proto__' },
    ]
    expect(() => p.enum('proto', { options: proto })).toThrow(
      "Property 'proto': options '__proto__' and 'other' share the alias '__proto__'",
    )
  })
})

describe('separators', () => {
  test('stringArray splits on comma or semicolon, trims, drops empties', () => {
    expect(c.fleetTags.get({ fleet_tags: ' a , b;c;; ,' })).toEqual(['a', 'b', 'c'])
    expect(c.fleetTags.get({ fleet_tags: ';' })).toEqual([])
  })

  test('multiEnum splits on semicolon only', () => {
    expect(c.fleetRegions.get({ fleet_regions: 'EU West;apac' })).toEqual(['eu_west', 'apac'])
    expect(c.fleetRegions.get({ fleet_regions: 'apac,apac' })).toEqual(['apac,apac'])
    expect(() => strictRegions.get({ fleet_regions: 'apac,apac' })).toThrow('fleet_regions')
  })
})

describe('definition and managed', () => {
  test('a full definition is managed and kept as written', () => {
    expect(c.fleetSize.managed).toBe(true)
    expect(c.fleetSize.definition).toEqual({ label: 'Fleet size', group: 'fleet', fieldType: 'number' })
  })

  test('a reference has no definition and is not managed', () => {
    expect(c.name.managed).toBe(false)
    expect(c.name.definition).toBeUndefined()
    expect(c.fleetScore.managed).toBe(false)
  })

  test('an options-only enum is a reference that keeps its options', () => {
    expect(c.lifecycleStage.managed).toBe(false)
    expect(c.lifecycleStage.definition).toEqual({
      options: [
        { value: 'lead', label: 'Lead' },
        { value: 'customer', label: 'Customer' },
      ],
    })
    expect(c.lifecycleStage.enumValues).toEqual({ lead: 'lead', customer: 'customer' })
  })

  test('an options-only multiEnum is a reference that decodes', () => {
    const industries = p.multiEnum('industries', {
      options: [
        { value: 'LOGISTICS', label: 'Logistics', as: 'logistics' },
        { value: 'retail', label: 'Retail' },
      ],
    }).codec
    expect(industries.managed).toBe(false)
    expect(industries.enumValues).toEqual({ LOGISTICS: 'logistics', retail: 'retail' })
    expect(industries.get({ industries: 'LOGISTICS;retail' })).toEqual(['logistics', 'retail'])
  })

  test('.managed(false) keeps the definition and clears managed', () => {
    expect(c.legacyCode.managed).toBe(false)
    expect(c.legacyCode.definition?.label).toBe('Legacy code')
  })

  test('the chain does not mutate the earlier builder', () => {
    const base = p.number('n', { label: 'N', group: 'g', fieldType: 'number' })
    const required = base.required()
    expect(base.codec.get({})).toBeNull()
    expect(() => required.codec.get({})).toThrow("'n'")
    expect(required.managed(false).codec.managed).toBe(false)
    expect(required.codec.managed).toBe(true)
  })

  test('json keeps the schema out of the definition', () => {
    expect(c.fleetMeta.definition).toEqual({ label: 'Fleet meta', group: 'fleet', fieldType: 'textarea' })
    expect(fleetMeta['~standard'].vendor).toBe('kalup-test')
  })
})
