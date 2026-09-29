// Scenario: a key pasted across two lines. fetch refuses such a header value and quotes it in its error, so Kalup
// refuses the key first, naming the variable: no command prints the key, and none sends a request with it.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cli } from '../../src/commands/testing.js'
import { environment, portal, project } from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const halves = ['pat-na1-11111111-2222-3333', '4444-555555555555']
const commands = [['plan'], ['plan', '--json'], ['status'], ['snapshot'], ['apply', '--yes']]
const cases = [
  ['a line feed', '\n'],
  ['a carriage return', '\r'],
].flatMap(([name, split]) => commands.map((argv) => [name, argv.join(' '), split, argv] as const))

test.each(cases)('a key with %s never reaches the output of %s', async (_, __, split, argv) => {
  const sim = portal()
  // As undici does: a header value with a line break throws, quoting the whole value.
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    return sim.fetch(input, { ...init, headers })
  })
  const dir = project()
  vi.stubEnv('KESTREL_READ_KEY', halves.join(split))
  const out = await cli(dir, ...argv)
  const printed = `${out.stdout}${out.stderr}`
  expect(out.exitCode).toBe(1)
  expect(printed).toContain('E_KEY_INVALID')
  expect(printed).toContain('The value of KESTREL_READ_KEY holds a line break')
  for (const half of halves) {
    expect(printed).not.toContain(half)
  }
  expect(sim.log).toEqual([])
})
