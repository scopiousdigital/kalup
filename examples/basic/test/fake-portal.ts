// The sandbox target as a fake: loaded with `node --import`, it answers every request from test/fixtures/portal, so
// nothing reaches the network. To regenerate kalup/ from the fixture, run this from the example directory with
// HUBSPOT_SANDBOX_KEY set to any value; the merge keeps the three hand edits (the comment, the alias, .required()):
//   node --import ./test/fake-portal.ts ../../packages/cli/dist/index.mjs pull --target sandbox
import { readFile } from 'node:fs/promises'

const routes: Record<string, string> = {
  '/account-info/2026-09/details': 'account-info.json',
  '/crm-object-schemas/2026-09/schemas': 'schemas.json',
  '/crm/properties/2026-09/companies': 'companies.properties.json',
  '/crm/properties/2026-09/companies/groups': 'companies.groups.json',
  '/crm/properties/2026-09/2-7310001': 'subscription.properties.json',
  '/crm/properties/2026-09/2-7310001/groups': 'subscription.groups.json',
}

const headers = {
  'content-type': 'application/json',
  'x-hubspot-ratelimit-max': '100',
  'x-hubspot-ratelimit-remaining': '99',
  'x-hubspot-ratelimit-interval-milliseconds': '10000',
}

globalThis.fetch = async (input) => {
  const { pathname } = new URL(input instanceof Request ? input.url : String(input))
  const file = routes[pathname]
  if (file === undefined) {
    return new Response(JSON.stringify({ message: `no fixture for ${pathname}` }), { status: 404, headers })
  }
  return new Response(await readFile(new URL(`./fixtures/portal/${file}`, import.meta.url), 'utf8'), {
    status: 200,
    headers,
  })
}
