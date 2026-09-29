// Scenario: a timeout, a rate limit, a scope failure or an incomplete read. A timed-out POST is sent once and never
// reported done without a read-back that shows it; a non-daily 429 is waited out with a new read and one successful
// write; a daily 429 stops the run with nothing sent after it; a 403 on a write is rejected naming the write scope;
// a 403 on a list blocks the plan's steps there with scope and makes apply refuse with E_INCOMPLETE before writing;
// a create refused because its name exists says so. In no case is a resource taken for absent.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cli, parseEnvelope } from '../../src/commands/testing.js'
import { fault, type PortalSim } from '../support/portal-sim.js'
import {
  APIARY,
  apiary,
  apply,
  applyNow,
  companies,
  edit,
  effects,
  environment,
  groups,
  HIVE_COUNT,
  HONEY_GRADE,
  hiveCount,
  honeyGrade,
  lines,
  liveProperty,
  notRead,
  objectsFile,
  onFakeTime,
  planOf,
  portal,
  portalId,
  project,
  savePlan,
  stateBytes,
  stateOf,
  writesOf,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const missingScope = {
  status: 'error',
  category: 'MISSING_SCOPES',
  correlationId: '3b1f7c2e-5a40-4d8e-9c61-0e2d4f6a8b10',
  message: 'This app has not been granted all required scopes',
}

function propertyPosts(sim: PortalSim): string[] {
  return sim.log.filter((r) => r.method === 'POST' && r.path === companies).map((r) => String(r.status))
}

test('timeout: a POST with no answer is sent exactly once and reported uncertain, exit 5', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  sim.fault({ method: 'POST', path: companies, action: fault.timeout() })
  const out = await onFakeTime(() => apply(dir, 'plan.json', '--yes', '--json'))
  expect(out.exitCode, out.stdout).toBe(5)
  expect(out.env?.ok).toBe(false)
  expect(out.data?.outcome).toBe('uncertain')
  expect(out.data?.steps.map((s) => [s.address, s.outcome])).toEqual([
    [apiary, 'done'],
    [hiveCount, 'uncertain'],
  ])
  expect(propertyPosts(sim)).toEqual(['null'])
  expect(stateOf(dir).resources[hiveCount]).toBeUndefined()
  expect(stateOf(dir).lastApply?.outcome).toBe('uncertain')
  expect(out.codes).toContain('E_UNCERTAIN_WRITE')
  expect(sim.object(portalId, 'companies').properties.has('hive_count')).toBe(false)
})

test('timeout: a POST HubSpot applied without answering is done only on read-back evidence, sent once, exit 0', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  sim.fault({ method: 'POST', path: companies, action: fault.timeout({ apply: true }) })
  const out = await onFakeTime(() => apply(dir, 'plan.json', '--yes', '--json'))
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.data?.steps.map((s) => s.outcome)).toEqual(['done', 'done'])
  expect(propertyPosts(sim)).toEqual(['null'])
  const readBack = sim.log.slice(sim.log.findIndex((r) => r.method === 'POST' && r.path === companies) + 1)
  expect(readBack[0]).toMatchObject({ method: 'GET', path: `${companies}/hive_count`, status: 200 })
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'created', base: { label: 'Hive count' } })
})

test('rate limit: a non-daily 429 is waited out with a new read, then one successful write', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  const limited = fault.status(
    429,
    { status: 'error', policyName: 'TEN_SECONDLY_ROLLING', message: 'You have reached your ten secondly limit.' },
    { headers: { 'retry-after': '1' } },
  )
  sim.fault({ method: 'POST', path: companies, occurrence: 1, action: limited })
  const out = await onFakeTime(() => apply(dir, 'plan.json', '--yes', '--json'))
  expect(out.exitCode, out.stdout).toBe(0)
  const property = sim.log.filter(
    (r) => r.path === `${companies}/hive_count` || (r.method === 'POST' && r.path === companies),
  )
  expect(property.map((r) => `${r.method} ${r.status}`)).toEqual([
    'GET 404',
    'POST 429',
    'GET 404',
    'POST 201',
    'GET 200',
  ])
  expect(sim.object(portalId, 'companies').properties.get('hive_count')?.label).toBe('Hive count')
  // The write that went through after the wait is recorded as Kalup's own, so the next plan has nothing to do.
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({
    origin: 'created',
    id: 'hive_count',
    base: { label: 'Hive count' },
  })
  expect(stateOf(dir).lastApply?.outcome).toBe('done')
  expect(effects(await planOf(dir))).toEqual([])
})

test('rate limit: a daily 429 stops the run, and nothing is sent after it', async () => {
  const sim = portal()
  const dir = project({ groups: APIARY, properties: `${HIVE_COUNT}${HONEY_GRADE}` })
  await savePlan(dir)
  const daily = fault.status(429, {
    status: 'error',
    policyName: 'DAILY',
    message: 'You have reached your daily limit.',
  })
  sim.fault({ method: 'POST', path: companies, occurrence: 1, action: daily })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(5)
  expect(out.codes).toContain('E_DAILY_LIMIT')
  expect(out.data?.steps.map((s) => [s.address, s.outcome])).toEqual([
    [apiary, 'done'],
    [hiveCount, 'not-run'],
    [honeyGrade, 'not-run'],
  ])
  // The 429 is the last request of the run.
  expect(sim.log.at(-1)).toMatchObject({ method: 'POST', path: companies, status: 429 })
  expect(writesOf(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
  expect(stateOf(dir).lastApply?.outcome).toBe('partial')
})

test('scope failure: a 403 on a write is rejected naming the write scope, and a read checks the portal after it', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  sim.fault({ method: 'POST', path: groups, action: fault.status(403, missingScope) })
  const from = sim.log.length
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(1)
  expect(out.data?.steps.map((s) => [s.address, s.outcome])).toEqual([
    [apiary, 'rejected'],
    [hiveCount, 'not-run'],
  ])
  const issue = out.issues.find((i) => i.code === 'E_SCOPE')
  expect(issue?.message).toContain('crm.schemas.companies.write')
  expect(issue?.fix).toContain('add the scope crm.schemas.companies.write to the write key')
  // After the 403, a read of the groups settles that nothing was made, and nothing else is written.
  const after = lines(sim, from).slice(lines(sim, from).indexOf(`POST ${groups}`))
  expect(after).toEqual([`POST ${groups}`, `GET ${groups}`])
  expect(writesOf(sim)).toEqual([`POST ${groups}`])
})

// HubSpot's answer to a create of a name that exists, as observed on 2026-09-29.
const nameExists = {
  status: 'error',
  message: "A property named 'hive_count' already exists.",
  correlationId: '01a0ec0d-d0c0-7bea-aeb4-5c50650bdd05',
  category: 'OBJECT_ALREADY_EXISTS',
  subCategory: 'Properties.PROPERTY_WITH_NAME_EXISTS',
}

test('a create refused because the name exists: rejected naming the cause when no read finds it', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  sim.fault({ method: 'POST', path: companies, action: fault.status(409, nameExists) })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(5)
  expect(out.data?.steps.map((s) => [s.address, s.outcome])).toEqual([
    [apiary, 'done'],
    [hiveCount, 'rejected'],
  ])
  expect(out.issues.find((i) => i.code === 'E_HTTP')).toMatchObject({
    message: expect.stringContaining(
      'was refused (OBJECT_ALREADY_EXISTS): HubSpot refuses the create because a property named hive_count already exists',
    ),
    fix: 'run kalup plan --target sandbox: it reads the portal again',
  })
  expect(stateOf(dir).resources[hiveCount]).toBeUndefined()
})

test('a create refused because the name exists, which a read then finds: uncertain, naming the cause', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  sim.fault({ method: 'POST', path: companies, action: fault.status(409, nameExists, { apply: true }) })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(5)
  expect(out.data?.steps.map((s) => [s.address, s.outcome])).toEqual([
    [apiary, 'done'],
    [hiveCount, 'uncertain'],
  ])
  expect(out.issues.find((i) => i.code === 'E_UNCERTAIN_WRITE')?.message).toContain(
    'HubSpot answered 409 because a property of that name exists, and a read now finds it',
  )
  expect(stateOf(dir).resources[hiveCount]).toBeUndefined()
})

test("a refusal with a subCategory apply does not know keeps HubSpot's message", async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  // A 409, so the dependent create is not tried again as a 400 would be.
  const unknown = { ...nameExists, subCategory: 'Properties.SOMETHING_NEW', message: 'Something new' }
  sim.fault({ method: 'POST', path: companies, action: fault.status(409, unknown) })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.issues.find((i) => i.code === 'E_HTTP')).toMatchObject({
    message: expect.stringContaining(
      'was refused (OBJECT_ALREADY_EXISTS): HubSpot returned 409 for POST /crm/properties/2026-09/companies. HubSpot said: Something new',
    ),
    fix: 'run kalup plan --target sandbox and check the step',
  })
})

test('incomplete read: a 403 on a list blocks the plan there with scope, never a create or a delete', async () => {
  // The portal already holds what config names, but the key cannot list the properties.
  const sim = portal({
    objects: {
      companies: {
        groups: [{ name: 'apiary', label: 'Apiary' }],
        properties: [liveProperty({ name: 'hive_count', label: 'Hive count' })],
      },
    },
  })
  const dir = project()
  sim.fault({ method: 'GET', path: companies, action: fault.status(403, missingScope) })
  const out = await cli(dir, 'plan', '--json')
  const plan = parseEnvelope<{ steps: { action: string; address: string; blocked?: { reason: string } }[] }>(out.stdout)
  expect(plan.data?.steps.map((s) => [s.address, s.action, s.blocked?.reason])).toEqual([
    [apiary, 'unknown', 'scope'],
    [hiveCount, 'unknown', 'scope'],
  ])
  expect(plan.issues.map((i) => i.code)).toEqual(['E_SCOPE', 'W_INCOMPLETE'])
  // Blocked steps have no effect: apply has nothing to do and sends nothing but reads.
  const direct = await apply(dir, '--yes', '--json')
  expect(direct.data?.outcome).toBe('nothing')
  expect(notRead(sim.log)).toEqual([])
})

test('incomplete read: a 403 on a list at apply time is E_INCOMPLETE before any write', async () => {
  const sim = portal()
  const dir = project()
  await applyNow(dir)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  await savePlan(dir)
  const bytes = stateBytes(dir)
  sim.log.length = 0
  sim.fault({ method: 'GET', path: companies, action: fault.status(403, missingScope) })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(1)
  expect(out.codes).toEqual(['E_INCOMPLETE'])
  expect(out.issues[0]?.fix).toContain('add the scope crm.schemas.companies.read to the write key')
  expect(notRead(sim.log)).toEqual([])
  expect(sim.log.at(-1)).toMatchObject({ method: 'GET', path: companies, status: 403 })
  expect(stateBytes(dir)).toBe(bytes)
  // The plan made now blocks the step rather than treating the property as gone.
  const plan = await planOf(dir)
  expect(plan.steps.find((s) => s.address === hiveCount)).toMatchObject({
    action: 'unknown',
    blocked: { reason: 'scope' },
  })
  expect(plan.missing).toEqual([])
})
