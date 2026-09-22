import { expect, test } from 'vitest'
import { bin, built, commands, disclaimer, flags, usage, version, versionText } from '../src/usage.js'

const whitespace = /\s+/
const semver = /^\d+\.\d+\.\d+/

test('usage lists every command and every flag', () => {
  for (const name of Object.keys(commands)) {
    expect(usage()).toContain(name)
  }
  for (const flag of Object.keys(flags)) {
    expect(usage()).toContain(flag)
  }
})

test('usage marks the commands that are not built yet', () => {
  for (const line of usage().split('\n')) {
    const name = line.trim().split(whitespace)[0] ?? ''
    if (!(name in commands)) {
      continue
    }
    const marked = line.endsWith('(not implemented yet)')
    expect(marked, name).toBe(!(built as readonly string[]).includes(name))
  }
})

test('the version text carries the name, the version and the disclaimer', () => {
  expect(version).toMatch(semver)
  expect(versionText()).toBe(`${bin} ${version}\n${disclaimer}\n`)
  expect(disclaimer).toContain('HubSpot is a registered trademark of HubSpot, Inc.')
})
