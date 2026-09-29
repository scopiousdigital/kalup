import { expect, test } from 'vitest'
import type { Base } from '../../src/ir/state.js'
import type { IROption } from '../../src/ir/types.js'
import { advanceBase, classify, type Rules, type Spec, specOfBase, type UnitResult } from '../../src/plan/classify.js'

const additive: Rules = { options: 'additive' }
const small: IROption = { value: 'small', label: 'Small' }
const large: IROption = { value: 'large', label: 'Large' }
const legacy: IROption = { value: 'legacy', label: 'Legacy' }

function units(desired: Spec, observed: Spec, rules: Rules = additive): UnitResult[] {
  return classify(undefined, desired, observed, rules)
}

const scalars: [string, Spec, Spec, UnitResult[]][] = [
  [
    'equal values converge',
    { fields: { label: 'Depot code' } },
    { fields: { label: 'Depot code' } },
    [{ unit: 'label', class: 'converged', desired: 'Depot code', observed: 'Depot code' }],
  ],
  [
    'a differing value with no base is diverged',
    { fields: { label: 'Depot code' } },
    { fields: { label: 'Depot' } },
    [{ unit: 'label', class: 'diverged', desired: 'Depot code', observed: 'Depot' }],
  ],
  [
    'an explicit empty string and false are compared like any value',
    { fields: { description: '', formField: false } },
    { fields: { description: 'Home depot', formField: false } },
    [
      { unit: 'description', class: 'diverged', desired: '', observed: 'Home depot' },
      { unit: 'formField', class: 'converged', desired: false, observed: false },
    ],
  ],
  [
    'an absent observed value compares as null',
    { fields: { description: 'Home depot' } },
    { fields: { description: null } },
    [{ unit: 'description', class: 'diverged', desired: 'Home depot', observed: null }],
  ],
  [
    'a field the observed side does not state is not compared, as when config is the observed side',
    { fields: { label: 'Depot code', description: 'Home depot', hasUniqueValue: false } },
    { fields: { label: 'Depot code' } },
    [{ unit: 'label', class: 'converged', desired: 'Depot code', observed: 'Depot code' }],
  ],
  ['a field the desired side does not own is not compared', { fields: {} }, { fields: { label: 'Depot code' } }, []],
  [
    'a $ref compares by value',
    { fields: { group: { $ref: 'group:companies/logistics' } } },
    { fields: { group: { $ref: 'group:companies/routing' } } },
    [
      {
        unit: 'group',
        class: 'diverged',
        desired: { $ref: 'group:companies/logistics' },
        observed: { $ref: 'group:companies/routing' },
      },
    ],
  ],
  [
    'labels compare as an object, whatever the key order',
    { fields: { labels: { singular: 'Shipment', plural: 'Shipments' } } },
    { fields: { labels: { plural: 'Shipments', singular: 'Shipment' } } },
    [
      {
        unit: 'labels',
        class: 'converged',
        desired: { singular: 'Shipment', plural: 'Shipments' },
        observed: { plural: 'Shipments', singular: 'Shipment' },
      },
    ],
  ],
  [
    'requiredProperties and searchableProperties compare as sets',
    { fields: { requiredProperties: ['ref', 'carrier'], searchableProperties: ['ref'] } },
    { fields: { requiredProperties: ['carrier', 'ref', 'ref'], searchableProperties: ['ref', 'carrier'] } },
    [
      {
        unit: 'requiredProperties',
        class: 'converged',
        desired: ['ref', 'carrier'],
        observed: ['carrier', 'ref', 'ref'],
      },
      { unit: 'searchableProperties', class: 'diverged', desired: ['ref'], observed: ['ref', 'carrier'] },
    ],
  ],
  [
    'secondaryDisplayProperties compare as an ordered list',
    { fields: { secondaryDisplayProperties: ['carrier', 'ref'] } },
    { fields: { secondaryDisplayProperties: ['ref', 'carrier'] } },
    [
      {
        unit: 'secondaryDisplayProperties',
        class: 'diverged',
        desired: ['carrier', 'ref'],
        observed: ['ref', 'carrier'],
      },
    ],
  ],
  [
    'units come out sorted by code unit',
    { fields: { label: 'a', Zeta: 'a', fieldType: 'a', description: 'a' } },
    { fields: { label: 'a', Zeta: 'a', fieldType: 'a', description: 'a' } },
    ['Zeta', 'description', 'fieldType', 'label'].map((unit) => ({
      unit,
      class: 'converged' as const,
      desired: 'a',
      observed: 'a',
    })),
  ],
]

test.each(scalars)('fields: %s', (_name, desired, observed, expected) => {
  expect(units(desired, observed)).toEqual(expected)
})

test('ignoreChanges skips a field, and options when it names options', () => {
  const desired = { fields: { label: 'Tier', description: 'Size band' }, options: [small] }
  const observed = { fields: { label: 'Fleet tier', description: '' }, options: [large] }
  expect(units(desired, observed, { options: 'exact', ignoreChanges: ['description', 'options'] })).toEqual([
    { unit: 'label', class: 'diverged', desired: 'Tier', observed: 'Fleet tier' },
  ])
})

/** Option units only, without the order unit, for the member tables. */
function members(desired: IROption[], observed: IROption[], rules: Rules = additive): UnitResult[] {
  return units({ fields: {}, options: desired }, { fields: {}, options: observed }, rules).filter(
    (unit) => unit.unit !== 'options.order',
  )
}

const optionSets: [string, IROption[], IROption[], Rules, UnitResult[]][] = [
  [
    'a value in config and not in the portal is added',
    [small, large],
    [small],
    additive,
    [
      { unit: 'options[large]', class: 'add', desired: large },
      { unit: 'options[small].hidden', class: 'converged', desired: false, observed: false },
      { unit: 'options[small].label', class: 'converged', desired: 'Small', observed: 'Small' },
    ],
  ],
  [
    'a portal-only value is kept under additive',
    [small],
    [small, legacy],
    additive,
    [
      { unit: 'options[legacy]', class: 'keep', observed: legacy },
      { unit: 'options[small].hidden', class: 'converged', desired: false, observed: false },
      { unit: 'options[small].label', class: 'converged', desired: 'Small', observed: 'Small' },
    ],
  ],
  [
    'a portal-only value is removed under exact',
    [],
    [legacy],
    { options: 'exact' },
    [{ unit: 'options[legacy]', class: 'remove', observed: legacy }],
  ],
  [
    'a portal value named in removedOptions is removed under additive',
    [],
    [legacy, large],
    { options: 'additive', removedOptions: ['legacy', 'gone'] },
    [
      { unit: 'options[large]', class: 'keep', observed: large },
      { unit: 'options[legacy]', class: 'remove', observed: legacy },
    ],
  ],
  [
    'a differing label is diverged',
    [{ value: 'small', label: 'Small fleet' }],
    [small],
    additive,
    [
      { unit: 'options[small].hidden', class: 'converged', desired: false, observed: false },
      { unit: 'options[small].label', class: 'diverged', desired: 'Small fleet', observed: 'Small' },
    ],
  ],
  [
    'hidden defaults to false on both sides',
    [small, { ...large, hidden: false }],
    [{ ...small, hidden: true }, large],
    additive,
    [
      { unit: 'options[large].hidden', class: 'converged', desired: false, observed: false },
      { unit: 'options[large].label', class: 'converged', desired: 'Large', observed: 'Large' },
      { unit: 'options[small].hidden', class: 'diverged', desired: false, observed: true },
      { unit: 'options[small].label', class: 'converged', desired: 'Small', observed: 'Small' },
    ],
  ],
  [
    'description is compared only when the desired option states it, the observed side defaulting to empty',
    [small, { ...large, description: '' }, { ...legacy, description: 'Retired' }],
    [{ ...small, description: 'Up to 10' }, large, { ...legacy, description: 'Old' }],
    additive,
    [
      { unit: 'options[large].description', class: 'converged', desired: '', observed: '' },
      { unit: 'options[large].hidden', class: 'converged', desired: false, observed: false },
      { unit: 'options[large].label', class: 'converged', desired: 'Large', observed: 'Large' },
      { unit: 'options[legacy].description', class: 'diverged', desired: 'Retired', observed: 'Old' },
      { unit: 'options[legacy].hidden', class: 'converged', desired: false, observed: false },
      { unit: 'options[legacy].label', class: 'converged', desired: 'Legacy', observed: 'Legacy' },
      { unit: 'options[small].hidden', class: 'converged', desired: false, observed: false },
      { unit: 'options[small].label', class: 'converged', desired: 'Small', observed: 'Small' },
    ],
  ],
]

test.each(optionSets)('options: %s', (_name, desired, observed, rules, expected) => {
  expect(members(desired, observed, rules)).toEqual(expected)
})

test('options.order compares the relative order of the values both sides hold', () => {
  const order = (desired: IROption[], observed: IROption[]) =>
    units({ fields: {}, options: desired }, { fields: {}, options: observed }).find(
      (unit) => unit.unit === 'options.order',
    )
  // An added value in between and a kept one at the end do not change the order of the rest.
  expect(order([small, legacy, large], [small, large, { value: 'xl', label: 'XL' }])).toEqual({
    unit: 'options.order',
    class: 'converged',
    desired: ['small', 'large'],
    observed: ['small', 'large'],
  })
  expect(order([small, large], [large, small])).toEqual({
    unit: 'options.order',
    class: 'diverged',
    desired: ['small', 'large'],
    observed: ['large', 'small'],
  })
})

test('options are compared only when both sides hold them', () => {
  // Config that does not own options, as the desired or as the observed side.
  expect(units({ fields: {} }, { fields: {}, options: [small] })).toEqual([])
  expect(units({ fields: {}, options: [small] }, { fields: {} })).toEqual([])
  // An observation with no options holds an empty list: every desired value is an add.
  expect(units({ fields: {}, options: [small] }, { fields: {}, options: [] })).toEqual([
    { unit: 'options.order', class: 'converged', desired: [], observed: [] },
    { unit: 'options[small]', class: 'add', desired: small },
  ])
})

test('an option value named like an Object.prototype member is an ordinary value', () => {
  const proto: IROption = { value: '__proto__', label: 'Proto' }
  const ctor: IROption = { value: 'constructor', label: 'Constructor' }
  expect(members([proto], [ctor])).toEqual([
    { unit: 'options[__proto__]', class: 'add', desired: proto },
    { unit: 'options[constructor]', class: 'keep', observed: ctor },
  ])
})

// With a base: the classes when state records what config and the portal last agreed on.

function withBase(base: Base, desired: Spec, observed: Spec, rules: Rules = additive): UnitResult[] {
  return classify(base, desired, observed, rules)
}

test('an empty base classifies exactly as no base: it holds no value for any unit', () => {
  const desired = { fields: { label: 'Tier', description: '' }, options: [small, large] }
  const observed = { fields: { label: 'Fleet tier', description: '' }, options: [large, legacy] }
  expect(withBase({}, desired, observed)).toEqual(units(desired, observed))
})

const againstBase: [string, Base, unknown, unknown, UnitResult['class']][] = [
  ['config and portal equal, whatever the base', { label: 'Old' }, 'Tier', 'Tier', 'converged'],
  ['config moved from the base, the portal did not', { label: 'Size' }, 'Tier', 'Size', 'config-change'],
  ['the portal moved from the base, config did not', { label: 'Size' }, 'Size', 'Tier', 'drift'],
  ['both moved from the base, to different values', { label: 'Size' }, 'Tier', 'Band', 'conflict'],
  ['the base holds other units but not this one', { description: 'x' }, 'Tier', 'Band', 'diverged'],
]

test.each(againstBase)('a scalar unit: %s', (_name, base, desired, observed, unitClass) => {
  const [unit] = withBase(base, { fields: { label: desired } }, { fields: { label: observed } })
  expect(unit).toEqual({
    unit: 'label',
    class: unitClass,
    desired,
    observed,
    ...(Object.hasOwn(base, 'label') ? { base: base.label } : {}),
  })
})

test('a set unit compares with the base as a set', () => {
  const base = { requiredProperties: ['ref', 'carrier'] }
  const [unit] = withBase(
    base,
    { fields: { requiredProperties: ['ref'] } },
    { fields: { requiredProperties: ['carrier', 'ref'] } },
  )
  expect(unit).toMatchObject({ unit: 'requiredProperties', class: 'config-change', base: ['ref', 'carrier'] })
})

test('ignoreChanges skips a unit even when the base holds it', () => {
  expect(
    withBase(
      { label: 'Old', description: 'Old' },
      { fields: { label: 'Tier', description: 'Size band' } },
      { fields: { label: 'Old', description: 'Changed' } },
      { options: 'additive', ignoreChanges: ['description'] },
    ),
  ).toEqual([{ unit: 'label', class: 'config-change', desired: 'Tier', observed: 'Old', base: 'Old' }])
})

function baseMembers(base: Base, desired: IROption[], observed: IROption[], rules: Rules = additive): UnitResult[] {
  return withBase(base, { fields: {}, options: desired }, { fields: {}, options: observed }, rules).filter(
    (unit) => unit.unit !== 'options.order',
  )
}

test('an option config and the base hold and the portal does not is drift, removed in HubSpot; without the base it is added', () => {
  const base = { options: { large: { label: 'Large' } } }
  expect(baseMembers(base, [large, legacy], [])).toEqual([
    { unit: 'options[large]', class: 'drift', desired: large, base: { label: 'Large' } },
    { unit: 'options[legacy]', class: 'add', desired: legacy },
  ])
})

test('an option only the portal holds is kept, or removed under exact or removedOptions, with its base member when there is one', () => {
  const base = { options: { legacy: {} } }
  expect(baseMembers(base, [], [legacy, large])).toEqual([
    { unit: 'options[large]', class: 'keep', observed: large },
    { unit: 'options[legacy]', class: 'keep', observed: legacy, base: {} },
  ])
  expect(baseMembers(base, [], [legacy], { options: 'exact' })).toEqual([
    { unit: 'options[legacy]', class: 'remove', observed: legacy, base: {} },
  ])
  expect(baseMembers(base, [], [legacy], { options: 'additive', removedOptions: ['legacy'] })).toEqual([
    { unit: 'options[legacy]', class: 'remove', observed: legacy, base: {} },
  ])
})

test("the fields of an option both sides hold compare with the base member's fields", () => {
  const base = { options: { small: { label: 'Small', hidden: false, description: 'Up to 10' }, large: {} } }
  const desired = [
    { ...small, label: 'Small fleet', description: 'Up to 12' },
    { ...large, label: 'Large fleet' },
  ]
  const observed = [
    { ...small, hidden: true, description: 'Up to 20' },
    { ...large, label: 'Big' },
  ]
  expect(baseMembers(base, desired, observed)).toEqual([
    // A member with no fields: only its membership is agreed, so each field is diverged.
    { unit: 'options[large].hidden', class: 'converged', desired: false, observed: false },
    { unit: 'options[large].label', class: 'diverged', desired: 'Large fleet', observed: 'Big' },
    {
      unit: 'options[small].description',
      class: 'conflict',
      desired: 'Up to 12',
      observed: 'Up to 20',
      base: 'Up to 10',
    },
    { unit: 'options[small].hidden', class: 'drift', desired: false, observed: true, base: false },
    { unit: 'options[small].label', class: 'config-change', desired: 'Small fleet', observed: 'Small', base: 'Small' },
  ])
})

test("options.order compares the common members' order with the base's order", () => {
  const order = (stored: Base, desired: IROption[], observed: IROption[]) =>
    withBase(stored, { fields: {}, options: desired }, { fields: {}, options: observed }).find(
      (unit) => unit.unit === 'options.order',
    )
  const base = { optionsOrder: ['small', 'large'] }
  expect(order(base, [large, small], [small, large])).toEqual({
    unit: 'options.order',
    class: 'config-change',
    desired: ['large', 'small'],
    observed: ['small', 'large'],
    base: ['small', 'large'],
  })
  expect(order(base, [small, large], [large, small])).toMatchObject({ class: 'drift' })
  expect(order({}, [small, large], [large, small])).toMatchObject({ class: 'diverged' })
})

test("options.order reads the base's order of today's common members, and has no base when a member is new to it", () => {
  const order = (stored: Base, desired: IROption[], observed: IROption[]) =>
    withBase(stored, { fields: {}, options: desired }, { fields: {}, options: observed }).find(
      (unit) => unit.unit === 'options.order',
    )
  const base = advanceBase(
    undefined,
    { fields: {}, options: [small, large, legacy] },
    { fields: {}, options: [small, large, legacy] },
  ) as Base
  expect(base.optionsOrder).toEqual(['small', 'large', 'legacy'])
  // Config drops legacy, which stays live, and swaps the others; the portal is untouched.
  expect(order(base, [large, small], [small, large, legacy])).toEqual({
    unit: 'options.order',
    class: 'config-change',
    desired: ['large', 'small'],
    observed: ['small', 'large'],
    base: ['small', 'large'],
  })
  // HubSpot removes legacy and swaps the others; config is unchanged.
  expect(order(base, [small, large, legacy], [large, small])).toMatchObject({
    class: 'drift',
    base: ['small', 'large'],
  })
  // Config adds xl between small and large, and the portal holds it at the end: xl has no agreed position.
  const xl = { value: 'xl', label: 'XL' }
  const agreed = { optionsOrder: ['small', 'large'] }
  expect(order(agreed, [small, xl, large], [small, large, xl])).toEqual({
    unit: 'options.order',
    class: 'diverged',
    desired: ['small', 'xl', 'large'],
    observed: ['small', 'large', 'xl'],
  })
})

test('advanceBase records the units where approved and live agree, and nothing else', () => {
  const approved = { fields: { label: 'Tier', description: 'Size band', fieldType: 'select' } }
  const live = { fields: { label: 'Tier', description: 'Fleet size', fieldType: 'select', type: 'enumeration' } }
  expect(advanceBase(undefined, approved, live)).toEqual({ fieldType: 'select', label: 'Tier' })
  // A held unit keeps its base value, agreed units move.
  expect(advanceBase({ description: 'Size', label: 'Old' }, approved, live)).toEqual({
    description: 'Size',
    fieldType: 'select',
    label: 'Tier',
  })
})

test('advanceBase returns undefined when nothing is agreed and there was no base, and the base as it was otherwise', () => {
  const approved = { fields: { label: 'Tier' } }
  const live = { fields: { label: 'Band' } }
  expect(advanceBase(undefined, approved, live)).toBeUndefined()
  expect(advanceBase({ label: 'Size', description: '' }, approved, live)).toEqual({ description: '', label: 'Size' })
  // No option both sides hold: an order of nothing is not an agreement.
  expect(advanceBase(undefined, { fields: {}, options: [small] }, { fields: {}, options: [] })).toBeUndefined()
})

test('advanceBase compares a set unit as a set and records the approved value', () => {
  const approved = { fields: { requiredProperties: ['ref', 'carrier'] } }
  const live = { fields: { requiredProperties: ['carrier', 'ref'] } }
  expect(advanceBase(undefined, approved, live)).toEqual({ requiredProperties: ['ref', 'carrier'] })
})

test('advanceBase restricted to units moves only those; an option unit covers its fields', () => {
  const approved = { fields: { label: 'Tier', description: 'd' }, options: [small, large] }
  const live = { fields: { label: 'Tier', description: 'd' }, options: [small, large] }
  expect(advanceBase(undefined, approved, live, ['label'])).toEqual({ label: 'Tier' })
  expect(advanceBase(undefined, approved, live, ['options[small]'])).toEqual({
    options: { small: { hidden: false, label: 'Small' } },
  })
  expect(advanceBase(undefined, approved, live, ['options[large].label', 'options.order'])).toEqual({
    options: { large: { label: 'Large' } },
    optionsOrder: ['small', 'large'],
  })
  expect(advanceBase(undefined, approved, live, [])).toBeUndefined()
})

test('advanceBase keeps held option units, drops a member neither side holds, and records the agreed order', () => {
  const previous = { options: { legacy: { label: 'Legacy' }, xl: {}, medium: { label: 'Mid' } }, optionsOrder: ['xl'] }
  const approved = { fields: {}, options: [small, { value: 'medium', label: 'Medium' }] }
  const live = {
    fields: {},
    options: [
      { ...small, hidden: true },
      { value: 'xl', label: 'XL' },
    ],
  }
  expect(advanceBase(previous, approved, live)).toEqual({
    options: {
      // In config and the base, not live: held, unchanged.
      medium: { label: 'Mid' },
      // Label agreed, hidden held.
      small: { label: 'Small' },
      // Live and in the base, dropped from config: kept as it was.
      xl: {},
    },
    optionsOrder: ['small'],
  })
})

test('advanceBase writes keys in code-unit order and keeps an option value such as __proto__ as a key', () => {
  const proto = { value: '__proto__', label: 'Proto' }
  const next = advanceBase(
    undefined,
    { fields: { label: 'L', description: 'D' }, options: [proto] },
    { fields: { label: 'L', description: 'D' }, options: [proto] },
  ) as Base
  expect(Object.keys(next)).toEqual(['description', 'label', 'options', 'optionsOrder'])
  expect(Object.hasOwn(next.options as object, '__proto__')).toBe(true)
  expect(next.optionsOrder).toEqual(['__proto__'])
})

test('a base advanced from an agreement classifies those units as converged, carrying the base', () => {
  const approved = { fields: { label: 'Tier' }, options: [small, large] }
  const live = { fields: { label: 'Tier' }, options: [large, small] }
  const base = advanceBase(undefined, approved, live) as Base
  expect(base).toEqual({
    label: 'Tier',
    options: { large: { hidden: false, label: 'Large' }, small: { hidden: false, label: 'Small' } },
  })
  // The order is not agreed, so a later plan still sees it as diverged, not as drift.
  const later = classify(base, approved, live, additive)
  expect(later.find((u) => u.unit === 'options.order')).toMatchObject({ class: 'diverged' })
  expect(later.filter((u) => u.unit !== 'options.order').every((u) => u.class === 'converged' && 'base' in u)).toBe(
    true,
  )
})

test('specOfBase gives the fields and the members, in the agreed order and then by value', () => {
  const base = {
    label: 'Tier',
    options: { b: { label: 'B' }, a: {}, c: { label: 'C', hidden: true } },
    optionsOrder: ['c', 'b'],
  }
  expect(specOfBase(base)).toEqual({
    fields: { label: 'Tier' },
    options: [{ value: 'c', label: 'C', hidden: true }, { value: 'b', label: 'B' }, { value: 'a' }],
  })
  expect(specOfBase({ label: 'Tier' })).toEqual({ fields: { label: 'Tier' } })
})
