import { expect, test } from 'vitest'
import type { Plan } from '../../src/plan/types.js'
import { validatePlan } from '../../src/plan/validate.js'
import { fixture } from '../ir/fixture.js'

// Untyped: test documents are broken on purpose, one field at a time.
type Doc = Record<string, any>

function broken(change: (plan: Doc) => void): Doc {
  const plan = fixture<Doc>('plan-example.json')
  change(plan)
  return plan
}

/** Removes `field` from `parent[key]`. */
function drop(parent: Doc, key: string, field: string): void {
  const { [field]: _dropped, ...rest } = parent[key]
  parent[key] = rest
}

test('a stateless plan conforms to plan-1.schema.json', () => {
  expect(validatePlan(fixture<Plan>('plan-example.json'))).toEqual([])
})

// Adapted: full-length hashes, a drift policy, empty bindings, coverage and preflight, the api family on API steps,
// the resolve command on the held unit, a fulfilment on the manual step and the provenance section 3 gives
// billing_status. State adds normalizer versions, allowDestroy, an orphan, a missing resource, an update
// with a set change, labels and base units, a release with no api, and a delete of an adopted resource.
test('the architecture plan example, adapted, conforms: update, manual, release, delete, state and policy', () => {
  expect(validatePlan(fixture<Plan>('plan-architecture.json'))).toEqual([])
})

const cases: [string, (plan: Doc) => void, string, RegExp][] = [
  [
    'a field the schema does not name',
    (plan) => {
      plan.token = 'kalup-test-secret-9f2c'
    },
    'token',
    /unexpected field "token"/,
  ],
  [
    'a planId that is not pl_ and 12 hex characters',
    (plan) => {
      plan.planId = 'pl_7f3a'
    },
    'planId',
    /does not match/,
  ],
  [
    'a writesHash that is not a full sha256',
    (plan) => {
      plan.writesHash = 'sha256:3f9a1c07b2e40b7e'
    },
    'writesHash',
    /does not match/,
  ],
  [
    'a target without its drift policy',
    (plan) => drop(plan, 'target', 'drift'),
    'target.drift',
    /missing required field "drift"/,
  ],
  [
    'a stateLineage that is neither a string nor null',
    (plan) => {
      plan.stateLineage = 0
    },
    'stateLineage',
    /expected string or null, got number/,
  ],
  [
    'a binding with a field other than name and id',
    (plan) => {
      plan.bindings['object:shipment'].objectTypeId = '2-7001'
    },
    'bindings.object:shipment.objectTypeId',
    /unexpected field "objectTypeId"/,
  ],
  [
    'a read limit without its usage',
    (plan) => drop(plan.preflight.limits, '0', 'usage'),
    'preflight.limits[0].usage',
    /missing required field "usage"/,
  ],
  [
    'an unreadable limit without its issue',
    (plan) => drop(plan.preflight.limits, '1', 'issue'),
    'preflight.limits[1].issue',
    /missing required field "issue"/,
  ],
  [
    'a step id that does not count from s1',
    (plan) => {
      plan.steps[0].id = 's0'
    },
    'steps[0].id',
    /does not match/,
  ],
  [
    'an action outside the vocabulary',
    (plan) => {
      plan.steps[0].action = 'replace'
    },
    'steps[0].action',
    /expected one of "create", "adopt", "update", "delete", "release", "manual", "unknown"/,
  ],
  [
    'an unknown action that is not blocked',
    (plan) => {
      plan.steps[0].action = 'unknown'
      plan.steps[0].expect = {}
    },
    'steps[0].risk',
    /expected "blocked"/,
  ],
  [
    'a blocked risk without the blocked body',
    (plan) => drop(plan.steps, '1', 'blocked'),
    'steps[1].blocked',
    /missing required field "blocked"/,
  ],
  [
    'a blocked body on a step that is not blocked',
    (plan) => {
      plan.steps[0].blocked = { reason: 'scope', detail: 'x', blocks: [] }
    },
    'steps[0].risk',
    /expected "blocked"/,
  ],
  [
    'the tier blocked reason, which limit replaced',
    (plan) => {
      plan.steps[1].blocked.reason = 'tier'
    },
    'steps[1].blocked.reason',
    /expected one of "limit", "scope"/,
  ],
  [
    'a create that expects the resource to exist',
    (plan) => {
      plan.steps[4].expect.exists = true
    },
    'steps[4].expect.exists',
    /expected false/,
  ],
  [
    'a step without expect',
    (plan) => drop(plan.steps, '0', 'expect'),
    'steps[0].expect',
    /missing required field "expect"/,
  ],
  [
    'an adopt whose expect leaves out exists',
    (plan) => {
      plan.steps[0].expect = {}
    },
    'steps[0].expect.exists',
    /missing required field "exists"/,
  ],
  [
    'a step without its API family',
    (plan) => drop(plan.steps, '4', 'api'),
    'steps[4].api',
    /missing required field "api"/,
  ],
  [
    'a manual step without the manual body',
    (plan) => {
      plan.steps[0].action = 'manual'
    },
    'steps[0].manual',
    /missing required field "manual"/,
  ],
  [
    'a change op outside set, add and remove',
    (plan) => {
      plan.steps[5].changes[0].op = 'replace'
    },
    'steps[5].changes[0].op',
    /expected one of "set", "add", "remove"/,
  ],
  [
    'a change without its before value',
    (plan) => drop(plan.steps[5].changes, '1', 'before'),
    'steps[5].changes[1].before',
    /missing required field "before"/,
  ],
  [
    'a held class outside drift, conflict and diverged',
    (plan) => {
      plan.steps[5].held[0].class = 'converged'
    },
    'steps[5].held[0].class',
    /expected one of "drift", "conflict", "diverged"/,
  ],
  [
    'a held resolve without its pull command',
    (plan) => drop(plan.steps[5].held[0], 'resolve', 'portal'),
    'steps[5].held[0].resolve.portal',
    /missing required field "portal"/,
  ],
  [
    'an unreadable object without its name',
    (plan) => drop(plan.coverage.unreadable, '0', 'object'),
    'coverage.unreadable[0].object',
    /missing required field "object"/,
  ],
  [
    'a plan without its state serial',
    (plan) => Reflect.deleteProperty(plan, 'stateSerial'),
    'stateSerial',
    /missing required field "stateSerial"/,
  ],
  [
    'a negative state serial',
    (plan) => {
      plan.stateSerial = -1
    },
    'stateSerial',
    /expected at least 0/,
  ],
  [
    'normalizer versions without one resource type',
    (plan) => drop(plan, 'normVersions', 'group'),
    'normVersions.group',
    /missing required field "group"/,
  ],
  [
    'a normalizer version keyed by something other than a type name',
    (plan) => {
      plan.normVersions['Custom Type'] = 1
    },
    'normVersions.Custom Type',
    /unexpected field "Custom Type"/,
  ],
  [
    'a normalizer version for another type that is not a positive integer',
    (plan) => {
      plan.normVersions.list = 0
    },
    'normVersions.list',
    /expected at least 1/,
  ],
  [
    'a target without allowDestroy',
    (plan) => drop(plan, 'target', 'allowDestroy'),
    'target.allowDestroy',
    /missing required field "allowDestroy"/,
  ],
  [
    'a plan without orphans',
    (plan) => Reflect.deleteProperty(plan, 'orphans'),
    'orphans',
    /missing required field "orphans"/,
  ],
  [
    'an orphan without its note',
    (plan) => {
      plan.orphans = [{ address: 'property:companies/legacy_rank' }]
    },
    'orphans[0].note',
    /missing required field "note"/,
  ],
  [
    'a plan without missing',
    (plan) => Reflect.deleteProperty(plan, 'missing'),
    'missing',
    /missing required field "missing"/,
  ],
  [
    'a missing resource whose origin is a reference',
    (plan) => {
      plan.missing = [{ address: 'group:companies/logistics', origin: 'reference', archived: null, resolve: [] }]
    },
    'missing[0].origin',
    /expected one of "created", "adopted"/,
  ],
  [
    'a missing resource without its archived status',
    (plan) => {
      plan.missing = [{ address: 'group:companies/logistics', origin: 'created', resolve: [] }]
    },
    'missing[0].archived',
    /missing required field "archived"/,
  ],
  [
    'a delete that is not destructive',
    (plan) => {
      plan.steps[0].action = 'delete'
    },
    'steps[0].risk',
    /expected one of "destructive", "blocked"/,
  ],
  [
    'a delete without its api',
    (plan) => {
      plan.steps[0].action = 'delete'
      plan.steps[0].risk = 'destructive'
      drop(plan.steps, '0', 'api')
    },
    'steps[0].api',
    /missing required field "api"/,
  ],
  [
    'a release with an api',
    (plan) => {
      plan.steps[0] = { ...plan.steps[0], action: 'release', expect: {} }
      drop(plan.steps, '0', 'desired')
    },
    'steps[0].api',
    /unexpected field "api"/,
  ],
  [
    'a release with values to write',
    (plan) => {
      plan.steps[0] = { ...plan.steps[0], action: 'release', expect: {} }
      drop(plan.steps, '0', 'api')
    },
    'steps[0].desired',
    /unexpected field "desired"/,
  ],
  [
    'a label outside the vocabulary',
    (plan) => {
      plan.steps[0].labels = ['reverts-ui-edits']
    },
    'steps[0].labels[0]',
    /expected one of "reverts-ui-edit", "overwrites-portal", "takeover", "existed-before-kalup"/,
  ],
  [
    'a label listed twice',
    (plan) => {
      plan.steps[0].labels = ['reverts-ui-edit', 'reverts-ui-edit']
    },
    'steps[0].labels',
    /expected unique items/,
  ],
  [
    'a base unit listed twice',
    (plan) => {
      plan.steps[0].baseUnits = ['label', 'options.order', 'label']
    },
    'steps[0].baseUnits',
    /expected unique items/,
  ],
  [
    'a base unit that is not a unit name',
    (plan) => {
      plan.steps[0].baseUnits = [{ unit: 'label' }]
    },
    'steps[0].baseUnits[0]',
    /expected string, got object/,
  ],
  [
    'a blocked reason outside the vocabulary',
    (plan) => {
      plan.steps[1].blocked.reason = 'not-allowed'
    },
    'steps[1].blocked.reason',
    /"unsupported", "not-owned", "policy"/,
  ],
]

for (const [name, change, configPath, message] of cases) {
  test(`rejects ${name}`, () => {
    const issues = validatePlan(broken(change))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'E_PLAN_SCHEMA', configPath })
    expect(issues[0]?.message).toMatch(message)
  })
}

test('a held unit without resolve conforms: no pull takes a portal side that names a shadowed name', () => {
  const plan = fixture<Doc>('plan-example.json')
  const step = plan.steps.find((s: Doc) => s.held !== undefined)
  drop(step.held, '0', 'resolve')
  expect(validatePlan(plan)).toEqual([])
})

test('a release needs no api and may expect nothing; a set change and both new blocked reasons conform', () => {
  const plan = fixture<Doc>('plan-example.json')
  plan.steps[0] = { ...plan.steps[0], action: 'release', expect: {} }
  drop(plan.steps, '0', 'api')
  drop(plan.steps, '0', 'desired')
  plan.steps[5].changes[0].op = 'set'
  plan.steps[1].blocked.reason = 'not-owned'
  plan.steps[3].blocked.reason = 'policy'
  expect(validatePlan(plan)).toEqual([])
})

test('a delete blocked by policy or ownership conforms', () => {
  for (const reason of ['policy', 'not-owned']) {
    const plan = fixture<Doc>('plan-architecture.json')
    const step = plan.steps.find((s: Doc) => s.action === 'delete')
    step.risk = 'blocked'
    step.blocked = { reason, detail: 'the target does not set allowDestroy: true', blocks: [] }
    expect(validatePlan(plan)).toEqual([])
  }
})

test('normalizer versions may name another resource type: the map keeps the three current types and takes more', () => {
  const plan = broken((doc) => {
    doc.normVersions.list = 1
  })
  expect(validatePlan(plan)).toEqual([])
})

test('a human-confirm check needs its prompt', () => {
  const plan = fixture<Doc>('plan-architecture.json')
  drop(plan.steps[2].manual, 'verify', 'prompt')
  expect(validatePlan(plan)).toEqual([
    { code: 'E_PLAN_SCHEMA', message: 'missing required field "prompt"', configPath: 'steps[2].manual.verify.prompt' },
  ])
})

test('a document that is not an object is one issue with no path', () => {
  expect(validatePlan([])).toEqual([{ code: 'E_PLAN_SCHEMA', message: 'expected object, got array' }])
})
