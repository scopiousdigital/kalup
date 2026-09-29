import { expect, test } from 'vitest'
import { envelope, printEnvelope } from '../../src/lib/output.js'

function sink() {
  const chunks: string[] = []
  return { write: (text: string) => chunks.push(text), text: () => chunks.join('') }
}

test('envelope builds the envelope/1 shape and leaves data out when there is none', () => {
  expect(envelope(true, { count: 1 })).toEqual({ format: 'envelope/1', ok: true, data: { count: 1 }, issues: [] })
  const failed = envelope(false, undefined, [{ code: 'E_NOT_DATA', message: 'no' }])
  expect(failed).toEqual({ format: 'envelope/1', ok: false, issues: [{ code: 'E_NOT_DATA', message: 'no' }] })
  expect('data' in failed).toBe(false)
  expect(Object.keys(envelope(true, null))).toEqual(['format', 'ok', 'data', 'issues'])
})

test('printEnvelope writes exactly one JSON document', () => {
  const out = sink()
  printEnvelope(envelope(true), out)
  expect(out.text().endsWith('\n')).toBe(true)
  expect(JSON.parse(out.text())).toEqual({ format: 'envelope/1', ok: true, issues: [] })
})

test('printEnvelope writes a C1 control in an issue or in data as a \\u escape that parses back, in envelope key order', () => {
  const csi = String.fromCodePoint(0x9b)
  const env = envelope(false, { label: `Fleet${csi}31m` }, [{ code: 'E_USAGE', message: `depot${csi}2J` }])
  const out = sink()
  printEnvelope(env, out)
  expect(out.text()).not.toContain(csi)
  expect(out.text()).toContain('"message": "depot\\u009b2J"')
  expect(out.text()).toContain('"label": "Fleet\\u009b31m"')
  expect(JSON.parse(out.text())).toEqual(env)
  expect(Object.keys(JSON.parse(out.text()))).toEqual(['format', 'ok', 'data', 'issues'])
})
