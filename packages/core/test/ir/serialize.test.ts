import { expect, test } from 'vitest'
import { fixtureText } from '../../src/ir/fixture.js'
import { escapeJson, stableStringify } from '../../src/ir/serialize.js'

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

// DEL, C1 controls (CSI is U+009B) and the two line separators, which JSON.stringify leaves raw.
const unsafe = [0x7f, 0x80, 0x85, 0x9b, 0x9f, 0x20_28, 0x20_29].map((code) => String.fromCodePoint(code))
const kept = `é 😀${String.fromCodePoint(0xa0)}~`

test('escapeJson writes DEL, C1 controls, U+2028 and U+2029 as \\u escapes and nothing else', () => {
  const value = { [`key${unsafe.join('')}`]: `a${unsafe.join('b')}z`, other: kept }
  const text = escapeJson(JSON.stringify(value))
  expect(text).toBe(
    `{"key\\u007f\\u0080\\u0085\\u009b\\u009f\\u2028\\u2029":"a\\u007fb\\u0080b\\u0085b\\u009bb\\u009fb\\u2028b\\u2029z","other":"${kept}"}`,
  )
  expect(JSON.parse(text)).toEqual(value)
})

test('stableStringify escapes the same characters and round-trips', () => {
  const value = { label: `Bad${unsafe.join('')}${String.fromCodePoint(0x1b)}[31m`, options: [{ value: unsafe[5] }] }
  const text = stableStringify(value)
  expect(unsafe.some((char) => text.includes(char))).toBe(false)
  expect(text.includes(String.fromCodePoint(0x1b))).toBe(false)
  expect(JSON.parse(text)).toEqual(value)
})
