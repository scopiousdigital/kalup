// Scenario: a crash after the portal accepted a create and before state recorded it. The apply runs as a process of
// its own and is killed with SIGKILL the moment the simulator has accepted the property's POST, before the answer
// reaches it. The next plan adopts the property it made (origin adopted, never created), applying that sends no
// POST, and the log holds exactly one POST for that name.
import { readdirSync } from 'node:fs'
import type { Plan } from '@kalup/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cli } from '../../src/commands/testing.js'
import type { PortalSim } from '../support/portal-sim.js'
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
  expect(status.stdout).toContain(`Last apply: plan ${plan.planId}`)
  expect(status.stdout).toContain('an apply did not finish; run kalup plan')

  // The next plan compares the portal with the state that was kept: the property is adopted, nothing is created.
  const next = await savePlan(dir)
  expect(next.steps.filter((s) => s.action === 'create')).toEqual([])
  expect(effects(next).map((s) => [s.address, s.action])).toEqual([[hiveCount, 'adopt']])
  expect(next.steps[0]?.labels ?? []).not.toContain('reverts-ui-edit')

  const recovered = await apply(dir, 'plan.json', '--yes', '--json')
  expect(recovered.exitCode, recovered.stdout).toBe(0)
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({
    origin: 'adopted',
    id: 'hive_count',
    base: { label: 'Hive count' },
  })
  expect(stateOf(dir).lastApply).toMatchObject({ planId: next.planId, outcome: 'done' })
  // The stale lock of the dead process was taken over and released.
  expect(readdirSync(locks)).toEqual([])

  // Exactly one POST ever named hive_count: the one the crashed run sent.
  const creates = sim.log.filter((r) => r.method === 'POST' && (r.body as { name?: string }).name === 'hive_count')
  expect(creates).toHaveLength(1)
  expect(creates[0]?.status).toBe(201)
  expect(sim.writes().map((w) => `${w.method} ${w.path}`)).toEqual([`POST ${companies}/groups`, `POST ${companies}`])
})

// Defect: kalup plan does not report an unfinished apply. ADR 0021, Recovery: "A crash leaves lastApply.outcome:
// running, which the next plan reports." Only kalup status reports it (the test above). Remove .fails once the plan
// names the unfinished apply in its text and in its --json envelope.
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
