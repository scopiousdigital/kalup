// Scenario: documents a later 1.x wrote. A later minor may add a resource type and optional fields within a format
// version. This version keeps in state what it does not know, reports a later type in a snapshot as not handled here,
// and refuses a saved plan that asks it to apply a type it does not know, before any request.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stableStringify } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cli } from '../../src/commands/testing.js'
import {
  afterSettling,
  apiary,
  apply,
  applyNow,
  edit,
  environment,
  hiveCount,
  lines,
  objectsFile,
  planOf,
  portal,
  project,
  savePlan,
  statePath,
  stateOf,
  terminal,
  writePlan,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const LIST = 'list:renewals_due'
const later = { origin: 'created', id: '4412', normVersion: 1, base: { name: 'Renewals due' }, revisionId: 'r7' }

/** State as a later 1.x leaves it: an entry of a type this version does not know, and fields it does not know. */
function addLater(dir: string): void {
  const state = JSON.parse(readFileSync(statePath(dir), 'utf8'))
  state.resources[LIST] = later
  state.resources[apiary].laterField = { kept: true }
  state.laterSetting = 'kept'
  writeFileSync(statePath(dir), `${JSON.stringify(state, null, 2)}\n`)
}

async function applied(): Promise<string> {
  portal()
  const dir = project()
  await applyNow(dir)
  afterSettling(dir)
  addLater(dir)
  return dir
}

test('plan leaves a later type alone, and says a later version of kalup manages it', async () => {
  const dir = await applied()
  const plan = await planOf(dir)
  expect(plan.steps.map((s) => s.address)).not.toContain(LIST)
  expect(plan.orphans).toEqual([
    {
      address: LIST,
      note: 'a later version of kalup manages list resources: this version leaves the entry as it is',
    },
  ])
})

test('a later type written a minute ago never settles here: this version does not read it', async () => {
  const dir = await applied()
  const state = JSON.parse(readFileSync(statePath(dir), 'utf8'))
  state.resources[LIST] = { ...later, writtenAt: new Date().toISOString(), written: { name: new Date().toISOString() } }
  writeFileSync(statePath(dir), `${JSON.stringify(state, null, 2)}\n`)
  const out = await cli(dir, 'plan', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  const env = JSON.parse(out.stdout)
  expect(env.issues.map((i: { code: string }) => i.code)).not.toContain('W_SETTLING')
  expect(env.data.coverage.complete).toBe(true)
})

test('apply keeps a later type, unknown fields on entries it does not rewrite, and unknown state fields', async () => {
  const dir = await applied()
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives'")
  await savePlan(dir)
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  const state = stateOf(dir) as unknown as Record<string, unknown> & { resources: Record<string, unknown> }
  expect(stableStringify(state.resources[LIST])).toBe(stableStringify(later))
  expect(state.resources[apiary]).toMatchObject({ laterField: { kept: true } })
  expect(state.laterSetting).toBe('kept')
  // apply rewrote this entry, so the fields a later version added to it go: a later version reads it as one an earlier
  // version wrote.
  expect(state.resources[hiveCount]).not.toHaveProperty('laterField')
})

test('pull keeps a later type, a pulled entry of one included, and unknown state fields', async () => {
  const dir = await applied()
  const state = JSON.parse(readFileSync(statePath(dir), 'utf8'))
  const pulled = { origin: 'pulled', id: 'renewals_due', normVersion: 1, base: { name: 'Renewals due' } }
  state.resources[LIST] = pulled
  // Without a base for hive_count, pull records one, so it saves the state file.
  delete state.resources[hiveCount].base
  writeFileSync(statePath(dir), `${JSON.stringify(state, null, 2)}\n`)
  const out = await cli(dir, 'pull', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(JSON.parse(out.stdout).data.state.recorded).toBeGreaterThan(0)
  const after = stateOf(dir) as unknown as Record<string, unknown> & { resources: Record<string, unknown> }
  expect(stableStringify(after.resources[LIST])).toBe(stableStringify(pulled))
  expect(after.laterSetting).toBe('kept')
})

test('state rebuild keeps a later type and unknown state fields, which it cannot check', async () => {
  const dir = await applied()
  const report = await cli(dir, 'state', 'rebuild', '--json')
  expect(report.exitCode, report.stdout).toBe(0)
  expect(JSON.parse(report.stdout).data.kept).toEqual([LIST])
  const out = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(out.stderr).toContain(`  kept as it is: ${LIST} (a later version of kalup manages it)`)
  const state = stateOf(dir) as unknown as Record<string, unknown> & { resources: Record<string, unknown> }
  expect(stableStringify(state.resources[LIST])).toBe(stableStringify(later))
  expect(state.laterSetting).toBe('kept')
})

test('a snapshot a later version took reads, and its later type is not handled here', async () => {
  portal()
  const dir = project()
  await applyNow(dir)
  afterSettling(dir)
  const taken = await cli(dir, 'snapshot', '--target', 'sandbox', '--out', 'later.json', '--json')
  expect(taken.exitCode, taken.stdout).toBe(0)
  const file = join(dir, 'later.json')
  const snapshot = JSON.parse(readFileSync(file, 'utf8'))
  snapshot.resources[LIST] = { type: 'list', managed: true, definition: { name: 'Renewals due', processingType: 'MANUAL' } }
  snapshot.observation.coverage.notCaptured.list = ['createdAt']
  snapshot.observation.coverage.lists = { status: 'read' }
  snapshot.observation.coverage.objects.companies.forms = { status: 'read' }
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`)
  const out = await cli(dir, 'compare', 'later.json', 'sandbox', '--json')
  // What this version cannot compare proves nothing, so the comparison is incomplete.
  expect(out.exitCode, out.stdout).toBe(1)
  const env = JSON.parse(out.stdout)
  expect(env.data.counts).toMatchObject({ equal: 3, differs: 0, unknown: 1 })
  expect(env.data.differences).toEqual([
    {
      address: LIST,
      status: 'unknown',
      reason: 'a later version of kalup handles list resources; this version does not compare them',
    },
  ])
  expect(env.issues).toMatchObject([
    { code: 'E_INCOMPLETE', fix: 'compare with a later version of kalup, which handles list resources' },
  ])
})

test('a saved plan with a step of a later type is refused before any request', async () => {
  const sim = portal()
  const dir = project()
  const plan = await savePlan(dir)
  const step = {
    id: `s${plan.steps.length + 1}`,
    address: LIST,
    action: 'create',
    risk: 'safe',
    transport: 'public-api',
    api: { family: 'crm.lists', version: '2026-09' },
    title: 'Create list "Renewals due" (renewals_due)',
    desired: { name: 'Renewals due' },
    expect: { exists: false },
  }
  writePlan(dir, { ...plan, steps: [...plan.steps, step] } as typeof plan, true)
  const before = sim.log.length
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.codes).toEqual(['E_PLAN_INVALID'])
  expect(out.issues[0]?.message).toContain(`${step.id} is a list step, which this version of kalup does not apply`)
  expect(lines(sim, before)).toEqual([])
})
