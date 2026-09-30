// Scenario: adoption of an existing portal. The portal already holds what config names, some of it with other values.
// The first plan adopts every managed resource; nothing is owned until the reviewed apply; after it the entries are
// adopted, with a base only for the units both sides agree on. A destroy tombstone on a resource state has no entry
// for is blocked not-owned, and no DELETE is ever sent.
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import {
  APIARY,
  apiary,
  apply,
  companies,
  effects,
  environment,
  HIVE_COUNT,
  HONEY_GRADE,
  hiveCount,
  honeyGrade,
  live,
  liveProperty,
  planOf,
  portal,
  project,
  savePlan,
  stateBytes,
  stateOf,
  statePath,
  terminal,
  tombstones,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const swarmNotes = 'property:companies/swarm_notes'

/** The portal as a beekeeper set it up by hand, before Kalup: two labels differ from config, and one extra property. */
function existing() {
  return portal({
    objects: {
      companies: {
        groups: [
          { name: 'companyinformation', label: 'Company information' },
          { name: 'apiary', label: 'Apiary' },
        ],
        properties: [
          liveProperty({ name: 'hive_count', label: 'Hives', type: 'number', fieldType: 'number' }),
          liveProperty({
            name: 'honey_grade',
            label: 'Honey grade',
            type: 'enumeration',
            fieldType: 'select',
            options: [
              { value: 'light', label: 'Light', displayOrder: 0, hidden: false },
              { value: 'amber', label: 'Amber honey', displayOrder: 1, hidden: false },
            ],
          }),
          liveProperty({ name: 'swarm_notes', label: 'Swarm notes', type: 'string', fieldType: 'textarea' }),
        ],
      },
    },
  })
}

test('adoption of an existing portal: every managed resource adopted, owned only after the reviewed apply, with partial bases', async () => {
  const sim = existing()
  const dir = project({ groups: APIARY, properties: `${HIVE_COUNT}${HONEY_GRADE}`, target: { allowDestroy: true } })
  tombstones(dir, { [swarmNotes]: 'destroy' })

  const plan = await savePlan(dir)
  expect(plan.stateLineage).toBeNull()
  expect(effects(plan).map((s) => [s.address, s.action, s.risk])).toEqual([
    [apiary, 'adopt', 'safe'],
    [hiveCount, 'adopt', 'safe'],
    [honeyGrade, 'adopt', 'safe'],
  ])
  // Units that differ are held as diverged, never written by an adoption.
  const held = plan.steps.flatMap((s) => (s.held ?? []).map((h) => [s.address, h.unit, h.class]))
  expect(held).toEqual([
    [hiveCount, 'label', 'diverged'],
    [honeyGrade, 'options[amber].label', 'diverged'],
  ])
  expect(plan.steps.flatMap((s) => s.changes ?? [])).toEqual([])
  // The tombstone on a resource no state entry owns is blocked, not a delete.
  expect(plan.steps.find((s) => s.address === swarmNotes)).toMatchObject({
    action: 'delete',
    risk: 'blocked',
    blocked: { reason: 'not-owned' },
  })

  // Nothing is owned before the reviewed apply: planning wrote no state, and an unapproved apply stops at exit 4.
  expect(existsSync(statePath(dir))).toBe(false)
  const unapproved = await apply(dir, 'plan.json', '--json')
  expect(unapproved.exitCode).toBe(4)
  expect(unapproved.codes).toEqual(['E_APPROVAL_REQUIRED'])
  expect(existsSync(statePath(dir))).toBe(false)

  // The reviewed apply: a person at a terminal types the target name.
  const reviewed = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(reviewed.exitCode, reviewed.stderr).toBe(0)
  expect(normalise(reviewed.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 safe Adopt property group "Apiary" (apiary) on companies
      s2 safe Adopt property "Hive count" (hive_count) on companies
      s3 safe Adopt property "Honey grade" (honey_grade) on companies
    3 adoptions, 0 destructive
    Type the target name to apply: "
  `)
  expect(sim.writes()).toEqual([])

  const state = stateOf(dir)
  expect(Object.keys(state.resources).sort()).toEqual([apiary, hiveCount, honeyGrade])
  expect(state.resources[apiary]).toEqual({
    origin: 'adopted',
    id: 'apiary',
    normVersion: 1,
    base: { label: 'Apiary' },
  })
  // Partial bases: hive_count has no label, honey_grade's amber option has no label.
  expect(state.resources[hiveCount]).toEqual({
    origin: 'adopted',
    id: 'hive_count',
    normVersion: 1,
    base: {
      description: '',
      formField: false,
      hasUniqueValue: false,
      group: { $ref: apiary },
      type: 'number',
      fieldType: 'number',
    },
  })
  const honey = state.resources[honeyGrade]
  expect(honey).toMatchObject({ origin: 'adopted', id: 'honey_grade', normVersion: 1 })
  expect(honey?.base).toMatchObject({ label: 'Honey grade', type: 'enumeration', fieldType: 'select' })
  expect(honey?.base?.options).toMatchObject({ light: { label: 'Light' } })
  expect(honey?.base?.options).toHaveProperty('amber')
  expect(honey?.base?.options).not.toHaveProperty('amber.label')
  expect(state.resources[swarmNotes]).toBeUndefined()

  // Adopted: no step adopts again, the differences stay held, and the tombstone stays blocked. No DELETE was ever sent.
  const again = await planOf(dir)
  expect(again.steps.filter((s) => s.action === 'adopt')).toEqual([])
  expect(effects(again)).toEqual([])
  expect(again.steps.flatMap((s) => (s.held ?? []).map((h) => [s.address, h.unit, h.class]))).toEqual([
    [hiveCount, 'label', 'diverged'],
    [honeyGrade, 'options[amber].label', 'diverged'],
  ])
  expect(again.steps.find((s) => s.address === swarmNotes)).toMatchObject({ blocked: { reason: 'not-owned' } })
  const bytes = stateBytes(dir)
  const nothing = await apply(terminal(dir, 'sandbox'), '--target', 'sandbox')
  expect(nothing.exitCode, nothing.stderr).toBe(0)
  expect(stateBytes(dir)).toBe(bytes)
  expect(sim.log.filter((r) => r.method === 'DELETE')).toEqual([])
  expect(live(sim, 'swarm_notes').archived).toBe(false)
})

test('adoption of an existing portal: an adoption that adds an option counts its PATCH among the writes at the terminal', async () => {
  const sim = existing()
  const withDark = HONEY_GRADE.replace(
    "{ value: 'amber', label: 'Amber' },",
    "{ value: 'amber', label: 'Amber' },\n        { value: 'dark', label: 'Dark' },",
  )
  const dir = project({ groups: APIARY, properties: withDark })
  const plan = await savePlan(dir)
  expect(effects(plan).map((s) => [s.address, s.action, (s.changes ?? []).map((c) => c.unit)])).toEqual([
    [apiary, 'adopt', []],
    [honeyGrade, 'adopt', ['options[dark]']],
  ])

  const reviewed = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(reviewed.exitCode, reviewed.stderr).toBe(0)
  expect(normalise(reviewed.stderr)).toMatchInlineSnapshot(`
    "Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 safe Adopt property group "Apiary" (apiary) on companies
      s2 safe Adopt property "Honey grade" (honey_grade) on companies, add option "Dark"
    1 write, 2 adoptions, 0 destructive
    Type the target name to apply: "
  `)
  expect(sim.writes().map((w) => `${w.method} ${w.path}`)).toEqual([`PATCH ${companies}/honey_grade`])
  expect(live(sim, 'honey_grade').options.map((o) => o.value)).toEqual(['light', 'amber', 'dark'])
  expect(stateOf(dir).resources[honeyGrade]).toMatchObject({ origin: 'adopted', id: 'honey_grade' })
  // Adoption never writes a label that differs: the next plan has nothing to do and holds it as diverged.
  const next = await planOf(dir)
  expect(effects(next)).toEqual([])
  expect(next.steps.flatMap((s) => s.held ?? []).map((h) => [h.unit, h.class])).toEqual([
    ['options[amber].label', 'diverged'],
  ])
})
