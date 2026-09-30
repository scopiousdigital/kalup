// Scenario: blocked steps are never silent. plan --exit-code exits 2 while anything is pending, blocked steps
// included, and says so; apply reports every step the plan blocked, with its address and reason, in text and JSON.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import { fault, type PortalSim } from '../../../engine/test/support/portal-sim.js'
import { cli, parseEnvelope } from '../../src/commands/testing.js'
import {
  apply,
  applyNow,
  configFile,
  edit,
  environment,
  hiveCount,
  liveProperty,
  objectsFile,
  portal,
  portalId,
  project,
  writeConfig,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The project applied, then HubSpot holds swarm_notes, which config lacks, and the project turns to takeover. */
async function takeoverWithoutAllowDestroy(sim: PortalSim): Promise<string> {
  const dir = project()
  await applyNow(dir)
  const model = sim.object(portalId, 'companies')
  model.properties.set('swarm_notes', liveProperty({ name: 'swarm_notes', type: 'string', fieldType: 'text' }))
  writeConfig(dir, {}, { mode: 'takeover' })
  return dir
}

test('plan --exit-code: 0 with nothing pending, 2 with a step to apply, and 2 when only blocked steps are left', async () => {
  const sim = portal()
  const dir = project()
  await applyNow(dir)
  const clean = await cli(dir, 'plan', '--exit-code')
  expect(clean.exitCode, clean.stderr).toBe(0)
  expect(clean.stdout).not.toContain('Changes pending')

  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives kept'")
  const pending = await cli(dir, 'plan', '--exit-code')
  expect(pending.exitCode).toBe(2)
  expect(pending.stdout.trimEnd().split('\n').at(-1)).toBe('Changes pending: 1 step to apply.')
  // Without the flag the same plan exits 0.
  expect((await cli(dir, 'plan')).exitCode).toBe(0)
  edit(dir, objectsFile, "label: 'Hives kept'", "label: 'Hive count'")

  sim.object(portalId, 'companies').properties.set('swarm_notes', liveProperty({ name: 'swarm_notes' }))
  writeConfig(dir, {}, { mode: 'takeover' })
  const blocked = await cli(dir, 'plan', '--exit-code', '--json')
  expect(blocked.exitCode).toBe(2)
  expect(parseEnvelope(blocked.stdout).ok).toBe(true)
  const text = await cli(dir, 'plan', '--exit-code')
  expect(text.stdout.trimEnd().split('\n').at(-1)).toBe('Changes pending: 1 blocked step, which counts as pending.')
})

// Takeover on deals was never evaluated, so a CI gate on plan --exit-code must not pass over the unread object.
test('plan --exit-code: an incomplete read counts as pending, even when the unread object has nothing in config', async () => {
  const sim = portal()
  const dir = project()
  await applyNow(dir)
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  edit(dir, configFile, '    companies: {},\n', '    companies: {},\n    deals: {},\n')
  const scope = { status: 'error', category: 'MISSING_SCOPES', message: 'This app lacks crm.schemas.deals.read.' }
  sim.fault({ method: 'GET', path: '/crm/properties/2026-09/deals', action: fault.status(403, scope) })
  const out = await cli(dir, 'plan', '--exit-code')
  expect(out.exitCode).toBe(2)
  const lines = out.stdout.trimEnd().split('\n')
  expect(lines).toContain('0 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 0 held')
  expect(lines.at(-1)).toBe('Changes pending: an incomplete read (not read: deals), which counts as pending.')
  expect((await cli(dir, 'plan')).exitCode).toBe(0)
})

test('apply reports what the plan blocked: how many, each address and reason, in the text and the JSON', async () => {
  const sim = portal()
  const dir = await takeoverWithoutAllowDestroy(sim)
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives kept'")
  const text = await apply(dir, '--yes')
  expect(text.exitCode, text.stderr).toBe(0)
  expect(normalise(text.stdout)).toMatchInlineSnapshot(`
    "Target sandbox, portal 7700001 (the only target)
    Applied plan pl_<id> on target sandbox, portal 7700001
    s1 done Update property "Hives kept" (hive_count) on companies, set label
    1 done.
    1 blocked, not run:
      s2 property:companies/swarm_notes: policy, takeover archives swarm_notes, and target sandbox does not allow deletes
    State: <dir>/.kalup/state/portal-7700001.json (serial 7). Journal: <dir>/.kalup/journal/portal-7700001/pl_<id>-<time>.jsonl
    "
  `)

  edit(dir, objectsFile, "label: 'Hives kept'", "label: 'Hives on site'")
  const json = await apply(dir, '--yes', '--json')
  expect(json.exitCode, json.stdout).toBe(0)
  expect(json.data?.steps.map((s) => [s.address, s.outcome, s.reason])).toEqual([
    [hiveCount, 'done', undefined],
    ['property:companies/swarm_notes', 'blocked', 'policy'],
  ])

  // With nothing left to run, apply still names what the plan blocked.
  const nothing = await apply(dir, '--yes', '--json')
  expect(nothing.data).toMatchObject({
    outcome: 'nothing',
    steps: [{ address: 'property:companies/swarm_notes', outcome: 'blocked', reason: 'policy' }],
  })
  expect(normalise((await apply(dir, '--yes')).stdout)).toMatchInlineSnapshot(`
    "Target sandbox, portal 7700001 (the only target)
    Nothing to apply: plan pl_<id> has no step that changes the portal or state.
    1 blocked, not run:
      s1 property:companies/swarm_notes: policy, takeover archives swarm_notes, and target sandbox does not allow deletes
    "
  `)
  expect(sim.writes().filter((w) => w.method === 'DELETE')).toEqual([])
})
