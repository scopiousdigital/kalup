// Scenario: a config change, a change made in the HubSpot UI, and both at once. A config change is written; a UI edit
// is drift, held through any number of applies; a conflict is held. Each resolves only by an explicit choice: pull
// takes the portal side into config, after which apply records the base without a write, or plan --take config
// writes config over the UI edit, labelled reverts-ui-edit at risk risky.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '@kalup/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cli } from '../../src/commands/testing.js'
import { normalise } from '../support/normalise.js'
import type { PortalSim } from '../support/portal-sim.js'
import {
  APIARY,
  apply,
  applyNow,
  companies,
  edit,
  effects,
  environment,
  hiveCount,
  live,
  objectsFile,
  planIsEmpty,
  planOf,
  portal,
  project,
  savePlan,
  stateBytes,
  stateOf,
  terminal,
  writesOf,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const HIVE_COUNT = `    hiveCount: p.number('hive_count', {
      label: 'Hive count',
      description: 'Colonies on site',
      group: 'apiary',
      fieldType: 'number',
    }),
`

/** The project applied: state owns the group and hive_count, whose base holds every unit config sets. */
async function applied(sim: PortalSim): Promise<string> {
  const dir = project({ groups: APIARY, properties: HIVE_COUNT })
  await applyNow(dir)
  const base = stateOf(dir).resources[hiveCount]?.base
  if (base?.label !== 'Hive count' || base.description !== 'Colonies on site') {
    throw new Error(`the first apply left another base: ${JSON.stringify(base)}`)
  }
  sim.log.length = 0
  return dir
}

function stepOf(plan: Plan) {
  return plan.steps.find((s) => s.address === hiveCount)
}

const LABEL = /hiveCount: p\.number\('hive_count', \{\n {6}label: '([^']*)'/

// The label config gives hive_count.
function configLabel(dir: string): string | undefined {
  return LABEL.exec(readFileSync(join(dir, objectsFile), 'utf8'))?.[1]
}

/** Runs a command a plan printed, `kalup ...`, splitting on spaces and keeping a single-quoted word whole. */
function printed(dir: string, command: string | undefined) {
  const words = (command?.match(/'[^']*'|\S+/g) ?? []).map((w) => (w.startsWith("'") ? w.slice(1, -1) : w))
  const [bin, ...args] = words
  if (bin !== 'kalup') {
    throw new Error(`not a kalup command: ${command}`)
  }
  return cli(dir, ...args)
}

test('config change: a label edited in config is a safe set, and apply writes it', async () => {
  const sim = portal()
  const dir = await applied(sim)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  const plan = await savePlan(dir)
  expect(effects(plan)).toHaveLength(1)
  expect(stepOf(plan)).toMatchObject({
    action: 'update',
    risk: 'safe',
    changes: [{ unit: 'label', class: 'config-change', op: 'set', before: 'Hive count', after: 'Hives on site' }],
  })
  expect(stepOf(plan)?.labels).toBeUndefined()
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(writesOf(sim)).toEqual([`PATCH ${companies}/hive_count`])
  expect(sim.writes()[0]?.body).toEqual({ label: 'Hives on site', type: 'number', fieldType: 'number' })
  expect(live(sim, 'hive_count').label).toBe('Hives on site')
  expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hives on site' })
  await planIsEmpty(dir)
})

test('UI change: a label edited in HubSpot is held as drift and survives three consecutive applies unchanged', async () => {
  const sim = portal()
  const dir = await applied(sim)
  live(sim, 'hive_count').label = 'Hives kept'
  let description = 'Colonies on site'
  for (const round of [1, 2, 3]) {
    // Each round config changes the description of the same property, so every apply writes to it.
    const next = `Colonies on site, round ${round}`
    edit(dir, objectsFile, `description: '${description}'`, `description: '${next}'`)
    description = next
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, each apply on the state the one before left
    const plan = await savePlan(dir)
    const step = stepOf(plan)
    expect(step?.changes?.map((c) => [c.unit, c.class])).toEqual([['description', 'config-change']])
    expect(step?.held).toMatchObject([{ unit: 'label', class: 'drift', config: 'Hive count', live: 'Hives kept' }])
    const from = sim.log.length
    const out = await apply(dir, 'plan.json', '--yes', '--json')
    expect(out.exitCode, out.stdout).toBe(0)
    const patches = sim.log.slice(from).filter((r) => r.method !== 'GET')
    expect(patches.map((r) => `${r.method} ${r.path}`)).toEqual([`PATCH ${companies}/hive_count`])
    expect(patches[0]?.body).toEqual({ description: next, type: 'number', fieldType: 'number' })
    // The portal keeps the UI edit and the base keeps the value config and portal last agreed on.
    expect(live(sim, 'hive_count').label).toBe('Hives kept')
    expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hive count', description: next })
  }
  expect(sim.log.some((r) => (r.body as { label?: unknown } | undefined)?.label !== undefined)).toBe(false)
  expect(stepOf(await planOf(dir))?.held).toMatchObject([{ unit: 'label', class: 'drift' }])
})

test('conflict: config and HubSpot both moved the label apart, so it is held and nothing is written', async () => {
  const sim = portal()
  const dir = await applied(sim)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  live(sim, 'hive_count').label = 'Hives kept'
  const plan = await savePlan(dir)
  expect(stepOf(plan)?.changes ?? []).toEqual([])
  expect(stepOf(plan)?.held).toMatchObject([
    {
      unit: 'label',
      class: 'conflict',
      config: 'Hives on site',
      live: 'Hives kept',
      resolve: { portal: `kalup pull --target sandbox --accept '${hiveCount}#label'` },
    },
  ])
  expect(effects(plan)).toEqual([])
  const bytes = stateBytes(dir)
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.data?.outcome).toBe('nothing')
  const direct = await apply(dir, '--yes', '--json')
  expect(direct.data?.outcome).toBe('nothing')
  expect(sim.writes()).toEqual([])
  expect(live(sim, 'hive_count').label).toBe('Hives kept')
  expect(stateBytes(dir)).toBe(bytes)
})

test('drift resolved with pull --only: config takes the portal label, and the next apply records the base without a write', async () => {
  const sim = portal()
  const dir = await applied(sim)
  live(sim, 'hive_count').label = 'Hives kept'
  const held = stepOf(await planOf(dir))?.held?.[0]
  expect(held?.resolve?.portal).toBe(`kalup pull --target sandbox --only ${hiveCount}`)
  const pulled = await printed(dir, held?.resolve?.portal)
  expect(pulled.exitCode, pulled.stderr).toBe(0)
  expect(configLabel(dir)).toBe('Hives kept')

  const plan = await savePlan(dir)
  expect(effects(plan)).toHaveLength(1)
  expect(stepOf(plan)).toMatchObject({ action: 'update', baseUnits: ['label'] })
  expect(stepOf(plan)?.changes ?? []).toEqual([])
  expect(stepOf(plan)?.held).toBeUndefined()
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(sim.writes()).toEqual([])
  expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hives kept' })
  await planIsEmpty(dir)
})

test('conflict resolved with pull --accept: config takes the portal label, and the next apply records the base without a write', async () => {
  const sim = portal()
  const dir = await applied(sim)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  live(sim, 'hive_count').label = 'Hives kept'
  const held = stepOf(await planOf(dir))?.held?.[0]
  expect(held?.class).toBe('conflict')
  const pulled = await printed(dir, held?.resolve?.portal)
  expect(pulled.exitCode, pulled.stderr).toBe(0)
  expect(configLabel(dir)).toBe('Hives kept')

  const plan = await savePlan(dir)
  expect(stepOf(plan)).toMatchObject({ action: 'update', baseUnits: ['label'] })
  expect(stepOf(plan)?.changes ?? []).toEqual([])
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(sim.writes()).toEqual([])
  expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hives kept' })
  await planIsEmpty(dir)
})

test('plan --take config writes config over drift and over a conflict, labelled reverts-ui-edit at risk risky', async () => {
  const sim = portal()
  const dir = await applied(sim)
  const take = ['--take', 'config', `${hiveCount}#label`]

  // Drift: the UI edit is reverted to config's value.
  live(sim, 'hive_count').label = 'Hives kept'
  const drift = await savePlan(dir, ...take)
  expect(stepOf(drift)).toMatchObject({
    action: 'update',
    risk: 'risky',
    labels: ['reverts-ui-edit'],
    changes: [{ unit: 'label', class: 'drift', op: 'set', before: 'Hives kept', after: 'Hive count' }],
  })
  const yes = await apply(dir, 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(sim.writes()).toEqual([])
  const reverted = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(reverted.exitCode, reverted.stderr).toBe(0)
  expect(normalise(reverted.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 risky [reverts-ui-edit] Update property "Hive count" (hive_count) on companies, set label
    1 writes, 0 adoptions, 0 releases, 0 base records, 0 destructive
    Type the target name to apply: "
  `)
  expect(writesOf(sim)).toEqual([`PATCH ${companies}/hive_count`])
  expect(sim.writes()[0]?.body).toMatchObject({ label: 'Hive count' })
  expect(live(sim, 'hive_count').label).toBe('Hive count')
  expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hive count' })

  // A conflict: config's new value goes over the UI's.
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  live(sim, 'hive_count').label = 'Hives kept'
  const conflict = await savePlan(dir, ...take)
  expect(stepOf(conflict)).toMatchObject({
    risk: 'risky',
    labels: ['reverts-ui-edit'],
    changes: [{ unit: 'label', class: 'conflict', op: 'set', before: 'Hives kept', after: 'Hives on site' }],
  })
  const out = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(live(sim, 'hive_count').label).toBe('Hives on site')
  expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hives on site' })
  await planIsEmpty(dir)
})
