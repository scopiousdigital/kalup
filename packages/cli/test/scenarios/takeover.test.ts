// Scenario: takeover mode and the settings around it. Takeover archives the custom properties and groups in an object's
// pull scope that config lacks, and removes enum options only the portal holds, each only with allowDestroy on the
// target and a person at a terminal; never what exclude names, what HubSpot defines, or anything after an incomplete
// read. The mode resolves target object, target, object, top level. adopt: 'overwrite' writes config over a first
// adoption's differing units, a take accepts a glob, and yesLimit replaces the fixed --yes limit.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import { fault, type PortalSim } from '../../../engine/test/support/portal-sim.js'
import { cli, parseEnvelope } from '../../src/commands/testing.js'
import {
  APIARY,
  apply,
  applyNow,
  companies,
  configFile,
  edit,
  effects,
  environment,
  groups,
  HIVE_COUNT,
  HONEY_GRADE,
  hiveCount,
  honeyGrade,
  live,
  liveProperty,
  objectsFile,
  planIsEmpty,
  planOf,
  portal,
  portalId,
  project,
  savePlan,
  terminal,
  writeConfig,
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

const swarmNotes = 'property:companies/swarm_notes'
const logEntry = 'property:companies/log_entry'
const hiveLog = 'group:companies/hive_log'

/** The project applied in addon mode, then HubSpot holds what config lacks: swarm_notes, and hive_log with log_entry. */
async function unmanaged(sim: PortalSim): Promise<string> {
  const dir = project()
  await applyNow(dir)
  const model = sim.object(portalId, 'companies')
  model.properties.set('swarm_notes', liveProperty({ name: 'swarm_notes', type: 'string', fieldType: 'text' }))
  model.groups.set('hive_log', { name: 'hive_log', label: 'Hive log', displayOrder: -1, archived: false })
  model.properties.set('log_entry', liveProperty({ name: 'log_entry', groupName: 'hive_log' }))
  sim.log.length = 0
  return dir
}

function deletes(sim: PortalSim): string[] {
  return sim.log.filter((r) => r.method === 'DELETE').map((r) => r.path)
}

function summary(steps: { action: string; address: string; blocked?: { reason: string }; risk: string }[]) {
  return steps.map((s) => `${s.action} ${s.address} ${s.risk}${s.blocked ? ` (${s.blocked.reason})` : ''}`)
}

test('takeover archives the custom properties and the emptied group config lacks, only for a person at a terminal', async () => {
  const sim = portal()
  const dir = await unmanaged(sim)
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })

  const text = await cli(dir, 'plan')
  expect(text.exitCode, text.stderr).toBe(0)
  expect(normalise(text.stdout)).toMatchInlineSnapshot(`
    "Target sandbox, portal 7700001 (the only target)
    Plan pl_<id> for target sandbox, portal 7700001 (SANDBOX, not protected)
    Settings: mode takeover on companies, else addon; adopt hold; drift hold; allowDestroy true; yesLimit 25
    Takeover on companies: what config lacks in the pull scope is archived, and options only the portal holds are removed; each confirmed by a person at a terminal
    s1 destructive [takeover] Archive property "log_entry" (log_entry) on companies
      note mode: takeover (the top-level mode): HubSpot holds it in the pull scope of companies, and config does not
    s2 destructive [takeover] Archive property "swarm_notes" (swarm_notes) on companies
      note mode: takeover (the top-level mode): HubSpot holds it in the pull scope of companies, and config does not
    s3 destructive [takeover] Archive property group "Hive log" (hive_log) on companies
      note mode: takeover (the top-level mode): HubSpot holds it in the pull scope of companies, and config does not
    0 safe, 0 risky, 3 destructive, 0 blocked, 0 manual; 0 held
    Coverage: complete; 0 unsupported, 0 skipped.
    About 17 API calls; 999969 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    "
  `)
  const plan = await savePlan(dir)
  expect(plan.target).toMatchObject({ takeover: ['companies'], allowDestroy: true })
  expect(summary(effects(plan))).toEqual([
    `delete ${logEntry} destructive`,
    `delete ${swarmNotes} destructive`,
    `delete ${hiveLog} destructive`,
  ])
  expect(effects(plan).map((s) => s.labels)).toEqual([['takeover'], ['takeover'], ['takeover']])

  // --yes never covers an archive, and neither does no terminal.
  const yes = await apply(dir, 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.issues[0]?.message).toContain('this plan deletes 3 resources, and --yes never covers a delete')
  expect(deletes(sim)).toEqual([])

  const out = await apply(terminal(dir, 'sandbox', '3'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  // The properties go first, then the group they were in.
  expect(deletes(sim)).toEqual([`${companies}/log_entry`, `${companies}/swarm_notes`, `${groups}/hive_log`])
  expect(live(sim, 'swarm_notes').archived).toBe(true)
  expect(live(sim, 'log_entry').archived).toBe(true)
  expect(sim.object(portalId, 'companies').groups.get('hive_log')?.archived).toBe(true)
  expect(live(sim, 'hive_count').archived).toBe(false)
  await planIsEmpty(dir)
})

test('without allowDestroy a takeover archive is blocked, and its fix leads with the pull that keeps it in config', async () => {
  const sim = portal()
  const dir = await unmanaged(sim)
  writeConfig(dir, {}, { mode: 'takeover' })
  const plan = await planOf(dir)
  expect(summary(plan.steps)).toEqual([
    `delete ${logEntry} blocked (policy)`,
    `delete ${swarmNotes} blocked (policy)`,
    `delete ${hiveLog} blocked (policy)`,
  ])
  expect(plan.steps[1]?.blocked).toMatchInlineSnapshot(`
    {
      "blocks": [],
      "detail": "takeover archives swarm_notes, and target sandbox does not allow deletes",
      "fix": "keep it in config: run kalup pull --target sandbox --only property:companies/swarm_notes; or leave it unmanaged: add 'swarm_notes' to objects.companies.exclude; or archive it: set allowDestroy: true under targets.sandbox in kalup.config.ts",
      "reason": "policy",
    }
  `)
  const out = await apply(dir, '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(sim.writes()).toEqual([])
})

test('exclude keeps a property out of pull and out of takeover', async () => {
  const sim = portal()
  const dir = await unmanaged(sim)
  sim.object(portalId, 'companies').properties.set('zi_score', liveProperty({ name: 'zi_score' }))
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover', companies: "{ exclude: ['zi_*', 'log_entry'] }" })
  const plan = await planOf(dir)
  // log_entry is excluded, so hive_log still holds a property takeover leaves alone: neither goes.
  expect(summary(plan.steps)).toEqual([`delete ${swarmNotes} destructive`])

  const pulled = await cli(dir, 'pull')
  expect(pulled.exitCode, pulled.stderr).toBe(0)
  const file = readFileSync(join(dir, objectsFile), 'utf8')
  expect(file).toContain("p.string('swarm_notes'")
  expect(file).not.toContain('zi_score')
  expect(file).not.toContain('log_entry')
  expect(normalise(pulled.stdout).split('\n').at(-2)).toMatchInlineSnapshot(
    `"Takeover on companies: a plan for target sandbox would archive nothing."`,
  )
  expect(sim.writes()).toEqual([])
})

test('pull --only notes what takeover would archive: the in-scope resources it left out', async () => {
  const sim = portal()
  const dir = await unmanaged(sim)
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  const pulled = await cli(dir, 'pull', '--only', swarmNotes)
  expect(pulled.exitCode, pulled.stderr).toBe(0)
  expect(normalise(pulled.stdout).split('\n').at(-2)).toMatchInlineSnapshot(
    `"Takeover on companies: a plan for target sandbox would archive property:companies/log_entry, group:companies/hive_log."`,
  )
})

test('takeover never archives what HubSpot defines or calculates', async () => {
  const sim = portal()
  const dir = project()
  await applyNow(dir)
  // name is HubSpot's own in companyinformation; hive_double is a calculation made in HubSpot.
  sim.object(portalId, 'companies').properties.set(
    'hive_double',
    liveProperty({
      name: 'hive_double',
      fieldType: 'calculation_equation',
      calculated: true,
      calculationFormula: 'hive_count * 2',
    }),
  )
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  const plan = await planIsEmpty(dir)
  expect(plan.target.takeover).toEqual(['companies'])
})

test('an incomplete read blocks every takeover removal on the target', async () => {
  const sim = portal()
  const dir = await unmanaged(sim)
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  edit(dir, configFile, '    companies: {},\n', '    companies: {},\n    deals: {},\n')
  const scope = { status: 'error', category: 'MISSING_SCOPES', message: 'This app lacks crm.schemas.deals.read.' }
  sim.fault({ method: 'GET', path: '/crm/properties/2026-09/deals', action: fault.status(403, scope) })
  const plan = await planOf(dir)
  expect(plan.coverage.complete).toBe(false)
  expect(summary(plan.steps)).toEqual([
    `delete ${logEntry} blocked (scope)`,
    `delete ${swarmNotes} blocked (scope)`,
    `delete ${hiveLog} blocked (scope)`,
  ])
  expect(plan.steps[1]?.blocked?.detail).toBe(
    'takeover would archive swarm_notes, and the read of target sandbox was incomplete, so takeover removes nothing there',
  )
})

test('takeover removes an option only the portal holds, with allowDestroy and a person at a terminal', async () => {
  const sim = portal()
  const dir = project({ properties: HIVE_COUNT + HONEY_GRADE })
  await applyNow(dir)
  // An admin adds an option in HubSpot.
  live(sim, 'honey_grade').options.push({ value: 'dark', label: 'Dark', displayOrder: 2, hidden: false })
  sim.log.length = 0

  // Addon keeps it with a note.
  expect((await planOf(dir)).steps.find((s) => s.address === honeyGrade)?.notes?.[0]?.unit).toBe('options[dark]')

  writeConfig(dir, {}, { mode: 'takeover' })
  const blocked = (await planOf(dir)).steps.find((s) => s.address === honeyGrade)
  expect(blocked).toMatchObject({ action: 'update', risk: 'blocked', blocked: { reason: 'policy' } })
  expect(blocked?.blocked?.fix).toBe(
    "keep them in config: run kalup pull --target sandbox --only property:companies/honey_grade; or keep them unmanaged: set lifecycle: { options: 'additive' } on honey_grade; or remove them: set allowDestroy: true under targets.sandbox in kalup.config.ts",
  )
  expect(blocked?.notes).toEqual([
    {
      unit: 'mode',
      live: 'takeover',
      note: 'takeover (the top-level mode): only the portal holds the option "dark", and config does not',
    },
  ])

  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  const plan = await savePlan(dir)
  expect(effects(plan)).toMatchObject([
    {
      address: honeyGrade,
      action: 'update',
      risk: 'destructive',
      labels: ['takeover'],
      changes: [{ unit: 'options[dark]', op: 'remove' }],
    },
  ])
  const yes = await apply(dir, 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.issues[0]?.message).toContain('this plan removes options from 1 property, and --yes never covers a delete')
  expect(sim.writes()).toEqual([])

  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(writesOf(sim)).toEqual([`PATCH ${companies}/honey_grade`])
  expect(live(sim, 'honey_grade').options.map((o) => o.value)).toEqual(['light', 'amber'])
  await planIsEmpty(dir)
})

test("an explicit lifecycle options: 'additive' keeps admin-added options under takeover", async () => {
  const sim = portal()
  const additive = HONEY_GRADE.replace('      ],\n', "      ],\n      lifecycle: { options: 'additive' },\n")
  const dir = project({ properties: HIVE_COUNT + additive })
  await applyNow(dir)
  live(sim, 'honey_grade').options.push({ value: 'dark', label: 'Dark', displayOrder: 2, hidden: false })
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  const step = (await planOf(dir)).steps.find((s) => s.address === honeyGrade)
  expect(step).toMatchObject({ action: 'update', risk: 'safe', notes: [{ unit: 'options[dark]' }] })
  expect(step?.changes).toBeUndefined()
})

test('an object at addon inside a takeover project archives nothing', async () => {
  const sim = portal()
  const dir = await unmanaged(sim)
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover', companies: "{ mode: 'addon' }" })
  const plan = await planIsEmpty(dir)
  expect(plan.target.takeover).toEqual([])
})

test('a target pinned to addon archives nothing and warns that it shadows the object mode; its object statement wins', async () => {
  const sim = portal()
  const dir = await unmanaged(sim)
  writeConfig(dir, { allowDestroy: true, mode: 'addon' }, { companies: "{ mode: 'takeover' }" })
  expect((await planIsEmpty(dir)).target.takeover).toEqual([])
  const checked = await cli(dir, 'validate', '--json')
  expect(checked.exitCode).toBe(0)
  expect(parseEnvelope(checked.stdout).issues).toMatchObject([
    {
      code: 'W_MODE_SHADOWED',
      message: "targets.sandbox.mode 'addon' overrides objects.companies.mode 'takeover' on target sandbox",
      configPath: 'targets.sandbox.mode',
    },
  ])

  // The most specific statement wins: this target's own statement for companies.
  const pinned = { allowDestroy: true, mode: 'addon', objects: "{ companies: { mode: 'takeover' } }" } as const
  writeConfig(dir, pinned, { companies: "{ mode: 'addon' }" })
  const plan = await planOf(dir)
  expect(plan.target.takeover).toEqual(['companies'])
  expect(summary(effects(plan))).toHaveLength(3)
})

test("adopt: 'overwrite' writes config over a first adoption's differing units, risky and labelled", async () => {
  const sim = portal({
    objects: {
      companies: {
        groups: [{ name: 'apiary', label: 'Apiary' }],
        properties: [{ name: 'hive_count', label: 'Hives', type: 'number', fieldType: 'number', groupName: 'apiary' }],
      },
    },
  })
  const dir = project()
  // With adopt held, the label config and HubSpot never agreed on is held.
  const held = await planOf(dir)
  expect(held.steps.find((s) => s.address === hiveCount)?.held).toMatchObject([{ unit: 'label', class: 'diverged' }])

  writeConfig(dir, { adopt: 'overwrite' })
  const plan = await savePlan(dir)
  const adopt = plan.steps.find((s) => s.address === hiveCount)
  expect(adopt).toMatchObject({
    action: 'adopt',
    risk: 'risky',
    labels: ['overwrites-portal'],
    changes: [{ unit: 'label', class: 'diverged', before: 'Hives', after: 'Hive count' }],
  })
  expect(adopt?.held).toBeUndefined()
  const yes = await apply(dir, 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.issues[0]?.message).toContain('(risky) is not safe')

  const out = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(live(sim, 'hive_count').label).toBe('Hive count')
  await planIsEmpty(dir)
})

test('--take config with a glob takes every held unit it matches, labelled overwrites-portal', async () => {
  const sim = portal({
    objects: {
      companies: {
        groups: [{ name: 'apiary', label: 'Apiary' }],
        properties: [
          { name: 'hive_count', label: 'Hives', type: 'number', fieldType: 'number', groupName: 'apiary' },
          {
            name: 'honey_grade',
            label: 'Grade',
            type: 'enumeration',
            fieldType: 'select',
            groupName: 'apiary',
            options: [
              { value: 'light', label: 'Light', displayOrder: 0, hidden: false },
              { value: 'amber', label: 'Amber', displayOrder: 1, hidden: false },
            ],
          },
        ],
      },
    },
  })
  const dir = project({ properties: HIVE_COUNT + HONEY_GRADE })
  const plan = await savePlan(dir, '--take', 'config', 'property:companies/*')
  expect(effects(plan).filter((s) => s.address.startsWith('property:'))).toMatchObject([
    { address: hiveCount, labels: ['overwrites-portal'], changes: [{ unit: 'label', after: 'Hive count' }] },
    { address: honeyGrade, labels: ['overwrites-portal'], changes: [{ unit: 'label', after: 'Honey grade' }] },
  ])
  const out = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect([live(sim, 'hive_count').label, live(sim, 'honey_grade').label]).toEqual(['Hive count', 'Honey grade'])
  await planIsEmpty(dir)
})

test('yesLimit replaces the fixed --yes limit, and 0 turns --yes off', async () => {
  portal()
  const dir = project({ properties: HIVE_COUNT + HONEY_GRADE, target: { yesLimit: 2 } })
  const over = await apply(dir, '--yes', '--json')
  expect(over.exitCode).toBe(4)
  expect(over.issues[0]?.message).toBe(
    '--yes does not cover this plan: it has 3 writes, adoptions and releases, and --yes covers at most 2 on target sandbox (yesLimit).',
  )
  writeConfig(dir, { yesLimit: 0 })
  const off = await apply(dir, '--yes', '--json')
  expect(off.exitCode).toBe(4)
  expect(off.issues[0]?.message).toContain('target sandbox sets yesLimit: 0, which turns --yes off')
  writeConfig(dir, { yesLimit: 3 })
  const done = await apply(dir, '--yes', '--json')
  expect(done.exitCode, done.stdout).toBe(0)
  await planIsEmpty(dir)
})

test('HubSpot refuses to archive a property a calculation uses, and apply reports its answer plainly', async () => {
  const sim = portal()
  const dir = project({ groups: APIARY })
  await applyNow(dir)
  const model = sim.object(portalId, 'companies')
  model.properties.set('swarm_notes', liveProperty({ name: 'swarm_notes' }))
  model.properties.set(
    'swarm_double',
    liveProperty({
      name: 'swarm_double',
      fieldType: 'calculation_equation',
      calculated: true,
      calculationFormula: 'swarm_notes * 2',
    }),
  )
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  await savePlan(dir)
  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode).toBe(1)
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 destructive [takeover] Archive property swarm_notes on companies
    0 writes, 0 adoptions, 0 releases, 0 base records, 1 destructive
    Type the target name to apply: Type the number of destructive steps (1): E_HTTP: s1 Archive property swarm_notes on companies was refused (VALIDATION_ERROR): HubSpot refuses to archive swarm_notes because it is in use (HubSpot counts 1 use) (fix: remove those uses in HubSpot first, then run kalup plan --target sandbox) (docs: errors/E_HTTP.md)
    "
  `)
  expect(live(sim, 'swarm_notes').archived).toBe(false)
})

test('apply checks takeover again: an exclude added since the plan is E_PLAN_DELETE, a mode changed E_POLICY_CHANGED', async () => {
  const sim = portal()
  const dir = await unmanaged(sim)
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  await savePlan(dir)
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover', companies: "{ exclude: ['swarm_notes'] }" })
  const excluded = await apply(terminal(dir, 'sandbox', '3'), 'plan.json', '--json')
  expect(excluded.exitCode).toBe(1)
  expect(excluded.codes).toEqual(['E_PLAN_DELETE'])
  expect(excluded.issues[0]?.message).toContain(
    'property:companies/swarm_notes has no destroy tombstone in kalup/removed.ts, and takeover does not archive it: objects.companies.exclude names swarm_notes',
  )
  writeConfig(dir, { allowDestroy: true })
  const addon = await apply(terminal(dir, 'sandbox', '3'), 'plan.json', '--json')
  expect(addon.codes).toEqual(['E_POLICY_CHANGED'])
  expect(addon.issues[0]?.message).toContain('takeover was companies, now none')
  expect(sim.writes()).toEqual([])
})

test('a forged plan that drops the takeover label from an option removal is refused under the lock', async () => {
  const sim = portal()
  const dir = project({ properties: HIVE_COUNT + HONEY_GRADE })
  await applyNow(dir)
  live(sim, 'honey_grade').options.push({ value: 'dark', label: 'Dark', displayOrder: 2, hidden: false })
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  const plan = await savePlan(dir)
  sim.log.length = 0
  const steps = plan.steps.map((step) =>
    step.address === honeyGrade ? { ...step, risk: 'risky' as const, labels: undefined } : step,
  )
  writePlan(dir, { ...plan, steps }, true)
  const out = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(out.exitCode).toBe(1)
  expect(normalise(out.stderr)).toContain('E_PLAN_RISK')
  expect(normalise(out.stderr)).toContain('states risk risky, and it is destructive')
  expect(sim.writes()).toEqual([])
  expect(live(sim, 'honey_grade').options.map((o) => o.value)).toEqual(['light', 'amber', 'dark'])
})

test('apply checks takeover against its own read: a skip override added on the group since the plan is E_PLAN_RISK', async () => {
  const sim = portal()
  const dir = project({ groups: `${APIARY}    hive_log: { label: 'Hive log' },\n` })
  await applyNow(dir)
  sim
    .object(portalId, 'companies')
    .properties.set('log_entry', liveProperty({ name: 'log_entry', groupName: 'hive_log' }))
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  const plan = await savePlan(dir)
  expect(summary(effects(plan))).toEqual([`delete ${logEntry} destructive`])
  edit(dir, configFile, '      credentials:', `      overrides: { '${hiveLog}': { skip: true } },\n      credentials:`)
  expect((await planOf(dir)).steps.map((s) => s.address)).not.toContain(logEntry)
  sim.log.length = 0
  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode).toBe(1)
  expect(normalise(out.stderr)).toContain('E_PLAN_RISK')
  expect(normalise(out.stderr)).toContain(
    `s1 delete ${logEntry} cannot run: takeover never archives it: HubSpot holds it in ${hiveLog}, which a skip override leaves out on target sandbox`,
  )
  expect(sim.writes()).toEqual([])
  expect(live(sim, 'log_entry').archived).toBe(false)
})

test('a forged plan that archives an empty group is refused under the lock: takeover never takes an empty group', async () => {
  const sim = portal()
  const dir = await unmanaged(sim)
  sim.object(portalId, 'companies').groups.set('empty_one', {
    name: 'empty_one',
    label: 'Empty one',
    displayOrder: -1,
    archived: false,
  })
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  const plan = await savePlan(dir)
  expect(plan.steps.map((s) => s.address)).not.toContain('group:companies/empty_one')
  const group = plan.steps.find((s) => s.address === hiveLog)
  const forged = {
    ...group,
    id: `s${plan.steps.length + 1}`,
    address: 'group:companies/empty_one',
    expect: { exists: true, values: { label: 'Empty one' } },
  } as Plan['steps'][number]
  writePlan(dir, { ...plan, steps: [...plan.steps, forged] }, true)
  sim.log.length = 0
  const out = await apply(terminal(dir, 'sandbox', '4'), 'plan.json')
  expect(out.exitCode).toBe(1)
  expect(normalise(out.stderr)).toContain('E_PLAN_RISK')
  expect(normalise(out.stderr)).toContain(
    's4 delete group:companies/empty_one cannot run: it held no property when apply read it',
  )
  expect(sim.writes()).toEqual([])
})

test('the takeover heading comes before the first takeover step, an option removal included, and says when all are blocked', async () => {
  const sim = portal()
  const dir = project({ properties: HIVE_COUNT + HONEY_GRADE })
  await applyNow(dir)
  live(sim, 'honey_grade').options.push({ value: 'dark', label: 'Dark', displayOrder: 2, hidden: false })
  sim.object(portalId, 'companies').properties.set('swarm_notes', liveProperty({ name: 'swarm_notes' }))
  writeConfig(dir, { allowDestroy: true }, { mode: 'takeover' })
  const lines = async () =>
    normalise((await cli(dir, 'plan')).stdout)
      .split('\n')
      .slice(2, -5)
      .join('\n')
  expect(await lines()).toMatchInlineSnapshot(`
    "Settings: mode takeover on companies, else addon; adopt hold; drift hold; allowDestroy true; yesLimit 25
    Takeover on companies: what config lacks in the pull scope is archived, and options only the portal holds are removed; each confirmed by a person at a terminal
    s1 destructive [takeover] Update property "Honey grade" (honey_grade) on companies, remove options "Dark"
      - option "Dark" ("dark")
      note mode: takeover (the top-level mode): only the portal holds the option "dark", and config does not
    s2 destructive [takeover] Archive property "swarm_notes" (swarm_notes) on companies
      note mode: takeover (the top-level mode): HubSpot holds it in the pull scope of companies, and config does not"
  `)

  writeConfig(dir, {}, { mode: 'takeover' })
  expect(await lines()).toMatchInlineSnapshot(`
    "Settings: mode takeover on companies, else addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    Takeover on companies: what config lacks in the pull scope is archived, and options only the portal holds are removed; blocked: allowDestroy is false on target sandbox
    s1 blocked Cannot plan property honey_grade on companies: option removals not allowed
      note mode: takeover (the top-level mode): only the portal holds the option "dark", and config does not
      takeover removes the option "dark", which only the portal holds, and target sandbox does not allow deletes
      fix: keep them in config: run kalup pull --target sandbox --only property:companies/honey_grade; or keep them unmanaged: set lifecycle: { options: 'additive' } on honey_grade; or remove them: set allowDestroy: true under targets.sandbox in kalup.config.ts
    s2 blocked Cannot plan property swarm_notes on companies: deletes not allowed
      note mode: takeover (the top-level mode): HubSpot holds it in the pull scope of companies, and config does not
      takeover archives swarm_notes, and target sandbox does not allow deletes
      fix: keep it in config: run kalup pull --target sandbox --only property:companies/swarm_notes; or leave it unmanaged: add 'swarm_notes' to objects.companies.exclude; or archive it: set allowDestroy: true under targets.sandbox in kalup.config.ts"
  `)

  // The fix's pull keeps swarm_notes in config, which clears its block.
  const pulled = await cli(dir, 'pull', '--target', 'sandbox', '--only', swarmNotes)
  expect(pulled.exitCode, pulled.stderr).toBe(0)
  expect((await planOf(dir)).steps.find((s) => s.address === swarmNotes)).toMatchObject({ action: 'adopt' })
})
