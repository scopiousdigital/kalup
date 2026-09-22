// The two tests that protect the app and milestone 4: the file the tool writes types the app the way the IR says, and
// the create body built from the IR equals what the API holds.
import { expect, test } from 'vitest'
import type { ReadonlyCodec } from '../../src/codecs/codec.js'
import { toCreatePayload } from '../../src/ir/payload.js'
import type { Binding } from '../../src/ir/types.js'
import { fixtureText, project } from '../../src/loader/fixture.js'
import { loadFiles } from '../../src/loader/load.js'
import { HUBSPOT_TYPES } from '../../src/loader/tables.js'
import { Deal, Parcel } from '../fixtures/loader/app/kalup/objects/parcels.js'

type Live = Record<string, unknown>

test('the written file, executed by the app, yields codecs whose definition equals the IR definition', () => {
  const { ir } = loadFiles(project('app'))
  const objects: [string, Record<string, ReadonlyCodec<unknown>>][] = [
    ['parcel', Parcel.properties],
    ['deals', Deal.properties],
  ]
  const checked: string[] = []
  for (const [object, properties] of objects) {
    for (const [key, codec] of Object.entries(properties)) {
      const address = `property:${object}/${codec.property}`
      const resource = ir.resources[address]
      if (!resource) {
        throw new Error(`${address} is not in the IR`)
      }
      expect(resource.managed, address).toBe(codec.managed)
      expect(resource.binding?.key, address).toBe(key)
      expect(resource.definition, address).toEqual(lifted(object, codec, resource.binding?.codec))
      if ('enumValues' in codec) {
        for (const [value, alias] of Object.entries(codec.enumValues as Record<string, string>)) {
          expect(resource.binding?.aliases?.[value] ?? value, address).toBe(alias)
        }
      }
      checked.push(address)
    }
  }
  expect(checked.sort()).toEqual(Object.keys(ir.resources).filter((address) => address.startsWith('property:')))
  expect(Object.keys(Parcel.groups).map((name) => `group:parcel/${name}`)).toEqual(
    Object.keys(ir.resources).filter((address) => address.startsWith('group:')),
  )
  expect(ir.resources['object:parcel']).toHaveProperty('definition', {
    labels: Parcel.labels,
    primaryDisplayProperty: Parcel.primaryDisplayProperty,
    requiredProperties: Parcel.requiredProperties,
  })
})

// What the loader does to a definition: group to a $ref, lifecycle lifted out, `as` moved to the binding, type added.
function lifted(object: string, codec: ReadonlyCodec<unknown>, kind: Binding['codec']): Live | undefined {
  const d = codec.definition
  if (!d) {
    return undefined
  }
  const { lifecycle: _lifecycle, ...rest } = d
  const expected: Live = { ...rest }
  if (typeof rest.group === 'string') {
    expected.group = { $ref: `group:${object}/${rest.group}` }
  }
  if (rest.options) {
    expected.options = rest.options.map(({ as: _as, ...option }) => option)
  }
  if (rest.label !== undefined && kind) {
    expected.type = HUBSPOT_TYPES[kind]
  }
  return expected
}

// options is left to createBody.
const CREATE_FIELDS = ['name', 'label', 'type', 'fieldType', 'groupName', 'description', 'hasUniqueValue', 'formField']
const OPTION_FIELDS = ['label', 'value', 'description', 'displayOrder', 'hidden']

test("create-payload completeness: toCreatePayload on every managed resource equals the API fixture's own fields", () => {
  const { ir } = loadFiles(project('payload'))
  const properties = (JSON.parse(fixtureText('payload/properties.json')) as { results: Live[] }).results
  const groups = (JSON.parse(fixtureText('payload/groups.json')) as { results: Live[] }).results
  const covered: string[] = []
  for (const [address, resource] of Object.entries(ir.resources)) {
    if (!resource.managed) {
      continue
    }
    const name = address.slice(address.lastIndexOf('/') + 1)
    const live = find(resource.type === 'group' ? groups : properties, name)
    const expected = resource.type === 'group' ? pick(live, ['name', 'label']) : createBody(live)
    expect(toCreatePayload(address, resource), address).toEqual(expected)
    covered.push(name)
  }
  const custom = properties.filter((p) => p.hubspotDefined === false).map((p) => p.name as string)
  expect(covered.sort()).toEqual([...custom, ...groups.map((g) => g.name as string)].sort())
  expect(custom).toHaveLength(9)
})

// The fields of a property response that a create body carries. HubSpot returns Yes/No options on a bool property and
// [] on every other non-enumeration; the create body sends options for enumerations only.
function createBody(live: Live): Live {
  const body = pick(live, CREATE_FIELDS)
  if (live.type === 'enumeration') {
    body.options = (live.options as Live[]).map((o) => pick(o, OPTION_FIELDS))
  }
  return body
}

function find(list: Live[], name: string): Live {
  const found = list.find((item) => item.name === name)
  if (!found) {
    throw new Error(`${name} is not in the API fixture`)
  }
  return found
}

function pick(value: Live, keys: string[]): Live {
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]))
}
