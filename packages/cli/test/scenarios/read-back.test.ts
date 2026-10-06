// Scenario: a failed read-back or a failed state save. A create HubSpot answered 5xx is uncertain until a read shows
// the approved values; when none does within the deadline the step stays uncertain, the run exits 5 and lastApply says
// uncertain, and the next plan reconciles from what the portal shows, never with a second POST of a property that
// exists. A state save that fails after a verified write exits 5 with E_STATE_WRITE, the journal names the write, and
// the next plan adopts what the write made.
import { chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import { fault, type PortalSim } from '../../../engine/test/support/portal-sim.js'
import { cli } from '../../src/commands/testing.js'
import {
  apiary,
  apply,
  companies,
  effects,
  environment,
  hiveCount,
  intercept,
  journalLines,
  onFakeTime,
  planIsEmpty,
  planOf,
  portal,
  portalId,
  project,
  savePlan,
  stateOf,
  statePath,
  terminal,
  writeConfig,
} from './harness.js'

const readOnly: string[] = []

beforeEach(() => {
  environment()
})

afterEach(() => {
  for (const dir of readOnly.splice(0)) {
    chmodSync(dir, 0o755)
  }
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Every POST that named hive_count, with the status it got. */
function hiveCountPosts(sim: PortalSim): (number | null)[] {
  return sim.log
    .filter((r) => r.method === 'POST' && (r.body as { name?: string }).name === 'hive_count')
    .map((r) => r.status)
}

/**
 * From the property's POST on, no read shows hive_count: HubSpot's read-after-write lag, for longer than the
 * read-back waits. `stop` ends it.
 */
function lagAfterCreate(sim: PortalSim): { stop: () => void } {
  let hiding = false
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && new URL(String(input)).pathname === companies) {
      hiding = true
      return sim.fetch(input, init)
    }
    const { properties } = sim.object(portalId, 'companies')
    const hidden = method === 'GET' && hiding ? properties.get('hive_count') : undefined
    if (hidden) {
      properties.delete('hive_count')
    }
    try {
      return await sim.fetch(input, init)
    } finally {
      if (hidden) {
        properties.set('hive_count', hidden)
      }
    }
  })
  return {
    stop: () => {
      vi.stubGlobal('fetch', sim.fetch)
    },
  }
}

test('failed read-back of a create HubSpot applied: uncertain, exit 5; the next plan adopts it, with no second POST', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  sim.fault({ method: 'POST', path: companies, action: fault.status(502, { message: 'Bad gateway' }, { apply: true }) })
  const lag = lagAfterCreate(sim)
  const out = await onFakeTime(() => apply(dir, 'plan.json', '--yes', '--json'))
  expect(out.exitCode, out.stdout).toBe(5)
  expect(out.data?.outcome).toBe('uncertain')
  expect(out.data?.steps).toMatchObject([
    { address: apiary, outcome: 'done' },
    { address: hiveCount, outcome: 'uncertain', issue: 'E_UNCERTAIN_WRITE' },
  ])
  expect(out.codes).toContain('E_UNCERTAIN_WRITE')
  // Read back more than once, and never sent again.
  const reads = sim.log.filter((r) => r.method === 'GET' && r.path === `${companies}/hive_count`)
  expect(reads.length).toBeGreaterThan(2)
  expect(hiveCountPosts(sim)).toEqual([502])
  const state = stateOf(dir)
  expect(state.lastApply?.outcome).toBe('uncertain')
  expect(state.resources[hiveCount]).toBeUndefined()

  // HubSpot shows it now. The next plan adopts it; applying that sends no POST.
  lag.stop()
  const next = await savePlan(dir)
  expect(effects(next).map((s) => [s.address, s.action])).toEqual([[hiveCount, 'adopt']])
  const recovered = await apply(dir, 'plan.json', '--yes', '--json')
  expect(recovered.exitCode, recovered.stdout).toBe(0)
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'adopted', base: { label: 'Hive count' } })
  expect(hiveCountPosts(sim)).toEqual([502])
  await planIsEmpty(dir)
})

test('failed read-back of a create HubSpot acknowledged: unverified, exit 5, owned without a base; the next plan records it, no second POST', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  // HubSpot answers 201 naming the property, and no read shows it within the deadline.
  const lag = lagAfterCreate(sim)
  const out = await onFakeTime(() => apply(dir, 'plan.json', '--yes', '--json'))
  expect(out.exitCode, out.stdout).toBe(5)
  expect(out.data?.steps[1]).toMatchObject({ address: hiveCount, outcome: 'unverified', issue: 'W_UNVERIFIED' })
  expect(stateOf(dir).lastApply?.outcome).toBe('partial')
  // The 201 named it, so state owns it as created, with no base until a read agrees.
  // HubSpot acknowledged every field it was sent: a read in the next minutes that leaves it out is settling.
  expect(stateOf(dir).resources[hiveCount]).toEqual({
    origin: 'created',
    id: 'hive_count',
    normVersion: 1,
    written: {
      fieldType: expect.any(String),
      group: expect.any(String),
      label: expect.any(String),
      type: expect.any(String),
    },
  })

  lag.stop()
  const next = await savePlan(dir)
  expect(next.steps.filter((s) => s.action === 'create')).toEqual([])
  expect(effects(next)).toMatchObject([{ address: hiveCount, action: 'update' }])
  expect(effects(next)[0]?.changes ?? []).toEqual([])
  const recovered = await apply(dir, 'plan.json', '--yes', '--json')
  expect(recovered.exitCode, recovered.stdout).toBe(0)
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'created', base: { label: 'Hive count' } })
  expect(hiveCountPosts(sim)).toEqual([201])
  await planIsEmpty(dir)
})

test('a read-back that waits says so once on stderr in human mode, and never with --json', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  lagAfterCreate(sim)
  const human = await onFakeTime(() => apply(dir, 'plan.json', '--yes'))
  expect(human.exitCode, human.stderr).toBe(5)
  expect(human.stderr.match(/waiting for HubSpot/g)).toHaveLength(1)
  expect(normalise(human.stderr)).toMatchInlineSnapshot(`
    "s2: waiting for HubSpot to show the result, up to 60 s
    W_UNVERIFIED: s2 Create property "Hive count" (hive_count) on companies: HubSpot accepted it, and no read showed the result within 60 s (fix: run kalup plan --target sandbox to compare the portal with state again) (docs: errors/W_UNVERIFIED.md)
    "
  `)

  const again = portal()
  const other = project()
  await savePlan(other)
  lagAfterCreate(again)
  const json = await onFakeTime(() => apply(other, 'plan.json', '--yes', '--json'))
  expect(json.exitCode, json.stdout).toBe(5)
  expect(json.data?.steps[1]).toMatchObject({ address: hiveCount, outcome: 'unverified' })
  expect(json.stderr).toBe('')
  expect(json.stdout).not.toContain('waiting for HubSpot')
})

test('failed read-back of a create that never landed: uncertain, exit 5; the next plan creates it, sent once', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  sim.fault({ method: 'POST', path: companies, occurrence: 1, action: fault.status(502, { message: 'Bad gateway' }) })
  const out = await onFakeTime(() => apply(dir, 'plan.json', '--yes', '--json'))
  expect(out.exitCode, out.stdout).toBe(5)
  expect(out.data?.steps[1]).toMatchObject({ address: hiveCount, outcome: 'uncertain' })
  expect(stateOf(dir).lastApply?.outcome).toBe('uncertain')
  expect(sim.object(portalId, 'companies').properties.has('hive_count')).toBe(false)

  // The portal shows no such property, so the next plan creates it: one POST lands, and only one.
  const next = await savePlan(dir)
  expect(effects(next).map((s) => [s.address, s.action])).toEqual([[hiveCount, 'create']])
  const recovered = await apply(dir, 'plan.json', '--yes', '--json')
  expect(recovered.exitCode, recovered.stdout).toBe(0)
  expect(hiveCountPosts(sim)).toEqual([502, 201])
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'created' })
  await planIsEmpty(dir)
})

test('failed state save after a verified write: exit 5 E_STATE_WRITE, the journal names the write, the next plan adopts', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  // The state directory turns read-only as the property's POST goes out: the save after its read-back fails.
  intercept(sim, (method, path) => {
    if (method === 'POST' && path === companies) {
      const folder = dirname(statePath(dir))
      chmodSync(folder, 0o555)
      readOnly.push(folder)
    }
  })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(5)
  const issue = out.issues.find((i) => i.code === 'E_STATE_WRITE')
  expect(issue?.message).toContain(`Journal: ${out.data?.journal}`)
  expect(hiveCountPosts(sim)).toEqual([201])
  expect(sim.object(portalId, 'companies').properties.get('hive_count')?.label).toBe('Hive count')

  // The journal names the write that state could not record.
  const written = journalLines(dir).filter((line) => line.method === 'POST' && line.address === hiveCount)
  expect(written).toMatchObject([
    { step: 's2', path: '/crm/properties/2026-09/{objectType}', status: 201, outcome: 'ok', portalId },
  ])
  chmodSync(dirname(statePath(dir)), 0o755)
  const kept = stateOf(dir)
  expect(kept.resources[hiveCount]).toBeUndefined()
  expect(kept.lastApply?.outcome).toBe('running')

  vi.stubGlobal('fetch', sim.fetch)
  const next = await savePlan(dir)
  expect(effects(next).map((s) => [s.address, s.action])).toEqual([[hiveCount, 'adopt']])
  const recovered = await apply(dir, 'plan.json', '--yes', '--json')
  expect(recovered.exitCode, recovered.stdout).toBe(0)
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'adopted' })
  expect(hiveCountPosts(sim)).toEqual([201])
  await planIsEmpty(dir)
})

test('failed state save after a verified delete: exit 5 E_STATE_WRITE; the next plan releases the entry, no second DELETE', async () => {
  const sim = portal()
  const dir = project()
  await savePlan(dir)
  expect((await apply(dir, 'plan.json', '--yes')).exitCode).toBe(0)
  expect((await cli(dir, 'rm', hiveCount)).exitCode).toBe(0)
  writeConfig(dir, { allowDestroy: true })
  await savePlan(dir)
  intercept(sim, (method) => {
    if (method === 'DELETE') {
      const folder = dirname(statePath(dir))
      chmodSync(folder, 0o555)
      readOnly.push(folder)
    }
  })
  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(5)
  expect(out.stderr).toContain('E_STATE_WRITE')
  expect(sim.object(portalId, 'companies').properties.get('hive_count')?.archived).toBe(true)
  chmodSync(dirname(statePath(dir)), 0o755)
  // State still owns what HubSpot archived.
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'created' })

  vi.stubGlobal('fetch', sim.fetch)
  const next = await savePlan(dir)
  expect(effects(next)).toMatchObject([{ address: hiveCount, action: 'release', risk: 'safe' }])
  const released = await apply(dir, 'plan.json', '--yes', '--json')
  expect(released.exitCode, released.stdout).toBe(0)
  expect(stateOf(dir).resources[hiveCount]).toBeUndefined()
  expect(sim.log.filter((r) => r.method === 'DELETE')).toHaveLength(1)
  expect((await planOf(dir)).steps).toEqual([])
})
