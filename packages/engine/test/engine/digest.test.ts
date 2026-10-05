import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { approvalContext, hasEffect, writesHash } from '../../src/engine/digest.js'
import { stableStringify } from '../../src/ir/serialize.js'
import type { Plan, PlanChange, PlanHeld, PlanStep } from '../../src/plan/types.js'
import { golden } from './plan-harness.js'

// The orchard golden: creates, converged adopts and one adopt that adds an option, with held and noted units. The limit
// golden adds blocked steps.
function orchard(): Plan {
  return structuredClone(golden('orchard'))
}

function step(plan: Plan, address: string): PlanStep {
  const found = plan.steps.find((s) => s.address === address)
  if (!found) {
    throw new Error(`no step for ${address}`)
  }
  return found
}

const create = 'property:companies/harvest_window'
const adopt = 'property:companies/yield_tier'
const converged = 'property:companies/plot_total'

test('the approval context holds the destination, policy, state, normalizer versions, bindings and the steps with an effect, and nothing else', () => {
  const plan = golden('limit')
  const context = approvalContext(plan)
  expect(Object.keys(context).sort()).toEqual([
    'bindings',
    'destination',
    'format',
    'normVersions',
    'policy',
    'state',
    'steps',
  ])
  expect(context).toMatchObject({
    format: 'plan/1',
    destination: { target: 'sandbox', portalId: 1_111_111 },
    policy: { protected: false, drift: 'hold', allowDestroy: false },
    state: { lineage: null, serial: null },
    normVersions: { property: 1, group: 1, object: 1 },
    bindings: plan.bindings,
  })
  // Blocked steps approve nothing.
  expect(context.steps.map((s) => s.address)).toEqual(
    plan.steps.filter((s) => s.risk !== 'blocked').map((s) => s.address),
  )
  const allowed = [
    'action',
    'address',
    'api',
    'baseUnits',
    'changes',
    'desired',
    'expect',
    'ignoreChanges',
    'labels',
    'stages',
    'transport',
  ]
  for (const s of context.steps) {
    expect(Object.keys(s).filter((key) => !allowed.includes(key))).toEqual([])
  }
  const written = context.steps.find((s) => s.address === adopt)
  expect(written?.changes).toEqual([{ unit: 'options[trial]', op: 'add', after: { value: 'trial', label: 'Trial' } }])
})

test('writesHash is sha256 of the context, and the golden plans carry their own', () => {
  for (const name of ['orchard', 'exact', 'limit', 'scope', 'override', 'archived', 'unsupported']) {
    const plan = golden(name)
    const digest = createHash('sha256')
      .update(stableStringify(approvalContext(plan)))
      .digest('hex')
    expect(writesHash(plan), name).toBe(`sha256:${digest}`)
    expect(plan.writesHash, name).toBe(writesHash(plan))
    expect(plan.planId, name).toBe(`pl_${plan.writesHash.slice(7, 19)}`)
  }
})

// The first change and the first held unit of the adopt that writes.
function change(plan: Plan): PlanChange {
  return (step(plan, adopt).changes ?? [])[0] as PlanChange
}

function held(plan: Plan): PlanHeld {
  return (step(plan, adopt).held ?? [])[0] as PlanHeld
}

// An update that only reports a held unit: no changes and no baseUnits, so no effect.
function reportOnly(plan: Plan): PlanStep {
  return {
    ...step(plan, converged),
    id: 's12',
    action: 'update',
    desired: undefined,
    // The adopt it copies records its agreed units; a report-only update records nothing.
    baseUnits: undefined,
    held: [{ unit: 'label', class: 'drift', config: 'Plot total', live: 'Plot sum' }],
  }
}

function release(): PlanStep {
  return {
    id: 's13',
    address: 'group:companies/retired',
    action: 'release',
    risk: 'safe',
    transport: 'public-api',
    title: 'Stop managing property group "Retired" (retired) on companies',
    expect: {},
  }
}

const binds: [string, (plan: Plan) => void][] = [
  [
    'the target name',
    (p) => {
      p.target.name = 'staging'
    },
  ],
  [
    'the portal ID',
    (p) => {
      p.target.portalId = 2_222_222
    },
  ],
  [
    'protected',
    (p) => {
      p.target.protected = true
    },
  ],
  [
    'drift',
    (p) => {
      p.target.drift = 'overwrite'
    },
  ],
  [
    'the state lineage',
    (p) => {
      p.stateLineage = 'b0a1c6e2'
    },
  ],
  [
    'a binding id',
    (p) => {
      p.bindings['object:harvest'] = { id: '2-9999999' }
    },
  ],
  [
    'a binding name',
    (p) => {
      p.bindings['group:companies/orchard'] = { name: 'orchard_info' }
    },
  ],
  [
    'an expected live value',
    (p) => {
      const { options } = step(p, adopt).expect.values as { options: { label: string }[] }
      options[0] = { ...options[0], label: 'Lower' }
    },
  ],
  [
    'that the resource exists',
    (p) => {
      step(p, create).expect = { exists: true }
    },
  ],
  [
    'a desired value',
    (p) => {
      step(p, create).desired = { ...step(p, create).desired, label: 'Harvest dates' }
    },
  ],
  [
    'an owned field that already matches, added to desired',
    (p) => {
      step(p, converged).desired = { ...step(p, converged).desired, description: '' }
    },
  ],
  [
    'an ignoreChanges entry',
    (p) => {
      step(p, create).ignoreChanges = ['description']
    },
  ],
  [
    'a change op',
    (p) => {
      change(p).op = 'remove'
    },
  ],
  [
    'a change after',
    (p) => {
      change(p).after = { value: 'trial', label: 'Tri' }
    },
  ],
  [
    'a create becoming an adopt',
    (p) => {
      step(p, create).action = 'adopt'
    },
  ],
  [
    'an adopt disappearing',
    (p) => {
      p.steps = p.steps.filter((s) => s.address !== converged)
    },
  ],
  [
    'an adopt appearing',
    (p) => {
      p.steps.push({ ...step(p, converged), id: 's12', address: 'property:companies/plot_count' })
    },
  ],
  [
    'the API version',
    (p) => {
      step(p, create).api = { family: 'crm.properties', version: '2027-03' }
    },
  ],
  [
    'the transport',
    (p) => {
      step(p, create).transport = 'public-beta'
    },
  ],
  [
    'allowDestroy',
    (p) => {
      p.target.allowDestroy = true
    },
  ],
  [
    'the state serial',
    (p) => {
      p.stateSerial = 0
    },
  ],
  [
    'a normalizer version',
    (p) => {
      p.normVersions = { ...p.normVersions, property: 2 }
    },
  ],
  [
    'a label',
    (p) => {
      step(p, adopt).labels = ['reverts-ui-edit']
    },
  ],
  [
    'baseUnits on an adopt',
    (p) => {
      step(p, converged).baseUnits = ['label']
    },
  ],
  [
    'a release step appearing',
    (p) => {
      p.steps.push(release())
    },
  ],
  [
    'an update gaining baseUnits',
    (p) => {
      p.steps.push({ ...reportOnly(p), baseUnits: ['fieldType'] })
    },
  ],
  [
    'an update gaining a set change',
    (p) => {
      p.steps.push({
        ...reportOnly(p),
        changes: [{ unit: 'label', class: 'config-change', op: 'set', before: 'Plot sum', after: 'Plot total' }],
      })
    },
  ],
  [
    'a change op of set',
    (p) => {
      change(p).op = 'set'
    },
  ],
]

test.each(binds)('writesHash changes with %s', (_, edit) => {
  const plan = orchard()
  edit(plan)
  expect(writesHash(plan)).not.toBe(golden('orchard').writesHash)
})

const free: [string, (plan: Plan) => void][] = [
  [
    'titles',
    (p) => {
      for (const s of p.steps) {
        s.title = `${s.title}!`
      }
    },
  ],
  [
    'risk',
    (p) => {
      step(p, adopt).risk = 'risky'
    },
  ],
  [
    'counts',
    (p) => {
      p.counts = { ...p.counts, safe: 99, held: 7 }
    },
  ],
  [
    'a held value',
    (p) => {
      held(p).live = 'Yield group'
    },
  ],
  [
    'held units dropped',
    (p) => {
      step(p, adopt).held = undefined
    },
  ],
  [
    'notes',
    (p) => {
      step(p, adopt).notes = undefined
    },
  ],
  [
    'stage labels',
    (p) => {
      step(p, adopt).stageLabels = { orchard_tasting: 'Tasting' }
    },
  ],
  [
    'provenance on a step',
    (p) => {
      const hash = `sha256:${'c'.repeat(64)}`
      step(p, create).provenance = {
        blueprint: 'acme/orchard',
        version: '1.0.0',
        sourceAddress: create,
        prefix: '',
        hash,
      }
      step(p, adopt).provenance = {
        blueprint: 'acme/orchard',
        version: '2.0.0',
        sourceAddress: adopt,
        prefix: 'acme_',
        hash,
      }
    },
  ],
  [
    'a change class and before',
    (p) => {
      change(p).class = 'config-change'
      change(p).before = 'x'
    },
  ],
  [
    'notCovered',
    (p) => {
      p.notCovered = []
    },
  ],
  [
    'coverage',
    (p) => {
      p.coverage = { complete: false, unreadable: [{ object: 'deals' }], unsupported: [], excluded: [] }
    },
  ],
  [
    'preflight',
    (p) => {
      p.preflight = { limits: [] }
    },
  ],
  [
    'the budget',
    (p) => {
      p.budget = { estimatedCalls: 1, dailyRemaining: 5 }
    },
  ],
  [
    'irHash',
    (p) => {
      p.irHash = `sha256:${'0'.repeat(64)}`
    },
  ],
  [
    'the generator version',
    (p) => {
      p.generator = { name: 'kalup', version: '9.9.9' }
    },
  ],
  [
    'accountType',
    (p) => {
      p.target.accountType = 'STANDARD'
    },
  ],
  [
    'uiDomain',
    (p) => {
      p.target.uiDomain = 'app.hubspot.com'
    },
  ],
  [
    'permanentNames',
    (p) => {
      p.permanentNames = 4
    },
  ],
  [
    'step ids',
    (p) => {
      for (const [i, s] of p.steps.entries()) {
        s.id = `s${i + 10}`
      }
    },
  ],
  [
    'planId and writesHash themselves',
    (p) => {
      p.planId = 'pl_000000000000'
      p.writesHash = `sha256:${'1'.repeat(64)}`
    },
  ],
  [
    'orphans',
    (p) => {
      p.orphans = [{ address: 'property:companies/plot_count', note: 'in state, not in config' }]
    },
  ],
  [
    'missing',
    (p) => {
      p.missing = [
        { address: 'property:companies/plot_count', origin: 'created', archived: true, resolve: ['restore it'] },
      ]
    },
  ],
  [
    'an update that only reports held units',
    (p) => {
      p.steps.push(reportOnly(p))
    },
  ],
  [
    'an update whose changes and baseUnits are empty lists',
    (p) => {
      p.steps.push({ ...reportOnly(p), changes: [], baseUnits: [] })
    },
  ],
  [
    'a blocked release',
    (p) => {
      p.steps.push({
        ...release(),
        risk: 'blocked',
        blocked: { reason: 'not-owned', detail: 'not owned in this target', blocks: [] },
      })
    },
  ],
]

test.each(free)('writesHash does not change with %s', (_, edit) => {
  const plan = orchard()
  edit(plan)
  expect(writesHash(plan)).toBe(golden('orchard').writesHash)
})

test('a blocked step changes nothing an approval binds to', () => {
  const plan = structuredClone(golden('limit'))
  const blocked = step(plan, 'object:crate')
  blocked.title = 'Cannot plan object crate: something else'
  blocked.expect = { exists: true }
  blocked.action = 'adopt'
  if (blocked.blocked) {
    blocked.blocked.detail = 'another detail'
  }
  expect(writesHash(plan)).toBe(golden('limit').writesHash)
})

test('hasEffect: a create, adopt, delete or release; an update with changes or baseUnits; never a blocked step', () => {
  const plan = orchard()
  const base = reportOnly(plan)
  expect(hasEffect(step(plan, create))).toBe(true)
  expect(hasEffect(step(plan, converged))).toBe(true)
  expect(hasEffect(release())).toBe(true)
  expect(hasEffect({ ...base, action: 'delete', risk: 'destructive' })).toBe(true)
  expect(hasEffect(base)).toBe(false)
  expect(hasEffect({ ...base, changes: [], baseUnits: [] })).toBe(false)
  expect(hasEffect({ ...base, baseUnits: ['label'] })).toBe(true)
  expect(hasEffect({ ...base, changes: [change(plan)] })).toBe(true)
  expect(hasEffect({ ...base, action: 'manual', risk: 'manual' })).toBe(false)
  const blocked = { reason: 'policy' as const, detail: 'allowDestroy is false', blocks: [] }
  expect(hasEffect({ ...base, action: 'delete', risk: 'blocked', blocked })).toBe(false)
  expect(hasEffect({ ...step(plan, create), risk: 'blocked', blocked })).toBe(false)
})
