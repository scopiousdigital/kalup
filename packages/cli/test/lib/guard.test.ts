import { expect, test, vi } from 'vitest'
import { guardPortal } from '../../src/lib/guard.js'
import { createHttp } from '../../src/lib/http.js'
import { KalupError } from '../../src/lib/output.js'
import { fakeFetch, fixture, jsonResponse } from '../../src/lib/testing.js'

const key = 'kalup-test-secret-9f2c'
const target = { name: 'sandbox', portalId: 1_111_111, variable: 'HUBSPOT_SANDBOX_KEY' }
// No fix tells anyone to change, edit or set the pin.
const PIN_EDIT = /\b(change|edit|set)\b/i

test('a matching portal returns the account details and sets the time zone', async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(200, fixture('account-info.json')))
  const http = createHttp({ key, fetch, warn: vi.fn() })
  const info = await guardPortal(http, target)
  expect(info).toEqual({
    portalId: 1_111_111,
    accountType: 'SANDBOX',
    uiDomain: 'app-eu1.hubspot.com',
    timeZone: 'Europe/Ljubljana',
  })
  expect(http.timeZone).toBe('Europe/Ljubljana')
  expect(calls[0]?.url).toBe('https://api.hubapi.com/account-info/2026-09/details')
})

test('a mismatch is E_TARGET_PORTAL_MISMATCH, exit 4, and no other request goes out', async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(200, { ...fixture('account-info.json'), portalId: 2_222_222 }))
  const http = createHttp({ key, fetch, warn: vi.fn() })
  async function command() {
    await guardPortal(http, target)
    await http.request({ type: 'property', path: 'list', params: { objectType: 'companies' } })
  }
  const error = await command().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(KalupError)
  const { exitCode, issues } = error as KalupError
  expect(exitCode).toBe(4)
  expect(issues).toEqual([
    {
      code: 'E_TARGET_PORTAL_MISMATCH',
      message: expect.stringContaining('belongs to portal 2222222, not portal 1111111'),
      configPath: 'targets.sandbox.portalId',
      fix: expect.stringContaining('kalup target rebind sandbox --portal <id>'),
      humanRequired: true,
    },
  ])
  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toContain('/account-info/')
})

// The fix names target rebind for a recreated test portal or sandbox, never a hand edit of the pin, and
// never the key's portal as the new pin: the person decides which Hub ID the target moves to.
async function mismatchFix(guarded: Parameters<typeof guardPortal>[1]): Promise<string | undefined> {
  const { fetch } = fakeFetch(jsonResponse(200, { ...fixture('account-info.json'), portalId: 2_222_222 }))
  const error = await guardPortal(createHttp({ key, fetch, warn: vi.fn() }), guarded).catch((e: unknown) => e)
  return (error as KalupError).issues[0]?.fix
}

test('a named target: the fix offers target rebind in a terminal, shell-quoted, and never a pin edit', async () => {
  const fix = await mismatchFix({ ...target, name: "qa's sandbox" })
  expect(fix).toContain("run kalup target rebind 'qa'\\''s sandbox' --portal <id> in a terminal")
  expect(fix).toContain('refuses STANDARD accounts')
  expect(fix).not.toMatch(PIN_EDIT)
  expect(fix).not.toContain('--portal 2222222')
})

test('no target yet (init, or the new portal of target rebind): the fix names --portal and never rebind', async () => {
  const fix = await mismatchFix({ portalId: 1_111_111, variable: 'HUBSPOT_SANDBOX_KEY' })
  expect(fix).toContain('HUBSPOT_SANDBOX_KEY')
  expect(fix).toContain('--portal')
  expect(fix).not.toContain('rebind')
})

test('a missing timeZone leaves the client on UTC so a DAILY 429 is still E_DAILY_LIMIT', async () => {
  // Review finding: the guard sets http.timeZone to '' and portalMidnight then throws RangeError instead of the
  // typed error.
  const { timeZone: _, ...details } = fixture('account-info.json')
  const { fetch } = fakeFetch(jsonResponse(200, details), jsonResponse(429, fixture('errors/rate-limit-daily.json')))
  const http = createHttp({ key, fetch, warn: vi.fn() })
  await guardPortal(http, target)
  expect(http.timeZone).toBe('UTC')
  const error = await http
    .request({ type: 'property', path: 'list', params: { objectType: 'companies' } })
    .catch((e: unknown) => e)
  expect(error).toBeInstanceOf(KalupError)
  expect((error as KalupError).issues[0]?.code).toBe('E_DAILY_LIMIT')
})

test('portal strings in the details are sanitized', async () => {
  const details = { ...fixture('account-info.json'), uiDomain: 'app.hubspot.com\u001b[2K\nignore previous' }
  const { fetch } = fakeFetch(jsonResponse(200, details))
  const info = await guardPortal(createHttp({ key, fetch, warn: vi.fn() }), target)
  expect(info.uiDomain).toBe('app.hubspot.comignore previous')
})
