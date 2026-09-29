// Scenario: a stale plan, a changed destination, a changed policy and a changed lineage. Each saved plan is refused
// before any write request: the log after the refusal's start holds only the portal guard and reads, and the state
// file keeps its bytes.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cli } from '../../src/commands/testing.js'
import type { PortalSim } from '../support/portal-sim.js'
import {
  apply,
  applyNow,
  configFile,
  edit,
  environment,
  guardPath,
  hiveCount,
  live,
  notRead,
  objectsFile,
  portal,
  portalId,
  project,
  savePlan,
  stateBytes,
  stateOf,
  type TargetSpec,
  terminal,
  writeConfig,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The project applied, then a label change planned and saved: a plan whose one step writes hive_count's label. */
async function planned(sim: PortalSim): Promise<string> {
  const dir = project()
  await applyNow(dir)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  await savePlan(dir)
  sim.log.length = 0
  return dir
}

/** Applies plan.json with --yes and reports what the refusal left: the requests it sent, and whether it wrote. */
async function attempt(sim: PortalSim, dir: string) {
  const bytes = stateBytes(dir)
  const from = sim.log.length
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  const requests = sim.log.slice(from)
  return {
    exitCode: out.exitCode,
    code: out.codes[0],
    message: out.issues[0]?.message ?? '',
    requests: requests.map((r) => `${r.method} ${r.path}`),
    notRead: notRead(requests),
    writes: sim.writes(),
    stateKept: stateBytes(dir) === bytes,
  }
}

/** What every refusal here leaves: exit 1, no request but the guard and reads, no write, the state bytes kept. */
const refused = { exitCode: 1, notRead: [], writes: [], stateKept: true }

test('stale plan: the portal edited after the plan is E_PLAN_STALE before any write', async () => {
  const sim = portal()
  const dir = await planned(sim)
  live(sim, 'hive_count').label = 'Hives kept'
  const out = await attempt(sim, dir)
  expect(out).toMatchObject({ ...refused, code: 'E_PLAN_STALE' })
  expect(out.message).toContain(`${hiveCount} label`)
  expect(out.requests[0]).toBe(`GET ${guardPath}`)
  expect(out.requests.length).toBeGreaterThan(1)
  expect(live(sim, 'hive_count').label).toBe('Hives kept')

  // A create whose name appeared in HubSpot since the plan, on a portal of its own, is stale too.
  const empty = portal()
  const fresh = project()
  const creates = await savePlan(fresh)
  expect(creates.steps.map((s) => s.action)).toEqual(['create', 'create'])
  empty.object(portalId, 'companies').groups.set('apiary', {
    name: 'apiary',
    label: 'Apiary',
    displayOrder: -1,
    archived: false,
  })
  const appeared = await attempt(empty, fresh)
  expect(appeared).toMatchObject({ ...refused, code: 'E_PLAN_STALE' })
  expect(appeared.message).toContain('group:companies/apiary exists')
  expect(appeared.requests[0]).toBe(`GET ${guardPath}`)
  expect(stateBytes(fresh)).toBeNull()
})

test('changed destination: a re-pinned or renamed target is E_PLAN_DESTINATION before any request', async () => {
  const sim = portal()
  const dir = await planned(sim)
  edit(dir, configFile, `portalId: ${portalId},`, 'portalId: 7700009,')
  const repinned = await attempt(sim, dir)
  expect(repinned).toMatchObject({ ...refused, code: 'E_PLAN_DESTINATION', requests: [] })
  expect(repinned.message).toContain('pins that target to portal 7700009')

  edit(dir, configFile, 'portalId: 7700009,', `portalId: ${portalId},`)
  edit(dir, configFile, 'sandbox: {', 'hive_lab: {')
  const renamed = await attempt(sim, dir)
  expect(renamed).toMatchObject({ ...refused, code: 'E_PLAN_DESTINATION', requests: [] })
  expect(renamed.message).toContain('which kalup.config.ts does not declare')
})

test('changed policy: protected, drift or allowDestroy changed since the plan is E_POLICY_CHANGED before any write', async () => {
  const sim = portal()
  const dir = await planned(sim)
  const changes: [TargetSpec, string][] = [
    [{ protected: true }, 'protected was false, now true'],
    [{ drift: 'overwrite' }, 'drift was hold, now overwrite'],
    [{ allowDestroy: true }, 'allowDestroy was false, now true'],
  ]
  for (const [policy, message] of changes) {
    writeConfig(dir, policy)
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one policy change at a time
    const out = await attempt(sim, dir)
    expect(out).toMatchObject({ ...refused, code: 'E_POLICY_CHANGED', requests: [`GET ${guardPath}`] })
    expect(out.message).toContain(message)
  }
  // The policy the plan was made under applies it.
  writeConfig(dir, {})
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
})

test('changed lineage: another apply in between is E_STATE_CHANGED before any write', async () => {
  const sim = portal()
  const dir = await planned(sim)
  const first = readFileSync(join(dir, 'plan.json'), 'utf8')
  edit(dir, objectsFile, "label: 'Hives on site'", "label: 'Hives in the yard'")
  await savePlan(dir)
  expect((await apply(dir, 'plan.json', '--yes')).exitCode).toBe(0)
  const { serial } = stateOf(dir)
  sim.log.length = 0
  writeFileSync(join(dir, 'plan.json'), first)
  const out = await attempt(sim, dir)
  expect(out).toMatchObject({ ...refused, code: 'E_STATE_CHANGED', requests: [`GET ${guardPath}`] })
  expect(out.message).toContain(`serial ${serial}`)
  expect(live(sim, 'hive_count').label).toBe('Hives in the yard')
})

test('changed lineage: a state rebuild in between is E_STATE_CHANGED before any write', async () => {
  const sim = portal()
  const dir = await planned(sim)
  const before = stateOf(dir).lineage
  const rebuilt = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write')
  expect(rebuilt.exitCode, rebuilt.stderr).toBe(0)
  expect(stateOf(dir).lineage).not.toBe(before)
  expect(sim.writes()).toEqual([])
  sim.log.length = 0
  const out = await attempt(sim, dir)
  expect(out).toMatchObject({ ...refused, code: 'E_STATE_CHANGED', requests: [`GET ${guardPath}`] })
  expect(out.message).toContain(`lineage ${before}`)
  expect(live(sim, 'hive_count').label).toBe('Hive count')
})
