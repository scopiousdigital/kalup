import { expect, test, vi } from 'vitest'
import { createHttp } from '../../src/lib/http.js'
import { holdsScope, readTokenInfo } from '../../src/lib/token-info.js'
import { fakeFetch, jsonResponse } from '../support/testing.js'

const key = 'kalup-test-secret-9f2c'
const info = {
  userId: 7,
  hubId: 1_111_111,
  appId: 42,
  scopes: ['oauth', 'crm.schemas.companies.read', 'crm.objects.companies.sensitive.write.v2'],
  isUserToken: false,
}

test('a 200 with a scope list answers the scopes; the request is a POST with the key in the JSON body', async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(200, info))
  const http = createHttp({ key, fetch, warn: vi.fn() })
  await expect(readTokenInfo(http, key)).resolves.toEqual({ scopes: info.scopes })
  expect(calls[0]?.url).toBe('https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info')
  expect(calls[0]?.init.method).toBe('POST')
  expect(calls[0]?.init.body).toBe(JSON.stringify({ tokenKey: key }))
  expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json')
})

test.each([
  ['a 200 without a scope list', jsonResponse(200, { hubId: 1 })],
  ['a 200 with a list that is not all strings', jsonResponse(200, { scopes: ['oauth', 7] })],
  ['a 403', jsonResponse(403, { status: 'error', message: 'no' })],
  ['a 404', jsonResponse(404, { status: 'error', message: 'no' })],
  ['a 200 whose body is not JSON', new Response('<html>', { status: 200 })],
])('%s is unknown, never an error', async (_, response) => {
  const { fetch } = fakeFetch(response)
  const http = createHttp({ key, fetch, warn: vi.fn() })
  await expect(readTokenInfo(http, key)).resolves.toBeUndefined()
})

test('a scope that echoes the key comes back with the key cut out', async () => {
  const { fetch } = fakeFetch(jsonResponse(200, { scopes: [`oauth-${key}`] }))
  const http = createHttp({ key, fetch, warn: vi.fn() })
  const read = await readTokenInfo(http, key)
  expect(read?.scopes[0]).not.toContain(key)
})

test('holdsScope matches a scope as is or with a version suffix HubSpot adds', () => {
  const held = ['oauth', 'crm.schemas.companies.read', 'crm.objects.companies.sensitive.write.v2']
  expect(holdsScope(held, 'crm.schemas.companies.read')).toBe(true)
  expect(holdsScope(held, 'crm.objects.companies.sensitive.write')).toBe(true)
  expect(holdsScope(held, 'crm.objects.companies.sensitive.write.v2')).toBe(true)
  expect(holdsScope(held, 'crm.schemas.companies.write')).toBe(false)
  expect(holdsScope(held, 'crm.schemas.companies')).toBe(false)
})
