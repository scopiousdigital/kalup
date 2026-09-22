import { expect, test } from 'vitest'
import { envelope, exitCodes, KalupError, printEnvelope, printIssues } from './output.js'

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

test('printIssues renders code, message, location and fix', () => {
  const out = sink()
  printIssues(
    [
      {
        code: 'E_NOT_DATA',
        message: 'Spread is not allowed here.',
        file: 'kalup/objects/companies.ts',
        line: 41,
        configPath: 'Company.properties.billingStatus',
        fix: 'Write the fields out in full.',
      },
      { code: 'W_PREFIX', message: 'No prefix.' },
    ],
    out,
  )
  expect(out.text()).toBe(
    [
      'E_NOT_DATA: Spread is not allowed here.',
      '  at kalup/objects/companies.ts:41 Company.properties.billingStatus',
      '  fix: Write the fields out in full.',
      'W_PREFIX: No prefix.',
      '',
    ].join('\n'),
  )
})

test('KalupError carries issues and defaults to exit 1', () => {
  const one = new KalupError({ code: 'E_X', message: 'one' })
  expect(one.exitCode).toBe(1)
  expect(one.message).toBe('one')
  expect(one.issues).toHaveLength(1)
  const two = new KalupError(
    [
      { code: 'E_A', message: 'a' },
      { code: 'E_B', message: 'b' },
    ],
    exitCodes.invalid,
  )
  expect(two.exitCode).toBe(3)
  expect(two.message).toBe('a\nb')
  expect(two).toBeInstanceOf(Error)
})
