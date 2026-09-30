// Scenario: destruction and ownership release. A delete needs a destroy tombstone from kalup rm, an owning state
// entry, allowDestroy on the target and a person at a terminal typing the target name and the count; without any one
// of them nothing is deleted, and --yes and --approve never stand in for the person. With all four, one DELETE, an
// archived read-back and the entry gone. A release drops the entry with no request. Absence from config never
// deletes, and a group that holds a property no one manages is never deleted. A delete HubSpot refuses for a reason it
// names, as observed on 2026-09-29, is rejected in plain words.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import { fault, type PortalSim } from '../../../engine/test/support/portal-sim.js'
import { cli } from '../../src/commands/testing.js'
import {
  APIARY,
  apiary,
  apply,
  applyNow,
  companies,
  configFile,
  edit,
  effects,
  environment,
  groups,
  HIVE_COUNT,
  hiveCount,
  journalLines,
  live,
  liveProperty,
  objectsFile,
  planOf,
  portal,
  portalId,
  project,
  savePlan,
  stateBytes,
  stateOf,
  terminal,
  tombstones,
  writeConfig,
  writeKey,
  writeObjects,
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

/** The project applied: state owns the apiary group and hive_count, both created by Kalup. */
async function applied(sim: PortalSim): Promise<string> {
  const dir = project()
  await applyNow(dir)
  sim.log.length = 0
  return dir
}

async function rm(dir: string, ...args: string[]): Promise<void> {
  const out = await cli(dir, 'rm', ...args)
  if (out.exitCode !== 0) {
    throw new Error(`rm failed: ${out.stderr}`)
  }
}

const swarmNotes = 'property:companies/swarm_notes'

function deletes(sim: PortalSim): string[] {
  return sim.log.filter((r) => r.method === 'DELETE').map((r) => r.path)
}

/** Saves `plan` with its blocked delete at `address` turned destructive and re-hashed, as a forger would. */
function unblock(dir: string, plan: Plan, address: string): void {
  const steps = plan.steps.map((step) => {
    if (step.address !== address) {
      return step
    }
    const { blocked: _, ...open } = step
    return { ...open, risk: 'destructive' as const }
  })
  writePlan(dir, { ...plan, steps }, true)
}

test('destruction refused for each missing key: no tombstone, not owned, allowDestroy false, no terminal, --yes, --approve', async () => {
  const sim = portal()
  const dir = await applied(sim)

  // No tombstone: hive_count taken out of config by hand, with allowDestroy set, is an orphan and no step.
  writeConfig(dir, { allowDestroy: true })
  writeObjects(dir, APIARY, '')
  const orphaned = await planOf(dir)
  expect(orphaned.steps).toEqual([])
  expect(orphaned.orphans.map((o) => o.address)).toEqual([hiveCount])

  // Not owned: a destroy tombstone on a property Kalup never created or adopted.
  sim.object(portalId, 'companies').properties.set('swarm_notes', liveProperty({ name: 'swarm_notes' }))
  writeObjects(dir, APIARY, HIVE_COUNT)
  tombstones(dir, { 'property:companies/swarm_notes': 'destroy' })
  const notOwned = await planOf(dir)
  expect(notOwned.steps).toMatchObject([{ action: 'delete', risk: 'blocked', blocked: { reason: 'not-owned' } }])

  // Owned and tombstoned by kalup rm, on a target without allowDestroy.
  tombstones(dir, {})
  writeConfig(dir, {})
  await rm(dir, hiveCount)
  expect(readFileSync(join(dir, 'kalup', 'removed.ts'), 'utf8')).toContain(`'${hiveCount}': { action: 'destroy' }`)
  const policy = await planOf(dir)
  expect(policy.steps).toMatchObject([
    { address: hiveCount, action: 'delete', risk: 'blocked', blocked: { reason: 'policy' } },
  ])

  // All three in config: a destructive step, and still no person at a terminal.
  writeConfig(dir, { allowDestroy: true, write: 'KESTREL_WRITE_KEY' })
  const plan = await savePlan(dir)
  expect(effects(plan)).toMatchObject([{ address: hiveCount, action: 'delete', risk: 'destructive' }])
  vi.stubEnv('KESTREL_WRITE_KEY', writeKey)
  const noTerminal = await apply(dir, 'plan.json', '--json')
  expect(noTerminal.exitCode).toBe(4)
  expect(noTerminal.issues[0]).toMatchObject({ code: 'E_APPROVAL_REQUIRED', humanRequired: true })
  const yes = await apply(dir, 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.issues[0]?.message).toContain('--yes never covers a delete')
  // A reviewed CI job's approval: the plan's own digest and a write key held apart. Still never a delete.
  const approved = await apply(dir, 'plan.json', '--approve', plan.writesHash, '--json')
  expect(approved.exitCode).toBe(4)
  expect(approved.issues[0]).toMatchObject({ code: 'E_APPROVAL_REQUIRED', humanRequired: true })
  expect(approved.issues[0]?.message).toContain('--approve never covers a delete')
  // At a terminal, a wrong count cancels.
  const miscounted = await apply(terminal(dir, 'sandbox', '2'), 'plan.json')
  expect(miscounted.exitCode).toBe(1)
  expect(miscounted.stderr).toContain('E_CANCELLED')

  expect(deletes(sim)).toEqual([])
  expect(sim.writes()).toEqual([])
  expect(live(sim, 'hive_count').archived).toBe(false)
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'created' })
})

// The plan blocks a delete that lacks a key, and a blocked step never runs. These prove apply checks the keys again
// itself: the plan file is unblocked and re-hashed, a person confirms it at a terminal, and apply still refuses.
test('destruction refused by apply itself when the plan file unblocks a delete: not owned', async () => {
  const sim = portal()
  const dir = await applied(sim)
  sim.object(portalId, 'companies').properties.set('swarm_notes', liveProperty({ name: 'swarm_notes' }))
  tombstones(dir, { [swarmNotes]: 'destroy' })
  writeConfig(dir, { allowDestroy: true })
  const plan = await savePlan(dir)
  expect(plan.steps).toMatchObject([{ address: swarmNotes, action: 'delete', blocked: { reason: 'not-owned' } }])
  unblock(dir, plan, swarmNotes)
  const bytes = stateBytes(dir)

  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(1)
  expect(out.stderr).toContain('E_PLAN_RISK')
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 destructive Archive property swarm_notes on companies
    0 writes, 0 adoptions, 0 releases, 0 base records, 1 destructive
    Type the target name to apply: Type the number of destructive steps (1): E_PLAN_RISK: plan pl_<id> does not match what kalup derives from state and the portal: s1 delete property:companies/swarm_notes cannot run: no state entry owns it on this target, and Kalup deletes only what it created or adopted there. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_RISK.md)
    "
  `)
  expect(deletes(sim)).toEqual([])
  expect(writesOf(sim)).toEqual([])
  expect(live(sim, 'swarm_notes').archived).toBe(false)
  expect(stateBytes(dir)).toBe(bytes)
})

test('destruction refused by apply itself when the plan file unblocks a delete: allowDestroy false', async () => {
  const sim = portal()
  const dir = await applied(sim)
  await rm(dir, hiveCount)
  const plan = await savePlan(dir)
  expect(plan.target.allowDestroy).toBe(false)
  expect(plan.steps).toMatchObject([{ address: hiveCount, action: 'delete', blocked: { reason: 'policy' } }])
  unblock(dir, plan, hiveCount)
  const bytes = stateBytes(dir)

  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(1)
  expect(out.stderr).toContain('E_PLAN_RISK')
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 destructive Archive property hive_count on companies
    0 writes, 0 adoptions, 0 releases, 0 base records, 1 destructive
    Type the target name to apply: Type the number of destructive steps (1): E_PLAN_RISK: plan pl_<id> does not match what kalup derives from state and the portal: s1 delete property:companies/hive_count cannot run: target sandbox does not allow deletes. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_RISK.md)
    "
  `)
  expect(deletes(sim)).toEqual([])
  expect(writesOf(sim)).toEqual([])
  expect(live(sim, 'hive_count').archived).toBe(false)
  expect(stateBytes(dir)).toBe(bytes)
})

// A delete step written into a plan file, with a digest to match: the delete kalup rm never asked for. Its expect holds
// the live value of every unit the base holds, as the planner writes it, so only the missing request stops it.
function forgedDelete(dir: string, plan: Plan, address: string): void {
  const base = stateOf(dir).resources[address]?.base ?? {}
  const step = {
    id: 's1',
    address,
    action: 'delete' as const,
    risk: 'destructive' as const,
    transport: 'public-api' as const,
    api: { family: 'crm.properties', version: '2026-09' },
    title: `Archive ${address}`,
    expect: { exists: true, values: base },
  }
  writePlan(dir, { ...plan, target: { ...plan.target, allowDestroy: true }, steps: [step] }, true)
}

test('destruction refused before the prompt when the plan file deletes a property that sets preventDestroy', async () => {
  const sim = portal()
  const dir = project({
    target: { allowDestroy: true },
    properties: HIVE_COUNT.replace(
      "fieldType: 'number',",
      "fieldType: 'number',\n      lifecycle: { preventDestroy: true },",
    ),
  })
  await applyNow(dir)
  // rm refuses a destroy tombstone for it, so no plan kalup saves can delete it.
  const refused = await cli(dir, 'rm', hiveCount)
  expect(refused.exitCode).toBe(3)
  expect(refused.stderr).toContain('E_PREVENT_DESTROY')
  forgedDelete(dir, await savePlan(dir), hiveCount)
  const bytes = stateBytes(dir)
  sim.log.length = 0

  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(1)
  expect(out.stderr).toContain('E_PLAN_DELETE')
  expect(out.stderr).not.toContain('Type the target name')
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "E_PLAN_DELETE: plan pl_<id> deletes what config does not ask to delete: property:companies/hive_count is in config and sets lifecycle.preventDestroy. Nothing was written. (fix: to delete a resource, run kalup rm <address>, then kalup plan --target sandbox --out <file> and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_DELETE.md)
    "
  `)
  expect(deletes(sim)).toEqual([])
  expect(writesOf(sim)).toEqual([])
  expect(live(sim, 'hive_count').archived).toBe(false)
  expect(stateBytes(dir)).toBe(bytes)
})

test('destruction refused before the prompt when the plan file deletes a property with no destroy tombstone', async () => {
  const sim = portal()
  const dir = await applied(sim)
  // Out of config by hand, with no tombstone: an orphan, which no plan deletes.
  writeConfig(dir, { allowDestroy: true })
  writeObjects(dir, APIARY, '')
  const plan = await savePlan(dir)
  expect(plan.orphans.map((o) => o.address)).toEqual([hiveCount])
  forgedDelete(dir, plan, hiveCount)
  const bytes = stateBytes(dir)

  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(1)
  expect(out.stderr).toContain('E_PLAN_DELETE')
  expect(out.stderr).not.toContain('Type the target name')
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "E_PLAN_DELETE: plan pl_<id> deletes what config does not ask to delete: property:companies/hive_count has no destroy tombstone in kalup/removed.ts, and takeover does not archive it: the mode of companies on target sandbox is addon. Nothing was written. (fix: to delete a resource, run kalup rm <address>, then kalup plan --target sandbox --out <file> and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_DELETE.md)
    "
  `)
  // A release tombstone is no request to delete either: the same refusal.
  tombstones(dir, { [hiveCount]: 'release' })
  const released = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(released.exitCode, released.stderr).toBe(1)
  expect(released.stderr).toBe(out.stderr)
  expect(deletes(sim)).toEqual([])
  expect(writesOf(sim)).toEqual([])
  expect(stateBytes(dir)).toBe(bytes)
})

test('destruction refused before the prompt when another address in config names the deleted property and sets preventDestroy', async () => {
  const sim = portal()
  const dir = project({ target: { allowDestroy: true } })
  await applyNow(dir)
  await rm(dir, hiveCount)
  // decoy holds the portal property hive_count through a name override on this target, and protects it.
  const decoy = 'property:companies/decoy'
  const guarded = HIVE_COUNT.replace("hiveCount: p.number('hive_count'", "decoy: p.number('decoy'").replace(
    "fieldType: 'number',",
    "fieldType: 'number',\n      lifecycle: { preventDestroy: true },",
  )
  writeObjects(dir, APIARY, guarded)
  edit(
    dir,
    configFile,
    '      credentials:',
    `      overrides: { '${decoy}': { name: 'hive_count' } },\n      credentials:`,
  )
  expect((await cli(dir, 'validate')).exitCode).toBe(0)
  // The forger keeps only a delete of hive_count, with the values the portal holds and no bindings.
  forgedDelete(dir, { ...(await savePlan(dir)), bindings: {} }, hiveCount)
  const bytes = stateBytes(dir)
  sim.log.length = 0

  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(1)
  expect(out.stderr).toContain('E_PLAN_DELETE')
  expect(out.stderr).not.toContain('Type the target name')
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "E_PLAN_DELETE: plan pl_<id> deletes what config does not ask to delete: property:companies/hive_count resolves to property:companies/hive_count in the portal, which config holds as property:companies/decoy and protects with lifecycle.preventDestroy. Nothing was written. (fix: to delete a resource, run kalup rm <address>, then kalup plan --target sandbox --out <file> and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_DELETE.md)
    "
  `)
  expect(deletes(sim)).toEqual([])
  expect(writesOf(sim)).toEqual([])
  expect(live(sim, 'hive_count').archived).toBe(false)
  expect(stateBytes(dir)).toBe(bytes)
})

test('a delete whose expect leaves out what state holds is refused, so an edit in HubSpot after review stops it', async () => {
  const sim = portal()
  const dir = await applied(sim)
  await rm(dir, hiveCount)
  writeConfig(dir, { allowDestroy: true })
  const plan = await savePlan(dir)
  expect(effects(plan)).toMatchObject([
    { address: hiveCount, action: 'delete', expect: { values: { label: 'Hive count' } } },
  ])
  // A reviewed plan, then someone relabels it in HubSpot: the saved expect stops the delete.
  live(sim, 'hive_count').label = 'Hives kept'
  const stale = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(stale.exitCode, stale.stderr).toBe(1)
  expect(stale.stderr).toContain('E_PLAN_STALE')
  // A forger drops the values from expect and recomputes the digest: apply refuses the delete itself.
  writePlan(dir, { ...plan, steps: plan.steps.map((s) => ({ ...s, expect: { exists: true } })) }, true)
  const bytes = stateBytes(dir)
  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(1)
  expect(out.stderr).toContain('E_PLAN_RISK')
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 destructive Archive property hive_count on companies
    0 writes, 0 adoptions, 0 releases, 0 base records, 1 destructive
    Type the target name to apply: Type the number of destructive steps (1): E_PLAN_RISK: plan pl_<id> does not match what kalup derives from state and the portal: s1 delete property:companies/hive_count cannot run: its expect leaves out fieldType, group, label, type, which state's base holds, so an edit made in HubSpot since the review would not stop it. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_RISK.md)
    "
  `)
  expect(deletes(sim)).toEqual([])
  expect(live(sim, 'hive_count').archived).toBe(false)
  expect(stateBytes(dir)).toBe(bytes)
})

test('destruction with all four keys: one DELETE, the archived read-back, the entry gone, and no step after', async () => {
  const sim = portal()
  const dir = await applied(sim)
  await rm(dir, hiveCount)
  writeConfig(dir, { allowDestroy: true })
  const plan = await savePlan(dir)
  expect(effects(plan)).toMatchObject([
    { address: hiveCount, action: 'delete', risk: 'destructive', expect: { exists: true } },
  ])
  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 destructive Archive property hive_count on companies
    0 writes, 0 adoptions, 0 releases, 0 base records, 1 destructive
    Type the target name to apply: Type the number of destructive steps (1): "
  `)
  expect(deletes(sim)).toEqual([`${companies}/hive_count`])
  expect(sim.writes()).toHaveLength(1)
  const readBack = sim.log.slice(sim.log.findIndex((r) => r.method === 'DELETE') + 1)
  expect(readBack[0]).toMatchObject({
    method: 'GET',
    path: `${companies}/hive_count`,
    query: { archived: 'true' },
    status: 200,
  })
  expect(live(sim, 'hive_count').archived).toBe(true)
  expect(stateOf(dir).resources[hiveCount]).toBeUndefined()
  expect(stateOf(dir).resources[apiary]).toMatchObject({ origin: 'created' })

  const again = await planOf(dir)
  expect(again.steps).toEqual([])
  const count = sim.log.length
  const nothing = await apply(dir, '--yes', '--json')
  expect(nothing.data?.outcome).toBe('nothing')
  expect(deletes(sim)).toEqual([`${companies}/hive_count`])
  expect(sim.log.slice(count).filter((r) => r.method !== 'GET')).toEqual([])
})

test('ownership release: the entry is dropped with no request, and HubSpot keeps the property', async () => {
  const sim = portal()
  const dir = await applied(sim)
  await rm(dir, hiveCount, '--release')
  const plan = await savePlan(dir)
  expect(effects(plan)).toMatchObject([{ id: 's1', address: hiveCount, action: 'release', risk: 'safe' }])
  expect(effects(plan)[0]?.api).toBeUndefined()
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.data?.steps).toEqual([{ id: 's1', address: hiveCount, action: 'release', outcome: 'done' }])
  expect(sim.writes()).toEqual([])
  // No request served the release step itself: this run's journal holds only the observation's reads.
  const journal = readFileSync(out.data?.journal as string, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(journal.length).toBeGreaterThan(0)
  expect(journal.filter((line) => line.step !== 'observe')).toEqual([])
  expect(journal.every((line) => line.method === 'GET')).toBe(true)
  expect(stateOf(dir).resources[hiveCount]).toBeUndefined()
  expect(live(sim, 'hive_count')).toMatchObject({ archived: false, label: 'Hive count' })

  const again = await planOf(dir)
  expect(again.steps).toEqual([])
  expect(again.orphans).toEqual([])
})

test('absence never deletes: a property removed from config without rm is an orphan note and never a DELETE', async () => {
  const sim = portal()
  const dir = await applied(sim)
  writeConfig(dir, { allowDestroy: true })
  edit(dir, objectsFile, HIVE_COUNT, '')
  const plan = await savePlan(dir)
  expect(plan.steps).toEqual([])
  expect(plan.orphans).toHaveLength(1)
  expect(plan.orphans[0]?.address).toBe(hiveCount)
  expect(plan.orphans[0]?.note).toContain(`kalup rm ${hiveCount}`)
  expect(plan.orphans[0]?.note).toContain('--release')
  const bytes = stateBytes(dir)
  const saved = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(saved.exitCode, saved.stderr).toBe(0)
  const direct = await apply(terminal(dir, 'sandbox', '1'), '--target', 'sandbox')
  expect(direct.exitCode, direct.stderr).toBe(0)
  expect(deletes(sim)).toEqual([])
  expect(sim.writes()).toEqual([])
  expect(stateBytes(dir)).toBe(bytes)
  expect(live(sim, 'hive_count').archived).toBe(false)
})

test('a group that holds a property no one manages is never deleted, while its own deleted property is', async () => {
  const sim = portal()
  const dir = await applied(sim)
  // A beekeeper added a property to the group in HubSpot; no config and no state names it.
  sim.object(portalId, 'companies').properties.set('queen_age', liveProperty({ name: 'queen_age', label: 'Queen age' }))
  await rm(dir, hiveCount)
  await rm(dir, apiary)
  writeConfig(dir, { allowDestroy: true })
  const plan = await savePlan(dir)
  const group = plan.steps.find((s) => s.address === apiary)
  expect(group).toMatchObject({ action: 'delete', risk: 'blocked', blocked: { reason: 'unsupported' } })
  expect(group?.blocked?.detail).toContain('queen_age')
  expect(effects(plan).map((s) => [s.address, s.action])).toEqual([[hiveCount, 'delete']])

  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(deletes(sim)).toEqual([`${companies}/hive_count`])
  expect(sim.log.some((r) => r.method === 'DELETE' && r.path === `${groups}/apiary`)).toBe(false)
  expect(sim.object(portalId, 'companies').groups.get('apiary')?.archived).toBe(false)
  expect(stateOf(dir).resources[apiary]).toMatchObject({ origin: 'created' })

  // Planned again, the group stays blocked while it holds queen_age.
  const again = await planOf(dir)
  expect(again.steps.find((s) => s.address === apiary)).toMatchObject({ risk: 'blocked' })
  expect(effects(again)).toEqual([])
})

test('a group whose other member is archived in HubSpot is never deleted either', async () => {
  const sim = portal()
  const dir = await applied(sim)
  // A property archived in HubSpot long ago still names the group.
  sim
    .object(portalId, 'companies')
    .properties.set(
      'old_frames',
      liveProperty({ name: 'old_frames', archived: true, archivedAt: '2026-08-01T08:00:00.000Z' }),
    )
  await rm(dir, hiveCount)
  await rm(dir, apiary)
  writeConfig(dir, { allowDestroy: true })
  const plan = await savePlan(dir)
  const group = plan.steps.find((s) => s.address === apiary)
  expect(group).toMatchObject({ action: 'delete', risk: 'blocked', blocked: { reason: 'unsupported' } })
  expect(group?.blocked?.detail).toContain('archived: old_frames')
  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(deletes(sim)).toEqual([`${companies}/hive_count`])
  expect(sim.object(portalId, 'companies').groups.get('apiary')?.archived).toBe(false)
})

// A member that appears after the plan was saved: the plan shows two destructive deletes, and only apply's own check
// of the group's members, active and archived, stands between the group delete and a property no one manages. The
// simulator archives a deleted group's members, so a delete that got through would archive queen_age with it.
test.each([
  ['an active property', 'queen_age', liveProperty({ name: 'queen_age', label: 'Queen age' })],
  [
    'an archived property',
    'old_frames',
    liveProperty({ name: 'old_frames', archived: true, archivedAt: '2026-08-01T08:00:00.000Z' }),
  ],
])(
  'a group that gains %s after the plan is never deleted: apply refuses before any DELETE',
  async (_, name, member) => {
    const sim = portal({ groupDelete: 'archive-members' })
    const dir = await applied(sim)
    await rm(dir, hiveCount)
    await rm(dir, apiary)
    writeConfig(dir, { allowDestroy: true })
    const plan = await savePlan(dir)
    expect(effects(plan).map((s) => [s.address, s.action, s.risk])).toEqual([
      [hiveCount, 'delete', 'destructive'],
      [apiary, 'delete', 'destructive'],
    ])
    // A copy: the simulator changes what it holds in place, and the row stays what the portal held before.
    sim.object(portalId, 'companies').properties.set(name, structuredClone(member))
    const bytes = stateBytes(dir)

    const out = await apply(terminal(dir, 'sandbox', '2'), 'plan.json')
    expect(out.exitCode, out.stderr).toBe(1)
    expect(out.stderr).toContain('destructive steps (2)')
    expect(out.stderr).toContain('E_PLAN_RISK')
    expect(out.stderr).toMatch(new RegExp(`s2 delete ${apiary} cannot run: [^.]*${name}`))
    expect(deletes(sim)).toEqual([])
    expect(writesOf(sim)).toEqual([])
    expect(live(sim, name).archived).toBe(member.archived)
    expect(live(sim, 'hive_count').archived).toBe(false)
    expect(sim.object(portalId, 'companies').groups.get('apiary')?.archived).toBe(false)
    expect(stateBytes(dir)).toBe(bytes)
  },
)

test('a delete HubSpot refuses because a calculation property uses it is rejected in plain words, with its count', async () => {
  const sim = portal()
  const dir = await applied(sim)
  // A calculation property made in HubSpot uses hive_count; no config names it.
  sim.object(portalId, 'companies').properties.set(
    'hive_double',
    liveProperty({
      name: 'hive_double',
      type: 'number',
      fieldType: 'calculation_equation',
      calculated: true,
      calculationFormula: 'hive_count * 2',
    }),
  )
  await rm(dir, hiveCount)
  writeConfig(dir, { allowDestroy: true })
  await savePlan(dir)

  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(1)
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 destructive Archive property hive_count on companies
    0 writes, 0 adoptions, 0 releases, 0 base records, 1 destructive
    Type the target name to apply: Type the number of destructive steps (1): E_HTTP: s1 Archive property hive_count on companies was refused (VALIDATION_ERROR): HubSpot refuses to archive hive_count because it is in use (HubSpot counts 1 use) (fix: remove those uses in HubSpot first, then run kalup plan --target sandbox) (docs: errors/E_HTTP.md)
    "
  `)
  expect(deletes(sim)).toEqual([`${companies}/hive_count`])
  expect(live(sim, 'hive_count').archived).toBe(false)
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'created' })
  expect(stateOf(dir).lastApply?.outcome).toBe('partial')
  expect(journalLines(dir).filter((line) => line.method === 'DELETE')).toMatchObject([
    {
      status: 400,
      outcome: 'rejected',
      category: 'VALIDATION_ERROR',
      subCategory: 'PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE',
    },
  ])
})

test("the in-use count survives a long property name, past the 120 characters of HubSpot's message", async () => {
  const sim = portal()
  const name = 'hive_count_recorded_at_the_spring_inspection_of_each_kestrel_site'
  const dir = project({ properties: HIVE_COUNT.replace("'hive_count'", `'${name}'`) })
  await applyNow(dir)
  for (const [calculation, factor] of Object.entries({ hive_double: 2, hive_triple: 3 })) {
    sim.object(portalId, 'companies').properties.set(
      calculation,
      liveProperty({
        name: calculation,
        type: 'number',
        fieldType: 'calculation_equation',
        calculated: true,
        calculationFormula: `${name} * ${factor}`,
      }),
    )
  }
  await rm(dir, `property:companies/${name}`)
  writeConfig(dir, { allowDestroy: true })
  await savePlan(dir)

  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(1)
  expect(out.stderr).toContain('HubSpot counts 2 uses')
  expect(live(sim, name).archived).toBe(false)
})

test('a group delete HubSpot refuses because the group holds properties is rejected in plain words', async () => {
  const sim = portal()
  const dir = await applied(sim)
  await rm(dir, hiveCount)
  await rm(dir, apiary)
  writeConfig(dir, { allowDestroy: true })
  await savePlan(dir)
  // A property lands in the group between the checks and the DELETE: HubSpot answers as observed, its error body
  // nested, as JSON text, in the message.
  const correlationId = '01a0ec0d-ea13-7c1b-8aba-8df265916001'
  const nested = {
    status: 'error',
    message: "Can't delete or purge a group with active properties",
    correlationId,
    category: 'VALIDATION_ERROR',
    subCategory: 'PropertyGroupError.GROUP_WITH_ACTIVE_PROPERTIES',
  }
  const refusal = { status: 'error', message: JSON.stringify(nested), correlationId }
  sim.fault({ method: 'DELETE', path: `${groups}/apiary`, action: fault.status(400, refusal) })

  const out = await apply(terminal(dir, 'sandbox', '2'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(5)
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 destructive Archive property hive_count on companies
      s2 destructive Archive property group apiary on companies
    0 writes, 0 adoptions, 0 releases, 0 base records, 2 destructive
    Type the target name to apply: Type the number of destructive steps (2): E_HTTP: s2 Archive property group apiary on companies was refused (VALIDATION_ERROR): HubSpot refuses to archive a group that still holds properties (fix: run kalup plan --target sandbox: it names the properties the group holds) (docs: errors/E_HTTP.md)
    "
  `)
  expect(live(sim, 'hive_count').archived).toBe(true)
  expect(sim.object(portalId, 'companies').groups.get('apiary')?.archived).toBe(false)
  expect(stateOf(dir).resources[apiary]).toMatchObject({ origin: 'created' })
})
