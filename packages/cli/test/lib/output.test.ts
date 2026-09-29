import { expect, test } from 'vitest'
import { envelope, exitCodes, KalupError, printEnvelope } from '../../src/lib/output.js'

function sink() {
  const chunks: string[] = []
  return { write: (text: string) => chunks.push(text), text: () => chunks.join('') }
}

test('the exit-code table matches the contract', () => {
  expect(exitCodes).toEqual({ done: 0, error: 1, differences: 2, invalid: 3, humanRequired: 4, partial: 5 })
})

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

test('KalupError carries issues and defaults to exit 1', () => {
  const one = new KalupError({ code: 'E_USAGE', message: 'one' })
  expect(one.exitCode).toBe(1)
  expect(one.message).toBe('one')
  expect(one.issues).toHaveLength(1)
  const two = new KalupError(
    [
      { code: 'E_USAGE', message: 'a' },
      { code: 'E_UNEXPECTED', message: 'b' },
    ],
    exitCodes.invalid,
  )
  expect(two.exitCode).toBe(3)
  expect(two.message).toBe('a\nb')
  expect(two).toBeInstanceOf(Error)
})
