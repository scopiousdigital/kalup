// Scenario: a crash after the portal accepted a create and before state recorded it. The apply runs as a process of
// its own and is killed with SIGKILL the moment the simulator has accepted the property's POST, before the answer
// reaches it. Its lock stays until a person deletes it. The next plan adopts the property it made (origin adopted, never created), applying that sends no
// POST, and the log holds exactly one POST for that name.
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import type { PortalSim } from '../../../engine/test/support/portal-sim.js'
import { cli } from '../../src/commands/testing.js'
import {
  apiary,
  apply,
  companies,
  type Exited,
  effects,
  environment,
  hiveCount,
  live,
  portal,
  project,
  savePlan,
  spawnKalup,
  stateOf,
} from './harness.js'

let locks = ''

beforeEach(() => {
  ;({ locks } = environment())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The project planned, and its apply killed the moment the simulator accepted hive_count's POST. */
async function crash(): Promise<{ dir: string; killed: Exited; plan: Plan; sim: PortalSim }> {
  const sim = portal()
  const dir = project()
  const plan = await savePlan(dir)
  const killed = await spawnKalup(sim, dir, ['apply', 'plan.json', '--yes', '--json'], {
    after: (asked, answered) =>
      asked.method === 'POST' && asked.path === companies && answered === 201 ? 'kill' : undefined,
  })
  return { dir, killed, plan, sim }
}

test('crash after portal acceptance but before state persistence: the next plan adopts, and no second POST is sent', async () => {
  const { dir, killed, plan, sim } = await crash()
  expect(plan.steps.map((s) => [s.address, s.action])).toEqual([
    [apiary, 'create'],
    [hiveCount, 'create'],
  ])
  expect(killed.signal).toBe('SIGKILL')
  expect(killed.stdout).toBe('')
  // HubSpot holds the property; state never heard of it and still says the run is going.
  expect(live(sim, 'hive_count').label).toBe('Hive count')
  const crashed = stateOf(dir)
  expect(crashed.lastApply).toMatchObject({ planId: plan.planId, outcome: 'running' })
  expect(crashed.resources[apiary]).toMatchObject({ origin: 'created' })
  expect(crashed.resources[hiveCount]).toBeUndefined()
  // The dead process left its lock behind.
  expect(readdirSync(locks)).toEqual(['portal-7700001.lock'])
  const status = await cli(dir, 'status')
  expect(status.stdout).toContain(plan.planId)
  expect(normalise(status.stdout)).toMatchInlineSnapshot(`
    "kalup <version>
    Config: valid (1 objects, 1 properties, 1 groups)
    Target sandbox: portal 7700001 matches, SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana, protected: no (SANDBOX account, default)
      Scopes: crm.schemas.companies.read ok
      Also recommended: crm.objects.companies.read, not checked (the property limit check in plan)
      Write: apply uses KESTREL_READ_KEY, which also needs crm.schemas.companies.write, not checked
      State: .kalup/state/portal-7700001.json, lineage <lineage>, serial 2. Last apply: plan pl_<id> at <time>: an apply did not finish; run kalup plan
    "
  `)

  // The next plan compares the portal with the state that was kept: the property is adopted, nothing is created.
  const next = await savePlan(dir)
  expect(next.steps.filter((s) => s.action === 'create')).toEqual([])
  expect(effects(next).map((s) => [s.address, s.action])).toEqual([[hiveCount, 'adopt']])
  expect(next.steps[0]?.labels ?? []).not.toContain('reverts-ui-edit')

  // The dead process's lock is never taken over: the person deletes it once no kalup command is running.
  const refused = await apply(dir, 'plan.json', '--yes', '--json')
  expect(refused.exitCode).toBe(1)
  expect(refused.env?.issues[0]?.code).toBe('E_LOCKED')
  expect(refused.env?.issues[0]?.fix).toContain(`delete ${join(locks, 'portal-7700001.lock')} only when`)
  rmSync(join(locks, 'portal-7700001.lock'))
  const recovered = await apply(dir, 'plan.json', '--yes', '--json')
  expect(recovered.exitCode, recovered.stdout).toBe(0)
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({
    origin: 'adopted',
    id: 'hive_count',
    base: { label: 'Hive count' },
  })
  expect(stateOf(dir).lastApply).toMatchObject({ planId: next.planId, outcome: 'done' })
  // The recovering apply took the lock and released it.
  expect(readdirSync(locks)).toEqual([])

  // Exactly one POST ever named hive_count: the one the crashed run sent.
  const creates = sim.log.filter((r) => r.method === 'POST' && (r.body as { name?: string }).name === 'hive_count')
  expect(creates).toHaveLength(1)
  expect(creates[0]?.status).toBe(201)
  expect(sim.writes().map((w) => `${w.method} ${w.path}`)).toEqual([`POST ${companies}/groups`, `POST ${companies}`])
})

// A crash leaves lastApply.outcome running, which the next plan names in its text and in its --json envelope, as kalup
// status does (the test above).
test('crash after portal acceptance: the next plan reports the unfinished apply', async () => {
  const { dir, killed, plan } = await crash()
  expect(killed.signal).toBe('SIGKILL')
  expect(stateOf(dir).lastApply).toMatchObject({ planId: plan.planId, outcome: 'running' })
  const text = await cli(dir, 'plan')
  expect(text.exitCode, text.stderr).toBe(0)
  expect(`${text.stdout}${text.stderr}`).toContain(plan.planId)
  const json = await cli(dir, 'plan', '--json')
  expect(json.exitCode, json.stdout).toBe(0)
  expect(json.stdout).toContain(plan.planId)
})
