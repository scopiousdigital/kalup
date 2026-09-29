import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TargetState } from '@kalup/core'
import { afterEach, expect, test, vi } from 'vitest'
import type { StatusData } from '../../src/commands/status.js'
import { cli, copy, parseEnvelope, project } from '../../src/commands/testing.js'
import { fakeFetch, fixture, jsonResponse } from '../../src/lib/testing.js'
import { printed } from '../support/printed.js'

const key = 'kalup-test-secret-9f2c'
const sandbox = fixture('account-info.json')
const production = { ...sandbox, portalId: 2_222_222, accountType: 'STANDARD' }
const accountInfo = '/account-info/2026-09/details'
const companies = '/crm/properties/2026-09/companies'
const schemas = '/crm-object-schemas/2026-09/schemas'

const listed = () => jsonResponse(200, { results: [] })
const forbidden = () => jsonResponse(403, fixture('errors/missing-scope.json'))
const fine = () => [jsonResponse(200, sandbox), listed(), listed(), jsonResponse(200, production), listed(), listed()]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

function statePath(dir: string, portalId: number): string {
  return join(dir, '.kalup', 'state', `portal-${portalId}.json`)
}

function keys(...variables: string[]): void {
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  for (const variable of variables) {
    vi.stubEnv(variable, key)
  }
}

function stub(...responses: Response[]): ReturnType<typeof fakeFetch> {
  const fake = fakeFetch(...responses)
  vi.stubGlobal('fetch', fake.fetch)
  return fake
}

// A request that gets no answer is retried with backoff. Under fake timers this runs the retries at once: it lets the
// host's file reads finish between steps, and advances the clock while the run waits.
async function pump<T>(pending: Promise<T>): Promise<T> {
  const done = await Promise.race([
    pending.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => setImmediate(() => resolve(false))),
  ])
  if (done) {
    return pending
  }
  await vi.advanceTimersByTimeAsync(1000)
  return pump(pending)
}

function paths(fake: ReturnType<typeof fakeFetch>): string[] {
  return fake.calls.map((call) => new URL(call.url).pathname)
}

test('every target fine: the table, exit 0, and per target the guard then one list call per scope', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  const fake = stub(...fine())
  const out = await cli(project('status'), 'status')
  expect(out.exitCode).toBe(0)
  expect(printed(out)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-1111111.json). Last apply: never
    Target production: portal 2222222 matches, STANDARD, app-eu1.hubspot.com, Europe/Ljubljana, protected: yes
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    "
  `)
  expect(paths(fake)).toEqual([accountInfo, companies, schemas, accountInfo, companies, schemas])
})

test('--json is one envelope with data { config, targets } and the rate warning as its only issue', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  stub(...fine())
  const out = await cli(project('status'), 'status', '--json')
  expect(out.exitCode).toBe(0)
  expect(out.stderr).toBe('')
  const env = parseEnvelope<StatusData>(out.stdout)
  expect(env.ok).toBe(true)
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_RATE_HEADERS'])
  expect(env.data?.config).toEqual({ valid: true, counts: { objects: 2, properties: 5, groups: 2 } })
  // Limits Tracking answered 403 to crm.schemas scopes alone (observed 2026-09-29): recommended, never probed.
  expect(env.data?.recommended).toEqual({
    scope: 'crm.objects.companies.read',
    neededFor: ['the property limit check in plan'],
  })
  const scopes = [
    { scope: 'crm.schemas.companies.read', ok: true, neededFor: ['companies'] },
    { scope: 'crm.schemas.custom.read', ok: true, neededFor: ['object:harvest'] },
  ]
  expect(env.data?.targets).toEqual([
    {
      name: 'sandbox',
      portalId: 1_111_111,
      keyVariable: 'HUBSPOT_SANDBOX_KEY',
      check: 'ok',
      account: {
        portalId: 1_111_111,
        accountType: 'SANDBOX',
        uiDomain: 'app-eu1.hubspot.com',
        timeZone: 'Europe/Ljubljana',
      },
      protected: false,
      protectedBy: 'default',
      scopes,
      state: { path: statePath(project('status'), 1_111_111), exists: false },
    },
    {
      name: 'production',
      portalId: 2_222_222,
      keyVariable: 'HUBSPOT_PROD_READ_KEY',
      check: 'ok',
      account: {
        portalId: 2_222_222,
        accountType: 'STANDARD',
        uiDomain: 'app-eu1.hubspot.com',
        timeZone: 'Europe/Ljubljana',
      },
      protected: true,
      protectedBy: 'config',
      scopes,
      state: { path: statePath(project('status'), 2_222_222), exists: false },
    },
  ])
})

// A copy of the status project whose one target is production on the given config line, against a STANDARD account.
function withProduction(target: string, objects = "companies: { include: ['name'] }, harvest: {}"): string {
  const dir = copy('status')
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    [
      "import { defineConfig } from 'kalup'",
      '',
      'export default defineConfig({',
      `  objects: { ${objects} },`,
      `  targets: { production: { ${target} } },`,
      '})',
      '',
    ].join('\n'),
  )
  return dir
}

test('a STANDARD target whose config does not set protected is protected by default, and the line says so', async () => {
  keys('HUBSPOT_PROD_READ_KEY')
  const dir = withProduction("portalId: 2222222, credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } }")
  stub(jsonResponse(200, production), listed(), listed())
  const human = await cli(dir, 'status')
  expect(human.exitCode).toBe(0)
  expect(printed(human)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target production: portal 2222222 matches, STANDARD, app-eu1.hubspot.com, Europe/Ljubljana, protected: yes (STANDARD account, default)
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    "
  `)
  stub(jsonResponse(200, production), listed(), listed())
  const env = parseEnvelope<StatusData>((await cli(dir, 'status', '--json')).stdout)
  expect(env.data?.targets[0]).toMatchObject({ name: 'production', protected: true, protectedBy: 'default' })
})

test('an account type Kalup does not know is protected by default too: status fails closed as apply does', async () => {
  keys('HUBSPOT_PROD_READ_KEY')
  const dir = withProduction("portalId: 2222222, credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } }")
  stub(jsonResponse(200, { ...production, accountType: 'CRM_TRIAL' }), listed(), listed())
  const human = await cli(dir, 'status')
  expect(human.exitCode).toBe(0)
  expect(printed(human)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target production: portal 2222222 matches, CRM_TRIAL, app-eu1.hubspot.com, Europe/Ljubljana, protected: yes (CRM_TRIAL account, default)
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    "
  `)
})

test('protected: false in config holds on a STANDARD account: the line says no and names no default', async () => {
  keys('HUBSPOT_PROD_READ_KEY')
  const dir = withProduction(
    "portalId: 2222222, protected: false, credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } }",
  )
  stub(jsonResponse(200, production), listed(), listed())
  const human = await cli(dir, 'status')
  expect(human.exitCode).toBe(0)
  expect(printed(human)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target production: portal 2222222 matches, STANDARD, app-eu1.hubspot.com, Europe/Ljubljana, protected: no
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    "
  `)
  stub(jsonResponse(200, production), listed(), listed())
  const env = parseEnvelope<StatusData>((await cli(dir, 'status', '--json')).stdout)
  expect(env.data?.targets[0]).toMatchObject({ name: 'production', protected: false, protectedBy: 'config' })
})

test('products are probed under e-commerce, the scope HubSpot lists, and a 403 names it', async () => {
  keys('HUBSPOT_PROD_READ_KEY')
  const dir = withProduction(
    "portalId: 2222222, credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } }",
    'products: {}',
  )
  const fake = stub(jsonResponse(200, production), forbidden())
  const out = await cli(dir, 'status')
  expect(out.exitCode).toBe(0)
  expect(paths(fake)).toEqual([accountInfo, '/crm/properties/2026-09/products'])
  expect(printed(out)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (1 objects, 5 properties, 2 groups)
    Target production: portal 2222222 matches, STANDARD, app-eu1.hubspot.com, Europe/Ljubljana, protected: yes (STANDARD account, default)
      Scopes: e-commerce missing (needed for products)
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    E_SCOPE: HubSpot refused GET /crm/properties/2026-09/products (403). The key likely lacks the scope e-commerce. HubSpot said: This app hasn't been granted all required scopes (fix: Add the scope e-commerce to the key.) (docs: errors/E_SCOPE.md)
    "
  `)
})

test('two objects that share a scope are one probe and one entry naming both, as init prints them', async () => {
  keys('HUBSPOT_PROD_READ_KEY')
  const dir = withProduction(
    "portalId: 2222222, credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } }",
    'communications: {}, postal_mail: {}',
  )
  const fake = stub(jsonResponse(200, production), forbidden())
  const human = await cli(dir, 'status')
  expect(human.exitCode).toBe(0)
  expect(paths(fake)).toEqual([accountInfo, '/crm/properties/2026-09/communications'])
  expect(printed(human)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target production: portal 2222222 matches, STANDARD, app-eu1.hubspot.com, Europe/Ljubljana, protected: yes (STANDARD account, default)
      Scopes: crm.objects.contacts.read missing (needed for communications, postal_mail)
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    E_SCOPE: HubSpot refused GET /crm/properties/2026-09/communications (403). The key likely lacks the scope crm.objects.contacts.read. HubSpot said: This app hasn't been granted all required scopes (fix: Add the scope crm.objects.contacts.read to the key.) (docs: errors/E_SCOPE.md)
    "
  `)
  stub(jsonResponse(200, production), listed())
  const env = parseEnvelope<StatusData>((await cli(dir, 'status', '--json')).stdout)
  expect(env.data?.targets[0]?.scopes).toEqual([
    { scope: 'crm.objects.contacts.read', ok: true, neededFor: ['communications', 'postal_mail'] },
  ])
})

test('a config with no objects needs no scope: exit 0 and only the guard request', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  const fake = stub(jsonResponse(200, sandbox))
  const dir = copy('status')
  rmSync(join(dir, 'kalup'), { recursive: true })
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    [
      "import { defineConfig } from 'kalup'",
      '',
      'export default defineConfig({',
      '  objects: {},',
      "  targets: { sandbox: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } } },",
      '})',
      '',
    ].join('\n'),
  )
  const out = await cli(dir, 'status')
  expect(out.exitCode).toBe(0)
  expect(printed(out)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (0 objects, 0 properties, 0 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: none needed
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-1111111.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    "
  `)
  expect(paths(fake)).toEqual([accountInfo])
})

test('a missing key is one line naming the variable, E_MISSING_KEY with its fix, exit 1, and no request', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  const fake = stub(jsonResponse(200, sandbox), listed(), listed())
  const human = await cli(project('status'), 'status')
  expect(human.exitCode).toBe(1)
  expect(printed(human)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-1111111.json). Last apply: never
    Target production: HUBSPOT_PROD_READ_KEY is not set.
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    E_MISSING_KEY: HUBSPOT_PROD_READ_KEY is not set. (fix: Set HUBSPOT_PROD_READ_KEY in the environment or in .env in the project directory.) (docs: errors/E_MISSING_KEY.md)
    "
  `)
  expect(paths(fake)).toEqual([accountInfo, companies, schemas])
  stub(jsonResponse(200, sandbox), listed(), listed())
  const json = await cli(project('status'), 'status', '--json')
  expect(json.exitCode).toBe(1)
  const env = parseEnvelope<StatusData>(json.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_RATE_HEADERS', 'E_MISSING_KEY'])
  expect(env.data?.targets[1]).toEqual({
    name: 'production',
    portalId: 2_222_222,
    keyVariable: 'HUBSPOT_PROD_READ_KEY',
    check: 'missing-key',
    reason: 'HUBSPOT_PROD_READ_KEY is not set.',
    scopes: [],
    state: { path: statePath(project('status'), 2_222_222), exists: false },
  })
})

test('the key may come from .env in the project directory', async () => {
  const dir = copy('status')
  writeFileSync(join(dir, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\nHUBSPOT_PROD_READ_KEY=${key}\n`)
  stub(...fine())
  const out = await cli(join(dir, 'kalup'), 'status')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).not.toContain('is not set')
})

test('a .env that cannot be read ends the command as E_UNEXPECTED, exit 1, and sends no request', async () => {
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', '')
  const fake = stub()
  const dir = copy('status')
  mkdirSync(join(dir, '.env'))
  const out = await cli(dir, 'status', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.data).toBeUndefined()
  expect(env.issues.map((issue) => issue.code)).toEqual(['E_UNEXPECTED'])
  expect(env.issues[0]?.message).toContain('EISDIR')
  expect(fake.calls).toHaveLength(0)
})

test('a key HubSpot rejects is check failed, exit 1, and the other target is still checked', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  const fake = stub(
    jsonResponse(401, fixture('errors/unauthorized.json')),
    jsonResponse(200, production),
    listed(),
    listed(),
  )
  const out = await cli(project('status'), 'status')
  expect(out.exitCode).toBe(1)
  expect(printed(out)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: HubSpot rejected the key (401). HubSpot said: Authentication credentials not found.
      State: none (.kalup/state/portal-1111111.json). Last apply: never
    Target production: portal 2222222 matches, STANDARD, app-eu1.hubspot.com, Europe/Ljubljana, protected: yes
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    E_AUTH: HubSpot rejected the key (401). HubSpot said: Authentication credentials not found. (fix: Check that the key is valid and not expired.) (docs: errors/E_AUTH.md)
    "
  `)
  expect(paths(fake)).toEqual([accountInfo, accountInfo, companies, schemas])
  stub(jsonResponse(401, fixture('errors/unauthorized.json')), jsonResponse(200, production), listed(), listed())
  const env = parseEnvelope<StatusData>((await cli(project('status'), 'status', '--json')).stdout)
  expect(env.data?.targets[0]).toMatchObject({ name: 'sandbox', check: 'failed', scopes: [] })
})

test('a 403 on account-info itself is check failed with an E_SCOPE issue, exit 1, and no list call', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  const fake = stub(forbidden())
  const out = await cli(project('status'), 'status', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope<StatusData>(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues.find((issue) => issue.code === 'E_SCOPE')).toMatchObject({
    message: expect.stringContaining('GET /account-info/2026-09/details (403)'),
    docs: 'errors/E_SCOPE.md',
  })
  expect(env.data?.targets[0]).toMatchObject({
    check: 'failed',
    reason: expect.stringContaining('(403)'),
    scopes: [],
  })
  expect(paths(fake)).toEqual([accountInfo])
})

test('a fetch that keeps rejecting is E_UNREACHABLE with the error text after the retries, exit 1', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let attempts = 0
  vi.stubGlobal('fetch', () => {
    attempts += 1
    return Promise.reject(new TypeError('fetch failed\nsecond line'))
  })
  const out = await pump(cli(project('status'), 'status', '--target', 'sandbox', '--json'))
  expect(out.exitCode).toBe(1)
  expect(attempts).toBe(4)
  const env = parseEnvelope<StatusData>(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues).toEqual([expect.objectContaining({ code: 'E_UNREACHABLE', docs: 'errors/E_UNREACHABLE.md' })])
  // The error text is kept on one line.
  const message = env.issues[0]?.message
  expect(message).toContain('fetch failedsecond line')
  expect(env.data?.targets).toHaveLength(1)
  expect(env.data?.targets[0]).toMatchObject({ name: 'sandbox', check: 'unreachable', reason: message })
})

test('a portal mismatch is one line and an E_TARGET_PORTAL_MISMATCH issue, exit 4, and no list call there', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  const fake = stub(
    jsonResponse(200, sandbox),
    listed(),
    listed(),
    jsonResponse(200, { ...production, portalId: 3_333_333 }),
  )
  const out = await cli(project('status'), 'status')
  expect(out.exitCode).toBe(4)
  expect(printed(out)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-1111111.json). Last apply: never
    Target production: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333, not portal 2222222 pinned for target production.
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    E_TARGET_PORTAL_MISMATCH: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333, not portal 2222222 pinned for target production. (fix: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333. Ask the user to check the key and the pinned portalId for target production. For a recreated test portal or sandbox, the user can run kalup target rebind production --portal <id> in a terminal; it refuses STANDARD accounts.) (docs: errors/E_TARGET_PORTAL_MISMATCH.md)
    "
  `)
  expect(paths(fake)).toEqual([accountInfo, companies, schemas, accountInfo])
})

test('--target naming the mismatched target exits 4 with humanRequired', async () => {
  keys('HUBSPOT_PROD_READ_KEY')
  const fake = stub(jsonResponse(200, { ...production, portalId: 3_333_333 }))
  const out = await cli(project('status'), 'status', '--target', 'production', '--json')
  expect(out.exitCode).toBe(4)
  const env = parseEnvelope<StatusData>(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues.find((issue) => issue.code === 'E_TARGET_PORTAL_MISMATCH')).toMatchObject({
    configPath: 'targets.production.portalId',
    fix: expect.stringContaining('target production'),
    humanRequired: true,
  })
  expect(env.data?.targets).toHaveLength(1)
  expect(env.data?.targets[0]).toMatchObject({ name: 'production', check: 'mismatch' })
  expect(paths(fake)).toEqual([accountInfo])
})

// decisions.md 18: E_TARGET_PORTAL_MISMATCH exits 4, a person must act, so the sweep without --target does too.
test('a mismatch on any target exits 4 without --target too, as its issue is humanRequired', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  stub(jsonResponse(200, sandbox), listed(), listed(), jsonResponse(200, { ...production, portalId: 3_333_333 }))
  const out = await cli(project('status'), 'status', '--json')
  const env = parseEnvelope<StatusData>(out.stdout)
  expect(env.issues.find((issue) => issue.code === 'E_TARGET_PORTAL_MISMATCH')?.humanRequired).toBe(true)
  expect(out.exitCode).toBe(4)
})

test('a 403 on a list call names the missing scope and what needs it, as a reported gap with exit 0', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  stub(jsonResponse(200, sandbox), listed(), forbidden())
  const human = await cli(project('status'), 'status', '--target', 'sandbox')
  expect(human.exitCode).toBe(0)
  expect(printed(human)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read missing (needed for object:harvest)
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-1111111.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    E_SCOPE: HubSpot refused GET /crm-object-schemas/2026-09/schemas (403). The key likely lacks the scope crm.schemas.custom.read. HubSpot said: This app hasn't been granted all required scopes (fix: Add the scope crm.schemas.custom.read to the key.) (docs: errors/E_SCOPE.md)
    "
  `)
  stub(jsonResponse(200, sandbox), forbidden(), listed())
  const json = await cli(project('status'), 'status', '--target', 'sandbox', '--json')
  expect(json.exitCode).toBe(0)
  const env = parseEnvelope<StatusData>(json.stdout)
  expect(env.ok).toBe(true)
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_RATE_HEADERS', 'E_SCOPE'])
  expect(env.data?.targets[0]?.scopes).toEqual([
    { scope: 'crm.schemas.companies.read', ok: false, neededFor: ['companies'] },
    { scope: 'crm.schemas.custom.read', ok: true, neededFor: ['object:harvest'] },
  ])
})

test('a list call that fails for another reason is reported as failed with its code, exit 1', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  stub(jsonResponse(200, sandbox), jsonResponse(404, { message: 'Unable to infer object type' }), listed())
  const human = await cli(project('status'), 'status', '--target', 'sandbox')
  expect(human.exitCode).toBe(1)
  expect(printed(human)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read failed (E_HTTP), crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-1111111.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    E_HTTP: HubSpot returned 404 for GET /crm/properties/2026-09/companies. HubSpot said: Unable to infer object type (docs: errors/E_HTTP.md)
    "
  `)
  stub(jsonResponse(200, sandbox), jsonResponse(404, { message: 'Unable to infer object type' }), listed())
  const env = parseEnvelope<StatusData>(
    (await cli(project('status'), 'status', '--target', 'sandbox', '--json')).stdout,
  )
  expect(env.ok).toBe(false)
  expect(env.data?.targets[0]?.scopes[0]).toEqual({
    scope: 'crm.schemas.companies.read',
    ok: false,
    neededFor: ['companies'],
    error: 'E_HTTP',
  })
})

test('a 5xx on a probe is retried three times, then reported as failed (E_HTTP), exit 1', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  const down = () => jsonResponse(503, { message: 'Service unavailable' })
  const fake = stub(jsonResponse(200, sandbox), down(), down(), down(), down(), listed())
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const pending = cli(project('status'), 'status', '--target', 'sandbox')
  await vi.advanceTimersByTimeAsync(10_000)
  const out = await pending
  expect(out.exitCode).toBe(1)
  expect(printed(out)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read failed (E_HTTP), crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-1111111.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    E_HTTP: HubSpot returned 503 for GET /crm/properties/2026-09/companies. HubSpot said: Service unavailable (docs: errors/E_HTTP.md)
    "
  `)
  expect(paths(fake)).toEqual([accountInfo, companies, companies, companies, companies, schemas])
})

const broken = [
  "import { defineObject, type InferProperties, p } from '@kalup/core'",
  '',
  "export const Plot = defineObject('plots', {",
  '  properties: {',
  ...['a', 'b', 'c', 'd'].map(
    (n) => `    ${n}: p.string('${n}', { label: '${n}', group: 'nowhere', fieldType: 'text' }),`,
  ),
  '  },',
  '})',
  '',
  'export type PlotData = InferProperties<typeof Plot.properties> & { id: string }',
  '',
].join('\n')

test('an invalid config exits 3 with the first three issues and sends no request', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  const fake = stub(...fine())
  const dir = copy('status')
  writeFileSync(join(dir, 'kalup', 'objects', 'plots.ts'), broken)
  const json = await cli(dir, 'status', '--json')
  expect(json.exitCode).toBe(3)
  expect(json.stderr).toBe('')
  const env = parseEnvelope(json.stdout)
  expect(env.ok).toBe(false)
  expect(env.data).toBeUndefined()
  expect(env.issues.map((issue) => issue.code)).toEqual(['E_UNKNOWN_GROUP', 'E_UNKNOWN_GROUP', 'E_UNKNOWN_GROUP'])
  const human = await cli(dir, 'status')
  expect(human.exitCode).toBe(3)
  expect(human.stdout).toBe('')
  expect(human.stderr.trimEnd().split('\n')).toHaveLength(3)
  expect(fake.calls).toHaveLength(0)
})

test('--target naming an undeclared target exits 3 with E_UNKNOWN_TARGET and sends no request', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  const fake = stub(...fine())
  const out = await cli(project('status'), 'status', '--target', 'nowhere', '--json')
  expect(out.exitCode).toBe(3)
  expect(parseEnvelope(out.stdout).issues.map((issue) => issue.code)).toEqual(['E_UNKNOWN_TARGET'])
  expect(fake.calls).toHaveLength(0)
})

test('status lists every target and marks the one defaultTarget names, in the text and the JSON', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  const dir = copy('status')
  const config = readFileSync(join(dir, 'kalup.config.ts'), 'utf8')
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    config.replace("  name: 'orchard-status',\n", "  name: 'orchard-status',\n  defaultTarget: 'production',\n"),
  )
  stub(...fine())
  const human = await cli(dir, 'status')
  expect(human.exitCode).toBe(0)
  expect(printed(human)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-1111111.json). Last apply: never
    Target production (defaultTarget): portal 2222222 matches, STANDARD, app-eu1.hubspot.com, Europe/Ljubljana, protected: yes
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: none (.kalup/state/portal-2222222.json). Last apply: never
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    "
  `)
  stub(...fine())
  const env = parseEnvelope<StatusData>((await cli(dir, 'status', '--json')).stdout)
  expect(env.data?.targets.map((t) => [t.name, t.default])).toEqual([
    ['sandbox', undefined],
    ['production', true],
  ])
  expect(env.data?.targets[0]).not.toHaveProperty('default')
  // --target still filters, and the default keeps its mark.
  stub(jsonResponse(200, production), listed(), listed())
  const one = parseEnvelope<StatusData>((await cli(dir, 'status', '--target', 'production', '--json')).stdout)
  expect(one.data?.targets).toMatchObject([{ name: 'production', default: true }])
  // A target that fails its check is marked too.
  vi.stubEnv('HUBSPOT_PROD_READ_KEY', undefined)
  stub(jsonResponse(200, sandbox), listed(), listed())
  expect((await cli(dir, 'status')).stdout).toContain('Target production (defaultTarget): ')
})

/** A state file for the sandbox portal, with this last apply. */
function withState(dir: string, lastApply?: TargetState['lastApply']): void {
  const state: TargetState = {
    format: 'kalup.state/1',
    lineage: '5e1d0c7a9b3f2468',
    serial: 7,
    portalId: 1_111_111,
    resources: {},
    ...(lastApply ? { lastApply } : {}),
  }
  mkdirSync(join(dir, '.kalup', 'state'), { recursive: true })
  writeFileSync(statePath(dir, 1_111_111), `${JSON.stringify(state)}\n`)
}

const applied = { planId: 'pl_0a1b2c3d4e5f', writesHash: `sha256:${'0'.repeat(64)}`, actor: 'terminal' }

test("the pinned portal's state file: its path, lineage and serial, and the last apply; status writes nothing", async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  stub(jsonResponse(200, sandbox), listed(), listed())
  const dir = copy('status')
  withState(dir, { ...applied, at: '2026-09-25T09:40:13.864Z', outcome: 'done' })
  const before = readFileSync(statePath(dir, 1_111_111), 'utf8')
  const out = await cli(dir, 'status', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<StatusData>(out.stdout).data?.targets[0]?.state).toEqual({
    path: statePath(dir, 1_111_111),
    exists: true,
    lineage: '5e1d0c7a9b3f2468',
    serial: 7,
    lastApply: { planId: 'pl_0a1b2c3d4e5f', at: '2026-09-25T09:40:13.864Z', outcome: 'done' },
  })
  stub(jsonResponse(200, sandbox), listed(), listed())
  expect(printed(await cli(dir, 'status', '--target', 'sandbox'))).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: .kalup/state/portal-1111111.json, lineage <lineage>, serial 7. Last apply: plan pl_<id> at <time>, done
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    "
  `)
  expect(readFileSync(statePath(dir, 1_111_111), 'utf8')).toBe(before)
})

test('a last apply still running reads as an apply that did not finish, with kalup plan next', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  stub(jsonResponse(200, sandbox), listed(), listed())
  const dir = copy('status')
  withState(dir, { ...applied, at: '2026-09-25T09:40:13.864Z', outcome: 'running' })
  const out = await cli(dir, 'status', '--target', 'sandbox')
  expect(out.exitCode).toBe(0)
  expect(printed(out)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (2 objects, 5 properties, 2 groups)
    Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      State: .kalup/state/portal-1111111.json, lineage <lineage>, serial 7. Last apply: plan pl_<id> at <time>: an apply did not finish; run kalup plan
    --- stderr
    W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
    "
  `)
})

test('a state file that cannot be read is one issue on its target, E_STATE_INVALID and exit 1', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  stub(jsonResponse(200, sandbox), listed(), listed())
  const dir = copy('status')
  mkdirSync(join(dir, '.kalup', 'state'), { recursive: true })
  writeFileSync(statePath(dir, 1_111_111), '{}\n')
  const out = await cli(dir, 'status', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope<StatusData>(out.stdout)
  expect(env.data?.targets[0]?.state).toEqual({
    path: statePath(dir, 1_111_111),
    exists: true,
    error: 'E_STATE_INVALID',
  })
  expect(env.issues.map((issue) => issue.code)).toContain('E_STATE_INVALID')
})

test('a registry pin within 90 days of its expiry is a W_PIN_EXPIRES warning, one per API family', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  stub(...fine(), ...fine())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2028-01-15T00:00:00Z'))
  const near = parseEnvelope<StatusData>((await cli(project('status'), 'status', '--json')).stdout)
  const pins = near.issues.filter((issue) => issue.code === 'W_PIN_EXPIRES').map((issue) => issue.message)
  expect(pins).toMatchInlineSnapshot(`
    [
      "the crm.properties API pin 2026-09 expires 2028-03",
      "the crm-object-schemas API pin 2026-09 expires 2028-03",
      "the account-info API pin 2026-09 expires 2028-03",
      "the crm.limits API pin 2026-09 expires 2028-03",
    ]
  `)
  vi.setSystemTime(new Date('2027-11-01T00:00:00Z'))
  const far = parseEnvelope<StatusData>((await cli(project('status'), 'status', '--json')).stdout)
  expect(far.issues.some((issue) => issue.code === 'W_PIN_EXPIRES')).toBe(false)
})

// A custom object named in config with no object file yet (config edited before the first pull, or a pull whose
// schemas list was refused) is still a custom object: no properties list under a scope HubSpot does not have.
test('a custom object named in config before its first pull is checked under crm.schemas.custom.read', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  const dir = copy('status')
  rmSync(join(dir, 'kalup', 'objects', 'harvest.ts'))
  writeFileSync(
    join(dir, 'kalup', 'index.ts'),
    "export type { CompanyData } from './objects/companies'\nexport { Company } from './objects/companies'\n",
  )
  const fake = stub(jsonResponse(200, sandbox), listed(), listed())
  const out = await cli(dir, 'status', '--target', 'sandbox')
  expect(out.stdout).not.toContain('crm.schemas.harvest.read')
  expect(out.stdout).toContain('crm.schemas.custom.read ok')
  expect(paths(fake)).toEqual([accountInfo, companies, schemas])
})

const both = () => keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
const scenarios: Record<string, () => string> = {
  fine: () => {
    both()
    stub(...fine())
    return project('status')
  },
  'missing key': () => {
    keys('HUBSPOT_SANDBOX_KEY')
    stub(jsonResponse(200, sandbox), listed(), listed())
    return project('status')
  },
  '.env': () => {
    const dotenv = copy('status')
    writeFileSync(join(dotenv, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\nHUBSPOT_PROD_READ_KEY=${key}\n`)
    stub(...fine())
    return dotenv
  },
  '401': () => {
    both()
    stub(jsonResponse(401, fixture('errors/unauthorized.json')), jsonResponse(200, production), listed(), listed())
    return project('status')
  },
  '403': () => {
    both()
    stub(jsonResponse(200, sandbox), forbidden(), forbidden(), jsonResponse(200, production), forbidden(), forbidden())
    return project('status')
  },
  mismatch: () => {
    both()
    stub(jsonResponse(200, { ...sandbox, portalId: 9_999_999 }), jsonResponse(200, production), listed(), listed())
    return project('status')
  },
  'network failure': () => {
    both()
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')))
    return project('status')
  },
}

test.each(
  Object.entries(scenarios).flatMap(([name, setup]) => [
    { name, setup, json: [] },
    { name, setup, json: ['--json'] },
  ]),
)('no output of any path carries the key: $name $json', async ({ name, setup, json }) => {
  const dir = setup()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const out = await pump(cli(dir, 'status', ...json))
  const text = `${out.stdout}${out.stderr}`
  expect(text, [name, ...json].join(' ')).not.toContain(key)
  expect(text.length, [name, ...json].join(' ')).toBeGreaterThan(0)
})
