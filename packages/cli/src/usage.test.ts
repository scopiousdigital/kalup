import { expect, test } from 'vitest'
import { commands, usage } from './usage.js'

test('usage lists every command', () => {
  for (const name of Object.keys(commands)) {
    expect(usage()).toContain(name)
  }
})
