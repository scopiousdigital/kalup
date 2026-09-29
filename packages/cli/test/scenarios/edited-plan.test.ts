// Scenario: a changed title, risk label or current config. Titles are display only: an edited one applies, and the
// confirmation shows the title drawn from step data. A lowered risk or a dropped label is E_PLAN_RISK, even under a
// digest recomputed by a forger. The saved plan is the intent: object files edited after planning change nothing
// apply writes.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '@kalup/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cli } from '../../src/commands/testing.js'
import { normalise } from '../support/normalise.js'
import type { PortalSim } from '../support/portal-sim.js'
import {
  apply,
  applyNow,
  companies,
  configFile,
  edit,
  effects,
  environment,
  groups,
  hiveCount,
  live,
  liveProperty,
  notRead,
  objectsFile,
  planIsEmpty,
  planOf,
  portal,
  project,
  savePlan,
  stateBytes,
  stateOf,
  terminal,
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

test('changed title: an edited title applies, and the confirmation shows only the trusted title', async () => {
  const sim = portal()
  const dir = project()
  const plan = await savePlan(dir)
  const forged = 'Tidy the dashboard, nothing to see'
  writePlan(dir, { ...plan, steps: plan.steps.map((s) => ({ ...s, title: forged })) })
  const out = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(`${out.stdout}${out.stderr}`).not.toContain(forged)
  expect({ stderr: normalise(out.stderr), stdout: normalise(out.stdout) }).toMatchInlineSnapshot(`
    {
      "stderr": "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 safe Create property group "Apiary" (apiary) on companies
      s2 safe Create property "Hive count" (hive_count) on companies
    2 writes, 0 adoptions, 0 releases, 0 base records, 0 destructive
    Type the target name to apply: ",
      "stdout": "Applied plan pl_<id> on target sandbox, portal 7700001
    s1 done Create property group "Apiary" (apiary) on companies
    s2 done Create property "Hive count" (hive_count) on companies
    2 done.
    State: <dir>/.kalup/state/portal-7700001.json (serial 4). Journal: <dir>/.kalup/journal/portal-7700001/pl_<id>-<time>.jsonl
    ",
    }
  `)
  expect(writesOf(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
  await planIsEmpty(dir)
})

/** A plan that takes config over a label edited in HubSpot: one risky step labelled reverts-ui-edit. */
async function takeover(sim: PortalSim): Promise<{ dir: string; plan: Plan }> {
  const dir = project()
  await applyNow(dir)
  live(sim, 'hive_count').label = 'Hives kept'
  const plan = await savePlan(dir, '--take', 'config', `${hiveCount}#label`)
  const [step] = plan.steps
  if (plan.steps.length !== 1 || step?.risk !== 'risky' || step.labels?.join() !== 'reverts-ui-edit') {
    throw new Error(`the take is not one risky reverts-ui-edit step: ${JSON.stringify(plan.steps)}`)
  }
  sim.log.length = 0
  return { dir, plan }
}

test('changed risk label: a lowered risk or a dropped label is E_PLAN_RISK, before any write', async () => {
  const sim = portal()
  const { dir, plan } = await takeover(sim)
  const bytes = stateBytes(dir)

  // The stated risk is outside the digest: the file still verifies, and trusted derivation refuses it.
  writePlan(dir, { ...plan, steps: plan.steps.map((s) => ({ ...s, risk: 'safe' as const })) })
  const lowered = await apply(dir, 'plan.json', '--yes', '--json')
  expect(lowered.exitCode, lowered.stdout).toBe(1)
  expect(lowered.codes).toEqual(['E_PLAN_RISK'])
  expect(lowered.issues[0]?.message).toContain('s1 states risk safe, and it is risky')

  // At a terminal the person confirms what the file says; apply still refuses the lowered risk.
  const confirmed = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(confirmed.exitCode).toBe(1)
  expect(confirmed.stderr).toContain('E_PLAN_RISK')

  // A dropped label changes the digest, so a forger recomputes it: the label is derived again and missed.
  const unlabelled = plan.steps.map(({ labels: _, ...s }) => ({ ...s, risk: 'safe' as const }))
  writePlan(dir, { ...plan, steps: unlabelled }, true)
  const dropped = await apply(dir, 'plan.json', '--yes', '--json')
  expect(dropped.exitCode, dropped.stdout).toBe(1)
  expect(dropped.codes).toEqual(['E_PLAN_RISK'])
  expect(dropped.issues[0]?.message).toContain('s1 leaves out the label reverts-ui-edit')

  // The label alone dropped, risk kept: refused the same way.
  writePlan(dir, { ...plan, steps: plan.steps.map(({ labels: _, ...s }) => s) }, true)
  const atTerminal = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(atTerminal.exitCode).toBe(1)
  expect(atTerminal.stderr).toContain('E_PLAN_RISK: ')
  expect(atTerminal.stderr).toContain('s1 leaves out the label reverts-ui-edit')

  expect(notRead(sim.log)).toEqual([])
  expect(live(sim, 'hive_count').label).toBe('Hives kept')
  expect(stateBytes(dir)).toBe(bytes)
})

test('changed current config: object files edited after planning do not change what apply writes', async () => {
  const sim = portal()
  const dir = project()
  await applyNow(dir)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  const plan = await savePlan(dir)
  expect(plan.steps[0]?.changes).toMatchObject([{ unit: 'label', after: 'Hives on site' }])
  sim.log.length = 0

  // After planning, config moves on to another label.
  edit(dir, objectsFile, "label: 'Hives on site'", "label: 'Colonies'")
  const changed = await apply(dir, 'plan.json', '--yes', '--json')
  expect(changed.exitCode, changed.stdout).toBe(0)
  expect(writesOf(sim)).toEqual([`PATCH ${companies}/hive_count`])
  expect(sim.writes()[0]?.body).toMatchObject({ label: 'Hives on site' })
  expect(live(sim, 'hive_count').label).toBe('Hives on site')
  expect(stateOf(dir).resources[hiveCount]?.base).toMatchObject({ label: 'Hives on site' })

  // A create planned, then its object file deleted: apply still sends the plan's values.
  const other = portal()
  const fresh = project()
  const creates = await savePlan(fresh)
  rmSync(join(fresh, objectsFile))
  const created = await apply(fresh, 'plan.json', '--yes', '--json')
  expect(created.exitCode, created.stdout).toBe(0)
  expect(other.writes().map((w) => w.body)).toEqual([
    { name: 'apiary', label: 'Apiary' },
    { name: 'hive_count', label: 'Hive count', groupName: 'apiary', type: 'number', fieldType: 'number' },
  ])
  expect(creates.steps.map((s) => s.desired?.label)).toEqual(['Apiary', 'Hive count'])
})

// A binding the plan file gives but kalup.config.ts does not: the forger points an address at another portal property.
// apply rebuilds every name binding from the target's overrides and refuses before approval, so nothing is written.

const revenue = () =>
  liveProperty({ name: 'annual_hive_revenue', label: 'Annual hive revenue', type: 'number', fieldType: 'number' })

test('changed binding: a forged adopt of another portal property under --yes is E_BINDING_CHANGED, no write', async () => {
  const sim = portal({
    objects: {
      companies: {
        groups: [{ name: 'apiary', label: 'Apiary' }],
        properties: [revenue()],
      },
    },
  })
  const dir = project()
  const plan = await savePlan(dir)
  expect(plan.bindings).toEqual({})
  const steps = plan.steps.map((s) =>
    s.address === hiveCount
      ? {
          ...s,
          action: 'adopt' as const,
          desired: { ...s.desired, label: 'Annual hive revenue' },
          expect: { exists: true },
          baseUnits: ['label'],
        }
      : s,
  )
  writePlan(dir, { ...plan, bindings: { [hiveCount]: { name: 'annual_hive_revenue' } }, steps }, true)
  sim.log.length = 0
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(1)
  expect(out.codes).toEqual(['E_BINDING_CHANGED'])
  expect(normalise(String(out.issues[0]?.message))).toMatchInlineSnapshot(
    `"plan pl_<id> does not name what kalup.config.ts names on target sandbox: the plan binds property:companies/hive_count to portal name annual_hive_revenue, and the name override in kalup.config.ts gives none. Nothing was written."`,
  )
  expect(writesOf(sim)).toEqual([])
  expect(stateBytes(dir)).toBeNull()
})

test('changed binding: a forged delete of another portal property at a terminal is refused before the prompt, no write', async () => {
  const sim = portal({
    objects: {
      companies: {
        groups: [{ name: 'apiary', label: 'Apiary' }],
        properties: [revenue()],
      },
    },
  })
  const dir = project({ target: { allowDestroy: true } })
  await applyNow(dir)
  expect((await cli(dir, 'rm', hiveCount)).exitCode).toBe(0)
  const plan = await savePlan(dir)
  expect(plan.steps.map((s) => [s.address, s.action])).toEqual([[hiveCount, 'delete']])
  writePlan(dir, { ...plan, bindings: { [hiveCount]: { name: 'annual_hive_revenue' } } }, true)
  const bytes = stateBytes(dir)
  sim.log.length = 0
  const out = await apply(terminal(dir, 'sandbox', 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(1)
  expect(out.stderr).toContain('E_BINDING_CHANGED')
  expect(out.stderr).not.toContain('Type the target name')
  expect(writesOf(sim)).toEqual([])
  expect(live(sim, 'annual_hive_revenue').archived).toBe(false)
  expect(stateBytes(dir)).toBe(bytes)
})

test('a name override: the terminal confirmation and the result show the portal name next to the address', async () => {
  const sim = portal({
    objects: {
      companies: {
        groups: [{ name: 'apiary', label: 'Apiary' }],
        properties: [revenue()],
      },
    },
  })
  const dir = project()
  edit(
    dir,
    configFile,
    '      credentials:',
    `      overrides: { '${hiveCount}': { name: 'annual_hive_revenue' } },\n      credentials:`,
  )
  const plan = await savePlan(dir)
  expect(plan.bindings).toEqual({ [hiveCount]: { name: 'annual_hive_revenue' } })
  const out = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(out.stderr).toContain('portal name annual_hive_revenue')
  expect({ stderr: normalise(out.stderr), stdout: normalise(out.stdout) }).toMatchInlineSnapshot(`
    {
      "stderr": "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 safe Adopt property group "Apiary" (apiary) on companies
      s2 safe Adopt property "Hive count" (hive_count, portal name annual_hive_revenue) on companies
    0 writes, 2 adoptions, 0 releases, 0 base records, 0 destructive
    Type the target name to apply: ",
      "stdout": "Applied plan pl_<id> on target sandbox, portal 7700001
    s1 done Adopt property group "Apiary" (apiary) on companies
    s2 done Adopt property "Hive count" (hive_count, portal name annual_hive_revenue) on companies
    2 done.
    State: <dir>/.kalup/state/portal-7700001.json (serial 4). Journal: <dir>/.kalup/journal/portal-7700001/pl_<id>-<time>.jsonl
    ",
    }
  `)
  expect(writesOf(sim)).toEqual([])
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'adopted', id: 'annual_hive_revenue' })
  // Adoption never writes a label that differs: the next plan has nothing to do and holds it as diverged.
  const next = await planOf(dir)
  expect(effects(next)).toEqual([])
  expect(next.steps.flatMap((s) => s.held ?? []).map((h) => [h.unit, h.class])).toEqual([['label', 'diverged']])
})
