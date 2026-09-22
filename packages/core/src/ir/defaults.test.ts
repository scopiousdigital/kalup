import { expect, test } from 'vitest'
import { DEFAULTS } from './defaults.js'

test('the default table is the one the spec lists', () => {
  expect(DEFAULTS).toEqual({
    definition: { description: '', options: [], hasUniqueValue: false, formField: false },
    option: { hidden: false },
    lifecycle: { options: 'additive' },
  })
})
