// The fake portal refuses what the CLI must never send, so every example test that runs the CLI through it enforces
// the read-only rule too, and it answers each target's key with that target's portal.
import assert from 'node:assert/strict'
import { test } from 'node:test'

const api = 'https://api.hubapi.com'
const productionKey = 'kalup-test-secret-5a81'
process.env.HUBSPOT_PROD_READ_KEY = productionKey
await import(new URL('./fake-portal.ts', import.meta.url).href)

test('the fake portal refuses a write, and a read of a path it has no fixture for', async () => {
  const body = JSON.stringify({ name: 'plan_tier', label: 'Plan tier' })
  await assert.rejects(fetch(`${api}/crm/properties/2026-09/companies`, { method: 'POST', body }), {
    message: 'the fake portal refuses POST /crm/properties/2026-09/companies: it answers a GET it has a fixture for',
  })
  await assert.rejects(fetch(`${api}/crm/properties/2026-09/companies/groups/billing`, { method: 'DELETE' }))
  await assert.rejects(fetch(`${api}/crm/properties/2026-09/deals`), {
    message: 'the fake portal refuses GET /crm/properties/2026-09/deals: it answers a GET it has a fixture for',
  })
})

test('account-info answers with the portal of the target whose key the request carries', async () => {
  async function portalId(key: string): Promise<unknown> {
    const res = await fetch(`${api}/account-info/2026-09/details`, { headers: { authorization: `Bearer ${key}` } })
    return ((await res.json()) as { portalId: unknown }).portalId
  }
  assert.equal(await portalId('kalup-test-secret-9f2c'), 1_111_111)
  assert.equal(await portalId(productionKey), 2_222_222)
})
