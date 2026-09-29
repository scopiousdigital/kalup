import { expect, test } from 'vitest'
import { exitCodes, KalupError } from '../../src/lib/errors.js'

test('the exit-code table matches the contract', () => {
  expect(exitCodes).toEqual({ done: 0, error: 1, differences: 2, invalid: 3, humanRequired: 4, partial: 5 })
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
