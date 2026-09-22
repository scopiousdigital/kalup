import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { fakeFetch, fixture, jsonResponse } from '../lib/testing.js'
import { bin, version } from '../usage.js'
import type { StatusData } from './status.js'
import { cli, copy, parseEnvelope, project } from './testing.js'

const key = 'kalup-test-secret-9f2c'
const sandbox = fixture('account-info.json')
const production = { ...sandbox, portalId: 2222222, accountType: 'STANDARD' }
const rateWarning = 'W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second.\n'
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

function keys(...variables: string[]): void {
  for (const variable of variables) vi.stubEnv(variable, key)
}

function stub(...responses: Response[]): ReturnType<typeof fakeFetch> {
  const fake = fakeFetch(...responses)
  vi.stubGlobal('fetch', fake.fetch)
  return fake
}

function paths(fake: ReturnType<typeof fakeFetch>): string[] {
  return fake.calls.map((call) => new URL(call.url).pathname)
}

test('every target fine: the table, exit 0, and per target the guard then one list call per scope', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  const fake = stub(...fine())
  const out = await cli(project('status'), 'status')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe(
    [
      `${bin} ${version}`,
      'Config: valid (2 objects, 5 properties, 2 groups)',
      'Target sandbox: portal 1111111 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana',
      '  Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok',
      '  State: none. Last apply: never',
      'Target production: portal 2222222 matches, STANDARD, app-eu1.hubspot.com, Europe/Ljubljana',
      '  Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok',
      '  State: none. Last apply: never',
      '',
    ].join('\n'),
  )
  expect(out.stderr).toBe(rateWarning)
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
  const scopes = [
    { scope: 'crm.schemas.companies.read', ok: true, neededFor: ['companies'] },
    { scope: 'crm.schemas.custom.read', ok: true, neededFor: ['object:harvest'] },
  ]
  expect(env.data?.targets).toEqual([
    {
      name: 'sandbox',
      portalId: 1111111,
      keyVariable: 'HUBSPOT_SANDBOX_KEY',
      check: 'ok',
      account: {
        portalId: 1111111,
        accountType: 'SANDBOX',
        uiDomain: 'app-eu1.hubspot.com',
        timeZone: 'Europe/Ljubljana',
      },
      scopes,
      state: 'none',
    },
    {
      name: 'production',
      portalId: 2222222,
      keyVariable: 'HUBSPOT_PROD_READ_KEY',
      check: 'ok',
      account: {
        portalId: 2222222,
        accountType: 'STANDARD',
        uiDomain: 'app-eu1.hubspot.com',
        timeZone: 'Europe/Ljubljana',
      },
      scopes,
      state: 'none',
    },
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
  expect(out.stdout).toContain('Config: valid (0 objects, 0 properties, 0 groups)\n')
  expect(out.stdout).toContain('  Scopes: none needed\n')
  expect(paths(fake)).toEqual([accountInfo])
})

test('a missing key is one line naming the variable, E_MISSING_KEY with its fix, exit 1, and no request', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  const fake = stub(jsonResponse(200, sandbox), listed(), listed())
  const human = await cli(project('status'), 'status')
  expect(human.exitCode).toBe(1)
  expect(human.stdout).toContain('Target sandbox: portal 1111111 matches')
  expect(human.stdout).toContain('Target production: HUBSPOT_PROD_READ_KEY is not set.\n')
  expect(human.stderr).toContain(
    'E_MISSING_KEY: HUBSPOT_PROD_READ_KEY is not set. (fix: Set HUBSPOT_PROD_READ_KEY in the environment or in .env in the project directory.)',
  )
  expect(paths(fake)).toEqual([accountInfo, companies, schemas])
  stub(jsonResponse(200, sandbox), listed(), listed())
  const json = await cli(project('status'), 'status', '--json')
  expect(json.exitCode).toBe(1)
  const env = parseEnvelope<StatusData>(json.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_RATE_HEADERS', 'E_MISSING_KEY'])
  expect(env.data?.targets[1]).toEqual({
    name: 'production',
    portalId: 2222222,
    keyVariable: 'HUBSPOT_PROD_READ_KEY',
    check: 'missing-key',
    reason: 'HUBSPOT_PROD_READ_KEY is not set.',
    scopes: [],
    state: 'none',
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
  expect(out.stdout).toContain(
    'Target sandbox: HubSpot rejected the key (401). HubSpot said: Authentication credentials not found.\n',
  )
  expect(out.stdout).toContain('Target production: portal 2222222 matches, STANDARD')
  expect(out.stderr).toContain('E_AUTH: HubSpot rejected the key (401).')
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
  expect(env.issues.find((issue) => issue.code === 'E_SCOPE')).toEqual({
    code: 'E_SCOPE',
    message: expect.stringContaining('HubSpot refused GET /account-info/2026-09/details (403).'),
    fix: 'Check the scopes of the key.',
  })
  expect(env.data?.targets[0]).toMatchObject({
    check: 'failed',
    reason: expect.stringContaining('(403)'),
    scopes: [],
  })
  expect(paths(fake)).toEqual([accountInfo])
})

test('a fetch that rejects is E_UNREACHABLE with the error text, exit 1', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed\nsecond line')))
  const out = await cli(project('status'), 'status', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope<StatusData>(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues).toEqual([{ code: 'E_UNREACHABLE', message: 'fetch failedsecond line' }])
  expect(env.data?.targets).toHaveLength(1)
  expect(env.data?.targets[0]).toMatchObject({
    name: 'sandbox',
    check: 'unreachable',
    reason: 'fetch failedsecond line',
  })
})

test('a portal mismatch is one line and an E_TARGET_PORTAL_MISMATCH issue, exit 4, and no list call there', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  const fake = stub(
    jsonResponse(200, sandbox),
    listed(),
    listed(),
    jsonResponse(200, { ...production, portalId: 3333333 }),
  )
  const out = await cli(project('status'), 'status')
  expect(out.exitCode).toBe(4)
  expect(out.stdout).toContain(
    'Target production: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333, not portal 2222222 pinned for target production.\n',
  )
  expect(out.stderr).toContain('E_TARGET_PORTAL_MISMATCH: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333')
  expect(paths(fake)).toEqual([accountInfo, companies, schemas, accountInfo])
})

test('--target naming the mismatched target exits 4 with humanRequired', async () => {
  keys('HUBSPOT_PROD_READ_KEY')
  const fake = stub(jsonResponse(200, { ...production, portalId: 3333333 }))
  const out = await cli(project('status'), 'status', '--target', 'production', '--json')
  expect(out.exitCode).toBe(4)
  const env = parseEnvelope<StatusData>(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues.find((issue) => issue.code === 'E_TARGET_PORTAL_MISMATCH')).toMatchObject({
    configPath: 'targets.production.portalId',
    fix: expect.stringContaining('check the key and the pinned portalId for target production'),
    humanRequired: true,
  })
  expect(env.data?.targets).toHaveLength(1)
  expect(env.data?.targets[0]).toMatchObject({ name: 'production', check: 'mismatch' })
  expect(paths(fake)).toEqual([accountInfo])
})

// decisions.md 18: E_TARGET_PORTAL_MISMATCH exits 4, a person must act, so the sweep without --target does too.
test('a mismatch on any target exits 4 without --target too, as its issue is humanRequired', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  stub(jsonResponse(200, sandbox), listed(), listed(), jsonResponse(200, { ...production, portalId: 3333333 }))
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
  expect(human.stdout).toContain(
    '  Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read missing (needed for object:harvest)\n',
  )
  expect(human.stderr).toContain(
    'E_SCOPE: HubSpot refused GET /crm-object-schemas/2026-09/schemas (403). The key likely lacks the scope crm.schemas.custom.read.',
  )
  expect(human.stderr).toContain('(fix: Add the scope crm.schemas.custom.read to the key.)')
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
  expect(human.stdout).toContain('  Scopes: crm.schemas.companies.read failed (E_HTTP), crm.schemas.custom.read ok\n')
  expect(human.stderr).toContain('E_HTTP: HubSpot returned 404 for GET /crm/properties/2026-09/companies.')
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
  expect(out.stdout).toContain('  Scopes: crm.schemas.companies.read failed (E_HTTP), crm.schemas.custom.read ok\n')
  expect(out.stderr).toContain('E_HTTP: HubSpot returned 503 for GET /crm/properties/2026-09/companies.')
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

test('an existing .kalup/state/<target>.json is reported as present, and last apply stays never', async () => {
  keys('HUBSPOT_SANDBOX_KEY')
  stub(jsonResponse(200, sandbox), listed(), listed())
  const dir = copy('status')
  mkdirSync(join(dir, '.kalup', 'state'), { recursive: true })
  writeFileSync(join(dir, '.kalup', 'state', 'sandbox.json'), '{}\n')
  const out = await cli(dir, 'status', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<StatusData>(out.stdout).data?.targets[0]).toMatchObject({ state: 'present' })
  stub(jsonResponse(200, sandbox), listed(), listed())
  expect((await cli(dir, 'status', '--target', 'sandbox')).stdout).toContain('  State: present. Last apply: never\n')
})

test('a registry pin within 90 days of its expiry is a W_PIN_EXPIRES warning, one per API family', async () => {
  keys('HUBSPOT_SANDBOX_KEY', 'HUBSPOT_PROD_READ_KEY')
  stub(...fine(), ...fine())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2028-01-15T00:00:00Z'))
  const near = parseEnvelope<StatusData>((await cli(project('status'), 'status', '--json')).stdout)
  expect(near.issues.filter((issue) => issue.code === 'W_PIN_EXPIRES').map((issue) => issue.message)).toEqual([
    'the crm.properties API pin 2026-09 expires 2028-03',
    'the crm-object-schemas API pin 2026-09 expires 2028-03',
    'the account-info API pin 2026-09 expires 2028-03',
    'the crm.limits API pin 2026-09 expires 2028-03',
  ])
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
  expect(out.stdout).toContain('  Scopes: crm.schemas.companies.read ok, crm.schemas.custom.read ok\n')
  expect(paths(fake)).toEqual([accountInfo, companies, schemas])
})

test('no output of any path carries the key: fine, missing key, .env, 401, 403, mismatch, network failure', async () => {
  const dotenv = copy('status')
  writeFileSync(join(dotenv, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\nHUBSPOT_PROD_READ_KEY=${key}\n`)
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
      stub(
        jsonResponse(200, sandbox),
        forbidden(),
        forbidden(),
        jsonResponse(200, production),
        forbidden(),
        forbidden(),
      )
      return project('status')
    },
    mismatch: () => {
      both()
      stub(jsonResponse(200, { ...sandbox, portalId: 9999999 }), jsonResponse(200, production), listed(), listed())
      return project('status')
    },
    'network failure': () => {
      both()
      vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')))
      return project('status')
    },
  }
  for (const [name, setup] of Object.entries(scenarios)) {
    for (const json of [[], ['--json']]) {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      const dir = setup()
      const out = await cli(dir, 'status', ...json)
      const text = `${out.stdout}${out.stderr}`
      expect(text, [name, ...json].join(' ')).not.toContain(key)
      expect(text.length, [name, ...json].join(' ')).toBeGreaterThan(0)
    }
  }
})
