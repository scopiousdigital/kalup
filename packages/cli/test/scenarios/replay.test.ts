// Scenario: repeated successful execution, or a run with nothing to do. An applied plan file applied again is
// "already applied": nothing after the guard is sent and the state file keeps its bytes. A plan with no effect exits
// 0 without a single request. A plan made after a successful apply has no effect step.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../support/normalise.js'
import {
  APIARY,
  apply,
  applyNow,
  edit,
  effects,
  environment,
  guardPath,
  HIVE_COUNT,
  HONEY_GRADE,
  hiveCount,
  lines,
  live,
  objectsFile,
  planOf,
  portal,
  project,
  savePlan,
  stateBytes,
  stateOf,
  terminal,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('repeated execution: a replayed applied plan is already applied, with no request after the guard and the same state bytes', async () => {
  const sim = portal()
  const dir = project()
  const plan = await savePlan(dir)
  const file = readFileSync(join(dir, 'plan.json'), 'utf8')
  const first = await apply(dir, 'plan.json', '--yes', '--json')
  expect(first.exitCode, first.stdout).toBe(0)
  const bytes = stateBytes(dir)
  const writes = sim.writes().length

  writeFileSync(join(dir, 'plan.json'), file)
  const from = sim.log.length
  const replay = await apply(dir, 'plan.json', '--yes', '--json')
  expect(replay.exitCode, replay.stdout).toBe(0)
  expect(replay.data).toMatchObject({ planId: plan.planId, outcome: 'already-applied', steps: [], journal: null })
  expect(lines(sim, from)).toEqual([`GET ${guardPath}`])

  // In words, and at a terminal, the same: the person confirms, and nothing is sent after the guard.
  const human = await apply(dir, 'plan.json', '--yes')
  expect(human.exitCode).toBe(0)
  expect(human.stdout).toContain(plan.planId)
  expect(normalise(human.stdout)).toMatchInlineSnapshot(`
    "Already applied at <time>: plan pl_<id> on target sandbox, portal 7700001. Nothing was written.
    "
  `)
  const confirmed = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(confirmed.exitCode, confirmed.stderr).toBe(0)
  expect(confirmed.stdout).toContain('Already applied')

  expect(sim.writes()).toHaveLength(writes)
  expect(lines(sim, from).filter((line) => line !== `GET ${guardPath}`)).toEqual([])
  expect(stateBytes(dir)).toBe(bytes)
})

test('a no-op: a plan with no effect exits 0 with zero requests, approval or not', async () => {
  const sim = portal()
  const dir = project()
  await applyNow(dir)
  const bytes = stateBytes(dir)

  const empty = await savePlan(dir)
  expect(empty.steps).toEqual([])
  sim.log.length = 0
  const out = await apply(dir, 'plan.json', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.data).toMatchObject({ outcome: 'nothing', approval: null, steps: [], state: null, journal: null })
  expect(sim.log).toEqual([])

  // A plan whose only step holds a UI edit has no effect either.
  live(sim, 'hive_count').label = 'Hives kept'
  const held = await savePlan(dir)
  expect(held.steps.map((s) => [s.address, s.action, (s.held ?? []).length])).toEqual([[hiveCount, 'update', 1]])
  expect(effects(held)).toEqual([])
  sim.log.length = 0
  const heldOut = await apply(dir, 'plan.json')
  expect(heldOut.exitCode, heldOut.stderr).toBe(0)
  expect(heldOut.stdout).toContain('Nothing to apply')
  expect(sim.log).toEqual([])
  expect(stateBytes(dir)).toBe(bytes)
})

test('a fresh plan after a successful apply has no effect step', async () => {
  const sim = portal()
  const dir = project({ groups: APIARY, properties: HIVE_COUNT })
  await applyNow(dir)
  // A second round with a create, an update and an option added, applied in one run.
  const relabelled = HIVE_COUNT.replace("'Hive count'", "'Hives on site'")
  edit(dir, objectsFile, HIVE_COUNT, `${relabelled}${HONEY_GRADE}`)
  const second = await applyNow(dir)
  expect(effects(second).map((s) => s.action)).toEqual(['update', 'create'])
  edit(
    dir,
    objectsFile,
    "        { value: 'amber', label: 'Amber' },\n",
    "        { value: 'amber', label: 'Amber' },\n        { value: 'dark', label: 'Dark' },\n",
  )
  const third = await applyNow(dir)
  expect(effects(third).map((s) => s.changes?.map((c) => c.unit))).toEqual([['options[dark]']])

  const fresh = await planOf(dir)
  expect(effects(fresh)).toEqual([])
  expect(fresh.steps).toEqual([])
  expect(stateOf(dir).lastApply).toMatchObject({ planId: third.planId, outcome: 'done' })
  expect(sim.writes().map((w) => w.method)).toEqual(['POST', 'POST', 'PATCH', 'POST', 'PATCH'])
})
