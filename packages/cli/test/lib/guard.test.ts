import { expect, test, vi } from 'vitest'
import { guardPortal } from '../../src/lib/guard.js'
import { createHttp } from '../../src/lib/http.js'
import { KalupError } from '../../src/lib/output.js'
import { fakeFetch, fixture, jsonResponse } from '../../src/lib/testing.js'

const key = 'kalup-test-secret-9f2c'
const target = { name: 'sandbox', portalId: 1_111_111, variable: 'HUBSPOT_SANDBOX_KEY' }

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
      message:
        'The key in HUBSPOT_SANDBOX_KEY belongs to portal 2222222, not portal 1111111 pinned for target sandbox.',
      configPath: 'targets.sandbox.portalId',
      fix: 'The key in HUBSPOT_SANDBOX_KEY belongs to portal 2222222. Ask the user to check the key and the pinned portalId for target sandbox.',
      humanRequired: true,
    },
  ])
  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toContain('/account-info/')
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
