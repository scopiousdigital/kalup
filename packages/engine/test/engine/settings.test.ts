import { expect, test } from 'vitest'
import { derivedExact, modeOf, optionsOf, takeoverObjects } from '../../src/engine/settings.js'
import type { ConfigFile } from '../../src/grammar/types.js'
import type { IRResource } from '../../src/ir/types.js'

const config = (fields: Partial<ConfigFile> = {}): ConfigFile => ({
  imports: [],
  objects: { companies: {}, deals: {} },
  targets: { sandbox: { portalId: 1_111_111 } },
  ...fields,
})

test('mode resolves the target object, then the target, then the object, then the top level, then addon', () => {
  expect(modeOf(config(), 'sandbox', 'companies')).toEqual({ value: 'addon', from: 'default' })
  const top = config({ mode: 'takeover' })
  expect(modeOf(top, 'sandbox', 'companies')).toEqual({ value: 'takeover', from: 'mode' })
  const object = config({ mode: 'takeover', objects: { companies: { mode: 'addon' }, deals: {} } })
  expect(modeOf(object, 'sandbox', 'companies')).toEqual({ value: 'addon', from: 'objects.companies.mode' })
  expect(modeOf(object, 'sandbox', 'deals')).toEqual({ value: 'takeover', from: 'mode' })
  const target = { ...object, targets: { sandbox: { portalId: 1, mode: 'takeover' as const } } }
  expect(modeOf(target, 'sandbox', 'companies')).toEqual({ value: 'takeover', from: 'targets.sandbox.mode' })
  const pinned = {
    ...object,
    targets: {
      sandbox: { portalId: 1, mode: 'takeover' as const, objects: { companies: { mode: 'addon' as const } } },
    },
  }
  expect(modeOf(pinned, 'sandbox', 'companies')).toEqual({
    value: 'addon',
    from: 'targets.sandbox.objects.companies.mode',
  })
  expect(takeoverObjects(pinned, 'sandbox')).toEqual(['deals'])
  // An own key only: a target or object named after an Object.prototype member finds nothing.
  expect(modeOf(config(), 'constructor', 'toString')).toEqual({ value: 'addon', from: 'default' })
})

const tier: IRResource = {
  type: 'property',
  managed: true,
  definition: { label: 'Tier', type: 'enumeration', fieldType: 'select', options: [] },
  lifecycle: { options: 'additive', removedOptions: ['bronze'] },
}
const address = 'property:companies/tier'

test("under takeover the options lifecycle is 'exact' unless the property or the target's override states one", () => {
  const takeover = config({ mode: 'takeover' })
  expect(optionsOf({ config: takeover }, 'sandbox', address, tier)).toEqual({ derived: true, options: 'exact' })
  expect(optionsOf({ config: config() }, 'sandbox', address, tier)).toEqual({ derived: false, options: 'additive' })
  expect(optionsOf({ config: takeover, optionsStated: [address] }, 'sandbox', address, tier)).toEqual({
    derived: false,
    options: 'additive',
  })
  const override = {
    ...takeover,
    targets: {
      sandbox: { portalId: 1, overrides: { [address]: { definition: { lifecycle: { options: 'exact' as const } } } } },
    },
  }
  const exact = { ...tier, lifecycle: { options: 'exact' as const } }
  expect(optionsOf({ config: override }, 'sandbox', address, exact)).toEqual({ derived: false, options: 'exact' })
})

test('derivedExact lists each managed property takeover made exact, with the removedOptions config asks for', () => {
  const ir = { resources: { [address]: tier } } as never
  expect(derivedExact({ config: config({ mode: 'takeover' }), ir }, 'sandbox', { [address]: tier })).toEqual({
    [address]: ['bronze'],
  })
  expect(derivedExact({ config: config(), ir }, 'sandbox', { [address]: tier })).toEqual({})
  const reference = { ...tier, managed: false }
  expect(derivedExact({ config: config({ mode: 'takeover' }), ir }, 'sandbox', { [address]: reference })).toEqual({})
})
