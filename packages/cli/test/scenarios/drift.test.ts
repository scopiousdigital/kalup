// Scenario: a config change, a change made in the HubSpot UI, and both at once. A config change is written; a UI edit
// is drift, held through any number of applies; a conflict is held. Each resolves only by an explicit choice: pull
// takes the portal side into config, after which apply records the base without a write, or plan --take config
// writes config over the UI edit, labelled reverts-ui-edit at risk risky.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Plan, SETTLE_MS, stableStringify } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import type { PortalSim } from '../../../engine/test/support/portal-sim.js'
import { cli, parseEnvelope } from '../../src/commands/testing.js'
import {
  APIARY,
  afterSettling,
  apply,
  applyNow,
  companies,
  edit,
  effects,
  environment,
  hiveCount,
  intercept,
  live,
  objectsFile,
  planIsEmpty,
  planOf,
  portal,
  portalId,
  project,
  savePlan,
  stateBytes,
  stateOf,
  statePath,
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

/**
 * The project applied a while ago: state owns the group and hive_count, whose base holds every unit config sets, and
 * the minutes in which HubSpot may still serve an older copy have passed.
 */
async function applied(sim: PortalSim): Promise<string> {
  const dir = project({ groups: APIARY, properties: HIVE_COUNT })
  await applyNow(dir)
  afterSettling(dir)
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

test('right after an apply, a read serving the copy from before it is settling: plan waits, pull keeps the file', async () => {
  const sim = portal()
  const dir = project({ groups: APIARY, properties: HIVE_COUNT })
  await applyNow(dir)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  await applyNow(dir)
  // HubSpot serves the copy from before the relabel for a while (observed on custom object schemas, 2026-10-05).
  live(sim, 'hive_count').label = 'Hive count'
  const bytes = stateBytes(dir)
  const plan = await planOf(dir)
  expect(plan.steps).toMatchObject([{ address: hiveCount, action: 'unknown', blocked: { reason: 'settling' } }])
  expect(plan.steps.flatMap((s) => s.held ?? [])).toEqual([])
  const pulled = await cli(dir, 'pull', '--json')
  expect(pulled.exitCode, pulled.stdout).toBe(0)
  expect(parseEnvelope(pulled.stdout).issues.map((i) => i.code)).toContain('W_SETTLING')
  expect(readFileSync(join(dir, objectsFile), 'utf8')).toContain("label: 'Hives on site'")
  expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hives on site' })
  expect(stateBytes(dir)).toBe(bytes)
  // Minutes later the same read is believed: drift, held, with the pull that takes it.
  afterSettling(dir)
  expect((await planOf(dir)).steps).toMatchObject([
    { address: hiveCount, action: 'update', held: [{ unit: 'label', class: 'drift', live: 'Hive count' }] },
  ])
})

test('pull --check --exit-code on a read that is settling counts it as pending: exit 2, never a clean 0', async () => {
  const sim = portal()
  const dir = project({ groups: APIARY, properties: HIVE_COUNT })
  await applyNow(dir)
  // A pull once the create settled writes the file as pull writes it, so a later check differs only where HubSpot does.
  afterSettling(dir)
  expect((await cli(dir, 'pull')).exitCode).toBe(0)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  await applyNow(dir)
  live(sim, 'hive_count').label = 'Hive count'
  const checked = await cli(dir, 'pull', '--check', '--exit-code', '--json')
  expect(checked.exitCode, checked.stdout).toBe(2)
  expect(parseEnvelope(checked.stdout).issues.map((i) => i.code)).toContain('W_SETTLING')
  // Once HubSpot serves what apply wrote, nothing differs.
  live(sim, 'hive_count').label = 'Hives on site'
  expect((await cli(dir, 'pull', '--check', '--exit-code', '--json')).exitCode).toBe(0)
})

test('pull judges the window by when its read began, as plan does: a read that outlasts the window is still settling', async () => {
  const sim = portal()
  const dir = project({ groups: APIARY, properties: HIVE_COUNT })
  await applyNow(dir)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  await applyNow(dir)
  live(sim, 'hive_count').label = 'Hive count'
  // The window after the relabel ends a moment after this pull starts, and its read of the properties takes longer.
  const state = stateOf(dir)
  const entry = state.resources[hiveCount]
  const ends = new Date(Date.now() - SETTLE_MS + 2000).toISOString()
  writeFileSync(
    statePath(dir),
    `${stableStringify({ ...state, resources: { ...state.resources, [hiveCount]: { ...entry, written: { label: ends }, writtenAt: ends } } })}\n`,
  )
  intercept(sim, async (method, path) => {
    if (method === 'GET' && path === companies) {
      await new Promise((done) => setTimeout(done, 3000))
    }
  })
  const pulled = await cli(dir, 'pull', '--json')
  expect(parseEnvelope(pulled.stdout).issues.map((i) => i.code)).toContain('W_SETTLING')
  expect(readFileSync(join(dir, objectsFile), 'utf8')).toContain("label: 'Hives on site'")
})

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

test('drift resolved with pull --only: config takes the portal label, pull records the base, and the next plan is empty', async () => {
  const sim = portal()
  const dir = await applied(sim)
  live(sim, 'hive_count').label = 'Hives kept'
  const held = stepOf(await planOf(dir))?.held?.[0]
  expect(held?.resolve?.portal).toBe(`kalup pull --target sandbox --only ${hiveCount}`)
  const pulled = await printed(dir, held?.resolve?.portal)
  expect(pulled.exitCode, pulled.stderr).toBe(0)
  expect(configLabel(dir)).toBe('Hives kept')
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'created', base: { label: 'Hives kept' } })
  expect(sim.writes()).toEqual([])
  await planIsEmpty(dir)
})

test('conflict resolved with pull --accept: config takes the portal label, pull records the base, and the next plan is empty', async () => {
  const sim = portal()
  const dir = await applied(sim)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  live(sim, 'hive_count').label = 'Hives kept'
  const held = stepOf(await planOf(dir))?.held?.[0]
  expect(held?.class).toBe('conflict')
  const pulled = await printed(dir, held?.resolve?.portal)
  expect(pulled.exitCode, pulled.stderr).toBe(0)
  expect(configLabel(dir)).toBe('Hives kept')
  expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hives kept' })
  expect(sim.writes()).toEqual([])
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
    1 write, 0 destructive
    Type the target name to apply: "
  `)
  expect(writesOf(sim)).toEqual([`PATCH ${companies}/hive_count`])
  expect(sim.writes()[0]?.body).toMatchObject({ label: 'Hive count' })
  expect(live(sim, 'hive_count').label).toBe('Hive count')
  expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hive count' })

  // A conflict, minutes later: config's new value goes over the UI's.
  afterSettling(dir)
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

test('a group archived in HubSpot is recreated with plan --take config and a person at a terminal', async () => {
  const sim = portal()
  const dir = project({ groups: `${APIARY}    hive_log: { label: 'Hive log' },\n`, properties: HIVE_COUNT })
  await applyNow(dir)
  afterSettling(dir)
  const hiveLog = 'group:companies/hive_log'
  const group = sim.object(portalId, 'companies').groups.get('hive_log')
  if (group === undefined) {
    throw new Error('the first apply did not create hive_log')
  }
  group.archived = true
  expect((await planOf(dir)).missing).toMatchObject([
    { address: hiveLog, resolve: expect.arrayContaining([`kalup plan --target sandbox --take config ${hiveLog}`]) },
  ])
  const plan = await savePlan(dir, '--take', 'config', hiveLog)
  expect(effects(plan)).toMatchObject([{ address: hiveLog, action: 'create', labels: ['reverts-ui-edit'] }])
  sim.log.length = 0
  const out = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(writesOf(sim)).toEqual([`POST ${companies}/groups`])
  expect(sim.object(portalId, 'companies').groups.get('hive_log')).toMatchObject({ archived: false, label: 'Hive log' })
  await planIsEmpty(dir)
})
