import { expect, test } from 'vitest'
import { fixtureText } from './fixture.js'
import { stableStringify } from './serialize.js'

test('key order does not change the output', () => {
  const a = { resources: { 'group:companies/billing': { type: 'group', managed: true } }, irVersion: 1 }
  const b = { irVersion: 1, resources: { 'group:companies/billing': { managed: true, type: 'group' } } }
  expect(stableStringify(a)).toBe(stableStringify(b))
  expect(stableStringify(a)).toBe(
    '{\n  "irVersion": 1,\n  "resources": {\n    "group:companies/billing": {\n      "managed": true,\n      "type": "group"\n    }\n  }\n}',
  )
})

test('arrays keep their order', () => {
  expect(stableStringify([{ b: 1, a: 2 }, 'z', 'a'])).toBe('[\n  {\n    "a": 2,\n    "b": 1\n  },\n  "z",\n  "a"\n]')
})

test('every golden fixture has sorted keys', () => {
  for (const name of ['spec-example.ir.json', 'acme.ir.json', 'acme.create-bodies.json', 'state-example.json']) {
    const document = JSON.parse(fixtureText(name))
    expect(JSON.stringify(document)).toBe(JSON.stringify(JSON.parse(stableStringify(document))))
  }
})
