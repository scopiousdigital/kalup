// The one approval contract, row by row: a person at a terminal, --yes, --approve, and the refusals.
import type { PlanStep, Risk } from '@kalup/core'
import { expect, test } from 'vitest'
import { type ApprovalRequest, decideApproval, YES_LIMIT } from '../../src/engine/approval.js'

const hash = `sha256:${'a'.repeat(64)}`
/** The fix of a refusal only a person can clear: the command they run at a terminal. */
const person = expect.stringContaining('run kalup apply plan.json in a terminal')

function step(id: string, action: PlanStep['action'], risk: Risk = 'safe', changes = action !== 'update'): PlanStep {
  return {
    id,
    address: `property:companies/p_${id}`,
    action,
    risk,
    transport: 'public-api',
    title: id,
    expect: { exists: action !== 'create' },
    ...(action === 'update' && changes
      ? { changes: [{ unit: 'label', class: 'config-change', op: 'set', before: 'A', after: 'B' }] }
      : {}),
    ...(action === 'update' && !changes ? { baseUnits: ['label'] } : {}),
  } as PlanStep
}

function request(steps: PlanStep[], extra: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    command: 'kalup apply plan.json',
    credential: { envOnly: false, separate: false },
    derived: Object.fromEntries(steps.map((s) => [s.id, s.risk])),
    interactive: false,
    plan: { steps, writesHash: hash },
    policy: { protected: false },
    target: 'sandbox',
    yes: false,
    ...extra,
  }
}

const deletes = [step('s1', 'create'), step('s2', 'delete', 'destructive')]

test.each([
  ['--yes', { yes: true }, '--yes never covers a delete'],
  ['--approve', { approve: hash, credential: { envOnly: true, separate: true } }, '--approve never covers a delete'],
  ['no terminal', {}, 'there is none here'],
])('a delete needs a person at a terminal: %s is refused, exit 4', (_name, extra, text) => {
  const decided = decideApproval(request(deletes, extra))
  expect(decided).toMatchObject({ refuse: { code: 'E_APPROVAL_REQUIRED', humanRequired: true } })
  const { refuse } = decided as { refuse: { fix: string; message: string } }
  expect(refuse.message).toContain('Deleting needs a person at a terminal')
  expect(refuse.message).toContain(text)
  expect(refuse.fix).toContain('the number of destructive steps')
})

test('a delete at a terminal is the terminal mode', () => {
  expect(decideApproval(request(deletes, { interactive: true }))).toEqual({ mode: 'terminal' })
})

test('--approve with another digest is E_APPROVE_MISMATCH, exit 1, and names no flag in the fix', () => {
  const decided = decideApproval(
    request([step('s1', 'create')], {
      approve: `sha256:${'b'.repeat(64)}`,
      credential: { envOnly: true, separate: true },
    }),
  )
  expect(decided).toMatchObject({ refuse: { code: 'E_APPROVE_MISMATCH' } })
  expect((decided as { refuse: { humanRequired?: boolean } }).refuse.humanRequired).toBeUndefined()
})

test.each([[{ envOnly: false, separate: true }], [{ envOnly: true, separate: false }]])(
  '--approve with a write key not held apart is E_APPROVE_CREDENTIAL: %j',
  (credential) => {
    const decided = decideApproval(request([step('s1', 'create')], { approve: hash, credential }))
    expect(decided).toMatchObject({ refuse: { code: 'E_APPROVE_CREDENTIAL', humanRequired: true } })
  },
)

test('--approve with the digest and a separate environment key covers a protected target and a risky step', () => {
  const steps = [step('s1', 'update', 'risky')]
  const decided = decideApproval(
    request(steps, { approve: hash, credential: { envOnly: true, separate: true }, policy: { protected: true } }),
  )
  expect(decided).toEqual({ mode: 'approve' })
})

test('--yes covers an unprotected target with nothing risky, at a terminal or without one', () => {
  const steps = [step('s1', 'create'), step('s2', 'update'), step('s3', 'release')]
  expect(decideApproval(request(steps, { yes: true }))).toEqual({ mode: 'yes' })
  expect(decideApproval(request(steps, { yes: true, interactive: true }))).toEqual({ mode: 'yes' })
})

test('--yes on a protected target is refused, exit 4, naming why', () => {
  const decided = decideApproval(request([step('s1', 'create')], { yes: true, policy: { protected: true } }))
  expect(decided).toMatchObject({ refuse: { code: 'E_APPROVAL_REQUIRED', humanRequired: true, fix: person } })
  expect((decided as { refuse: { message: string } }).refuse.message).toContain('target sandbox is protected')
})

test('--yes with a step derived risky is refused, even when the plan states it safe', () => {
  const steps = [step('s1', 'update'), step('s2', 'update', 'risky')]
  const stated = decideApproval(request(steps, { yes: true }))
  expect((stated as { refuse: { message: string } }).refuse.message).toContain('s2 (risky) is not safe')
  const derived = decideApproval(request([step('s1', 'update')], { yes: true, derived: { s1: 'risky' } }))
  expect(derived).toMatchObject({ refuse: { code: 'E_APPROVAL_REQUIRED' } })
})

test(`--yes covers at most ${YES_LIMIT} writes, adoptions and releases; base-only updates do not count`, () => {
  const writes = (n: number) => Array.from({ length: n }, (_, i) => step(`s${i + 1}`, i % 2 ? 'adopt' : 'create'))
  expect(decideApproval(request(writes(YES_LIMIT), { yes: true }))).toEqual({ mode: 'yes' })
  const based = [...writes(YES_LIMIT), ...Array.from({ length: 5 }, (_, i) => step(`b${i}`, 'update', 'safe', false))]
  expect(decideApproval(request(based, { yes: true }))).toEqual({ mode: 'yes' })
  const over = decideApproval(request(writes(YES_LIMIT + 1), { yes: true }))
  expect((over as { refuse: { message: string } }).refuse.message).toContain('it has 26 writes')
})

test('a person at a terminal covers any plan; with no terminal and no flag the command for a person is the fix', () => {
  const steps = [step('s1', 'update', 'risky')]
  expect(decideApproval(request(steps, { interactive: true, policy: { protected: true } }))).toEqual({
    mode: 'terminal',
  })
  const refused = decideApproval(request(steps))
  expect(refused).toMatchObject({ refuse: { code: 'E_APPROVAL_REQUIRED', fix: person, humanRequired: true } })
  expect(refused).toMatchInlineSnapshot(`
    {
      "refuse": {
        "code": "E_APPROVAL_REQUIRED",
        "fix": "ask the user to run kalup apply plan.json in a terminal, where they confirm it",
        "humanRequired": true,
        "message": "Applying needs approval from a person at a terminal, and there is none here (no terminal, --json, or CI set): this plan has 1 step to apply.",
      },
    }
  `)
})

test('no fix ever suggests --approve', () => {
  const cases: Partial<ApprovalRequest>[] = [
    {},
    { yes: true, policy: { protected: true } },
    { approve: `sha256:${'c'.repeat(64)}`, credential: { envOnly: true, separate: true } },
    { approve: hash },
  ]
  for (const extra of cases) {
    const decided = decideApproval(request([step('s1', 'update', 'risky')], extra))
    expect(JSON.stringify(decided)).not.toContain('--approve <')
    expect(decided).not.toMatchObject({ refuse: { fix: expect.stringContaining('--approve') } })
  }
})
