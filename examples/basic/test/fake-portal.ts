// The example's targets as a fake: loaded with `node --import`, it answers a GET it has a fixture for from
// test/fixtures/portal and rejects any other request, so nothing reaches the network and nothing writes. Both targets
// read the same fixtures; a request carrying the production key (HUBSPOT_PROD_READ_KEY) gets the production portal's
// ID from account-info. To regenerate kalup/ from the fixture, run this from the example directory with
// HUBSPOT_SANDBOX_KEY set to any value; the merge keeps the three hand edits (the comment, the alias, .required()):
//   node --import ./test/fake-portal.ts ../../packages/cli/dist/index.mjs pull --target sandbox
import { readFile } from 'node:fs/promises'

const accountInfo = '/account-info/2026-09/details'
const routes: Record<string, string> = {
  [accountInfo]: 'account-info.json',
  '/crm-object-schemas/2026-09/schemas': 'schemas.json',
  '/crm/properties/2026-09/companies': 'companies.properties.json',
  '/crm/properties/2026-09/companies/groups': 'companies.groups.json',
  '/crm/properties/2026-09/2-7310001': 'subscription.properties.json',
  '/crm/properties/2026-09/2-7310001/groups': 'subscription.groups.json',
  '/crm/limits/2026-09/custom-object-types': 'limits.custom-object-types.json',
  '/crm/limits/2026-09/custom-properties': 'limits.custom-properties.json',
}

const headers = {
  'content-type': 'application/json',
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  const { pathname, searchParams } = new URL(request.url)
  const file = routes[pathname]
  if (request.method !== 'GET' || file === undefined) {
    throw new Error(`the fake portal refuses ${request.method} ${pathname}: it answers a GET it has a fixture for`)
  }
  // The fixture portal has no sensitive and no archived properties: those lists come back empty.
  if (searchParams.has('dataSensitivity') || searchParams.get('archived') === 'true') {
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers })
  }
  const body = await readFile(new URL(`./fixtures/portal/${file}`, import.meta.url), 'utf8')
  const production = process.env.HUBSPOT_PROD_READ_KEY
  if (pathname === accountInfo && production && request.headers.get('authorization') === `Bearer ${production}`) {
    return new Response(JSON.stringify({ ...JSON.parse(body), portalId: 2_222_222 }), { status: 200, headers })
  }
  return new Response(body, { status: 200, headers })
}
