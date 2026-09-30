// Scenario: a new group and property, followed by a second run. The group is created before the property that names
// it, state owns both with a base, and a second run finds nothing to do: no write request and the same state bytes.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  apiary,
  apply,
  companies,
  effects,
  environment,
  groups,
  hiveCount,
  planIsEmpty,
  planOf,
  portal,
  project,
  savePlan,
  stateBytes,
  stateOf,
  writePlan,
  writesOf,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('new group and property, followed by a second run: group first, both owned with a base, then nothing to write', async () => {
  const sim = portal()
  const dir = project()
  const plan = await savePlan(dir)
  expect(plan.steps.map((s) => [s.address, s.action, s.risk])).toEqual([
    [apiary, 'create', 'safe'],
    [hiveCount, 'create', 'safe'],
  ])
  expect(plan.stateLineage).toBeNull()
  expect(stateBytes(dir)).toBeNull()

  const first = await apply(dir, 'plan.json', '--yes', '--json')
  expect(first.exitCode, first.stdout).toBe(0)
  expect(first.data?.outcome).toBe('done')
  // The group's POST precedes the property's, and the property's body names the group.
  expect(writesOf(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
  const [groupPost, propertyPost] = sim.writes()
  expect(groupPost?.body).toMatchObject({ name: 'apiary', label: 'Apiary' })
  expect(propertyPost?.body).toMatchObject({ name: 'hive_count', groupName: 'apiary', type: 'number' })
  expect(sim.log.indexOf(groupPost as never)).toBeLessThan(sim.log.indexOf(propertyPost as never))
  expect(sim.writes().map((w) => w.status)).toEqual([201, 201])

  const state = stateOf(dir)
  expect(state.resources).toEqual({
    [apiary]: { origin: 'created', id: 'apiary', normVersion: 1, base: { label: 'Apiary' } },
    [hiveCount]: {
      origin: 'created',
      id: 'hive_count',
      normVersion: 1,
      base: {
        description: '',
        formField: false,
        hasUniqueValue: false,
        label: 'Hive count',
        group: { $ref: apiary },
        type: 'number',
        fieldType: 'number',
      },
    },
  })
  expect(state.lastApply).toMatchObject({ planId: plan.planId, writesHash: plan.writesHash, outcome: 'done' })

  // A fresh plan has no effect step.
  const fresh = await planOf(dir)
  expect(effects(fresh)).toEqual([])
  expect(fresh.steps).toEqual([])
  expect(fresh.stateSerial).toBe(state.serial)

  // A second run, saved and direct: zero write requests, and the state file keeps every byte.
  const bytes = stateBytes(dir)
  const count = sim.log.length
  await savePlan(dir)
  const saved = await apply(dir, 'plan.json', '--yes', '--json')
  expect(saved.exitCode, saved.stdout).toBe(0)
  expect(saved.data?.outcome).toBe('nothing')
  const direct = await apply(dir, '--yes', '--json')
  expect(direct.exitCode, direct.stdout).toBe(0)
  expect(direct.data?.outcome).toBe('nothing')
  expect(writesOf(sim, count)).toEqual([])
  expect(stateBytes(dir)).toBe(bytes)
})

test('new group and property from a plan file that lists the property first: the group is still posted first', async () => {
  const sim = portal()
  const dir = project()
  const plan = await savePlan(dir)
  const [group, property] = plan.steps
  if (!(group && property)) {
    throw new Error('the plan has no group and property step')
  }
  // Reordered and renumbered, with a digest recomputed as a forger would: the file now creates the property first.
  writePlan(
    dir,
    {
      ...plan,
      steps: [
        { ...property, id: 's1' },
        { ...group, id: 's2' },
      ],
    },
    true,
  )
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(writesOf(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
  expect(Object.keys(stateOf(dir).resources).sort()).toEqual([apiary, hiveCount])
  await planIsEmpty(dir)
})
