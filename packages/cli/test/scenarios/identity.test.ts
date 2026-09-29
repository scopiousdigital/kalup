// Scenario: a resource whose ID HubSpot assigns, bound to another ID on each target. plan/1 and kalup.state/1 carry
// it with no adapter in the product: state binds each portal's ID, the plan's bindings carry the difference while the
// steps keep the logical $ref, and the binding is part of the digest. The `list` type and the property's `sourceList`
// field exist only in this file; nothing here is a Kalup feature. docs/hubspot.md cites this file.
import {
  approvalContext,
  type Plan,
  type PlanStep,
  parsePlan,
  stableStringify,
  type TargetState,
  validatePlan,
  validateState,
  writesHash,
} from '@kalup/engine'
import { expect, test } from 'vitest'

/** A bound resource: HubSpot assigns its numeric ID on create, and its name stays editable in the UI. */
const list = 'list:renewals_due'
const group = 'group:companies/renewals'
const property = 'property:companies/renewal_queue'
/** The version apply runs as: the one that made the plans, so they are on its release line. */
const running = '0.0.0-identity'
const LIST_IDS = /4412|9981/

/** Two client portals of one project. Each assigned the list its own ID when the list was created there. */
const north = { name: 'north', portalId: 5_550_001, lineage: '0a1b2c3d4e5f6071', listId: '4412' }
const south = { name: 'south', portalId: 5_550_002, lineage: '8192a3b4c5d6e7f8', listId: '9981' }
type Portal = typeof north

/** The property's definition in logical form: the list by address, never by ID. */
const queue = {
  label: 'Renewal queue',
  group: { $ref: group },
  type: 'string',
  fieldType: 'text',
  sourceList: { $ref: list },
}

/** A portal's state once the group and the list exist there: the list's entry holds the ID that portal assigned. */
function stateOf(portal: Portal, extra: TargetState['resources'] = {}): TargetState {
  return {
    format: 'kalup.state/1',
    lineage: portal.lineage,
    serial: 7,
    portalId: portal.portalId,
    resources: {
      [group]: { origin: 'created', id: 'renewals', normVersion: 1, base: { label: 'Renewals' } },
      [list]: { origin: 'created', id: portal.listId, normVersion: 1, base: { name: 'Renewals due' } },
      ...extra,
    },
  }
}

const createQueue: PlanStep = {
  id: 's1',
  address: property,
  action: 'create',
  risk: 'safe',
  transport: 'public-api',
  api: { family: 'crm.properties', version: '2026-09' },
  title: 'Create property "Renewal queue" (renewal_queue) on companies',
  desired: queue,
  expect: { exists: false },
}

/** A plan as kalup plan would save it, its writesHash and planId computed by the digest apply recomputes. */
function planFor(
  portal: Portal,
  bindings: Plan['bindings'],
  steps: PlanStep[] = [createQueue],
  state: { lineage: string | null; serial: number | null } = { lineage: portal.lineage, serial: 7 },
): Plan {
  const draft: Plan = {
    format: 'plan/1',
    planId: 'pl_000000000000',
    generator: { name: 'kalup', version: '0.0.0-identity' },
    target: {
      name: portal.name,
      portalId: portal.portalId,
      accountType: 'STANDARD',
      uiDomain: 'app.hubspot.com',
      protected: true,
      drift: 'hold',
      allowDestroy: false,
    },
    stateLineage: state.lineage,
    stateSerial: state.serial,
    normVersions: { group: 1, object: 1, property: 1 },
    bindings,
    irHash: `sha256:${'0'.repeat(64)}`,
    counts: { ...countsOf(steps), held: 0 },
    permanentNames: steps.filter((s) => s.action === 'create').length,
    budget: { estimatedCalls: 11, dailyRemaining: 250_000 },
    writesHash: `sha256:${'0'.repeat(64)}`,
    preflight: { limits: [] },
    coverage: { complete: true, unreadable: [], unsupported: [], excluded: [] },
    notCovered: [],
    orphans: [],
    missing: [],
    steps,
  }
  const hash = writesHash(draft)
  return { ...draft, writesHash: hash, planId: `pl_${hash.slice('sha256:'.length, 'sha256:'.length + 12)}` }
}

// Each step counted under its stated risk, as kalup plan counts them.
function countsOf(steps: PlanStep[]): Record<PlanStep['risk'], number> {
  const counts = { safe: 0, risky: 0, destructive: 0, blocked: 0, manual: 0 }
  for (const step of steps) {
    counts[step.risk] += 1
  }
  return counts
}

const northPlan = planFor(north, { [list]: { id: north.listId } })
const southPlan = planFor(south, { [list]: { id: south.listId } })

test('state binds the list to the ID each portal assigned, and both files are kalup.state/1', () => {
  const [a, b] = [stateOf(north), stateOf(south)]
  expect(validateState(a)).toEqual([])
  expect(validateState(b)).toEqual([])
  expect(a.resources[list]?.id).toBe('4412')
  expect(b.resources[list]?.id).toBe('9981')
  // The name is a unit of the base, like any other: HubSpot lets a person rename the list without changing its ID.
  expect({ ...a.resources[list], id: '' }).toEqual({ ...b.resources[list], id: '' })
})

test("each target's plan binds the list to that portal's ID, and the property's desired keeps the logical $ref", () => {
  for (const plan of [northPlan, southPlan]) {
    expect(validatePlan(plan)).toEqual([])
    expect(plan.steps[0]?.desired?.sourceList).toEqual({ $ref: list })
    // Apply's own offline check of a saved file: schema, step numbering and the recomputed digest.
    expect(parsePlan(stableStringify(plan), `${plan.target.name}.json`, running)).toEqual(plan)
  }
  expect(northPlan.bindings).toEqual({ [list]: { id: '4412' } })
  expect(southPlan.bindings).toEqual({ [list]: { id: '9981' } })
  // The steps are the same bytes on both targets and hold no portal ID: the binding carries the difference.
  expect(stableStringify(northPlan.steps)).toBe(stableStringify(southPlan.steps))
  expect(stableStringify(northPlan.steps)).not.toMatch(LIST_IDS)
})

test('the two plans digest differently, and with one destination and state they differ only through the binding', () => {
  expect(northPlan.writesHash).not.toBe(southPlan.writesHash)
  const a = approvalContext(northPlan)
  const b = approvalContext(southPlan)
  expect(stableStringify(a.steps)).toBe(stableStringify(b.steps))
  const differing = Object.keys(a).filter(
    (key) => stableStringify(a[key as keyof typeof a]) !== stableStringify(b[key as keyof typeof b]),
  )
  expect(differing.sort()).toEqual(['bindings', 'destination', 'state'])
  // South's plan moved to north's destination and state: the binding alone keeps the digests apart.
  const moved = { ...southPlan, target: northPlan.target, stateLineage: north.lineage }
  expect(writesHash(moved)).not.toBe(northPlan.writesHash)
  expect(writesHash({ ...moved, bindings: northPlan.bindings })).toBe(northPlan.writesHash)
})

test('a rebind changes the digest, so an approved plan cannot be pointed at another list or portal', () => {
  const approved = northPlan.writesHash
  const retargets: Plan[] = [
    // North's plan with south's list ID.
    { ...northPlan, bindings: { [list]: { id: south.listId } } },
    // The list recreated in north under a new ID, bound again.
    { ...northPlan, bindings: { [list]: { id: '5127' } } },
    // The binding dropped: the list would resolve some other way at apply.
    { ...northPlan, bindings: {} },
    // North's plan sent to south's portal with south's binding.
    { ...northPlan, target: southPlan.target, bindings: southPlan.bindings },
  ]
  for (const edited of retargets) {
    expect(validatePlan(edited)).toEqual([])
    // Recomputed, the digest is another one, so neither --approve nor the terminal confirmation of north's plan covers it.
    expect(writesHash(edited)).not.toBe(approved)
    // Left as it was, the file no longer matches its own digest.
    expect(() => parsePlan(stableStringify(edited), 'north.json', running)).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: 'E_PLAN_DIGEST' })] }),
    )
  }
})

test('a planned create keeps the logical identity in bindings until apply records the returned ID in state', () => {
  // A bound type with no binding and no live name match plans a risky create, since the list
  // may exist under another name. Risk is outside the approval digest, so apply's own derivation must rate it risky too.
  const createList: PlanStep = {
    id: 's1',
    address: list,
    action: 'create',
    risk: 'risky',
    transport: 'public-api',
    api: { family: 'crm.lists', version: '2026-09' },
    title: 'Create list "Renewals due"',
    desired: { name: 'Renewals due' },
    notes: [{ unit: 'name', live: null, note: 'if it was renamed in HubSpot, run kalup bind' }],
    expect: { exists: false },
  }
  // South before its first apply, with no state: the list and the property that refers to it are created in one run.
  const first = planFor(south, {}, [createList, { ...createQueue, id: 's2' }], { lineage: null, serial: null })
  expect(validatePlan(first)).toEqual([])
  expect(first.counts).toMatchObject({ safe: 1, risky: 1 })
  expect(first.bindings).toEqual({})
  expect(first.steps[1]?.desired?.sourceList).toEqual({ $ref: list })

  // What apply would save: the ID HubSpot returned for the list, and the property's base in logical form.
  const after = stateOf(south, {
    [property]: { origin: 'created', id: 'renewal_queue', normVersion: 1, base: { ...queue } },
  })
  expect(validateState(after)).toEqual([])
  expect(after.resources[list]?.id).toBe('9981')
  expect(after.resources[property]?.base?.sourceList).toEqual({ $ref: list })

  // The next plan resolves the list through state: the recorded ID is bound, and binds the approval.
  const relabel: PlanStep = {
    id: 's1',
    address: property,
    action: 'update',
    risk: 'safe',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'Update property "Renewal queue" (renewal_queue) on companies, set label',
    desired: { ...queue, label: 'Renewals queue' },
    changes: [{ unit: 'label', class: 'config-change', op: 'set', before: 'Renewal queue', after: 'Renewals queue' }],
    expect: { exists: true, values: { label: 'Renewal queue', type: 'string', fieldType: 'text' } },
  }
  const next = planFor(south, { [list]: { id: '9981' } }, [relabel])
  expect(validatePlan(next)).toEqual([])
  expect(parsePlan(stableStringify(next), 'south.json', running)).toEqual(next)
  expect(writesHash({ ...next, bindings: {} })).not.toBe(next.writesHash)
})
