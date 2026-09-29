import { expect, test } from 'vitest'
import { applyPrefix } from '../../src/blueprint/prefix.js'
import type { Blueprint } from '../../src/blueprint/types.js'
import { validateBlueprint } from '../../src/blueprint/validate.js'
import { fixture } from '../../src/ir/fixture.js'

const example = (): Blueprint => fixture<Blueprint>('blueprint-example.json')

test('every address and every $ref to a resource of the fragment is renamed', () => {
  const out = applyPrefix(example(), 'acme_')
  expect(Object.keys(out.resources)).toEqual([
    'group:deals/acme_renewal',
    'property:deals/acme_renewal_date',
    'property:deals/acme_renewal_stage',
  ])
  expect(out.resources['property:deals/acme_renewal_date']?.definition.group).toEqual({
    $ref: 'group:deals/acme_renewal',
  })
  expect(out.resources['property:deals/acme_renewal_stage']?.definition.group).toEqual({
    $ref: 'group:deals/acme_renewal',
  })
  expect(validateBlueprint(out)).toEqual([])
})

test('labels, option values, descriptions, binding keys, lifecycle, object keys and requires stay', () => {
  const before = example()
  const out = applyPrefix(before, 'acme_')
  const stage = out.resources['property:deals/acme_renewal_stage']
  const original = before.resources['property:deals/renewal_stage']
  expect(stage?.definition.label).toBe('Renewal stage')
  expect(stage?.definition.description).toBe('Where the renewal stands')
  expect(stage?.definition.options).toEqual(original?.definition.options)
  expect(stage?.binding).toEqual(original?.binding)
  expect(stage?.lifecycle).toEqual(original?.lifecycle)
  expect(out.resources['property:deals/acme_renewal_date']?.binding?.key).toBe('renewalDate')
  expect(out.resources['group:deals/acme_renewal']?.definition).toEqual({ label: 'Renewal' })
  expect(out.requires).toEqual([{ $ref: 'object:deals' }])
  expect(out.name).toBe('acme/renewals')
  // The input is not changed.
  expect(before).toEqual(example())
})

test('a $ref to a group outside the fragment is left for the project to provide', () => {
  const b = example()
  Object.assign(b.resources['property:deals/renewal_date']?.definition ?? {}, {
    group: { $ref: 'group:deals/dealinformation' },
  })
  const out = applyPrefix(b, 'acme_')
  expect(out.resources['property:deals/acme_renewal_date']?.definition.group).toEqual({
    $ref: 'group:deals/dealinformation',
  })
})

test('a label that looks like a $ref is not renamed: only a { $ref } object is a reference', () => {
  const b = example()
  Object.assign(b.resources['property:deals/renewal_date']?.definition ?? {}, { label: 'group:deals/renewal' })
  const out = applyPrefix(b, 'acme_')
  expect(out.resources['property:deals/acme_renewal_date']?.definition.label).toBe('group:deals/renewal')
})

test('the empty prefix is the identity, applied once or twice', () => {
  const b = example()
  expect(applyPrefix(b, '')).toEqual(b)
  expect(applyPrefix(applyPrefix(b, ''), '')).toEqual(b)
})

test('an option value named __proto__ stays an own option field', () => {
  const b = JSON.parse(JSON.stringify(example()).replace('"value":"open"', '"value":"__proto__"')) as Blueprint
  const options = applyPrefix(b, 'acme_').resources['property:deals/acme_renewal_stage']?.definition.options as {
    value: string
  }[]
  expect(options[0]?.value).toBe('__proto__')
  expect(Object.getPrototypeOf(options[0])).toBe(Object.prototype)
})
