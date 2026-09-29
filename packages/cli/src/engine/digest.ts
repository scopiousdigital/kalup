// The approval digest, docs/architecture.md section 7: what an approval of a plan binds to. The verified
// destination, the effective policy, the state lineage and serial, the normalizer versions, the bindings and every step
// with an effect. Nothing a person reads without it changing what apply does is in it: titles, stated risk, classes,
// counts, held values, notes, provenance, orphans, missing entries, coverage, preflight, budget.
import { createHash } from 'node:crypto'
import { type Plan, type PlanStep, stableStringify } from '@kalup/core'

export interface ApprovalContext {
  bindings: Plan['bindings']
  destination: { portalId: number; target: string }
  format: 'plan/1'
  normVersions: Plan['normVersions']
  policy: { allowDestroy: boolean; drift: 'hold' | 'overwrite'; protected: boolean }
  state: { lineage: string | null; serial: number | null }
  steps: ApprovalStep[]
}

export type ApprovalStep = Pick<
  PlanStep,
  'action' | 'address' | 'api' | 'baseUnits' | 'desired' | 'expect' | 'ignoreChanges' | 'labels' | 'transport'
> & { changes?: { after: unknown; op: 'set' | 'add' | 'remove'; unit: string }[] }

type Approved = Pick<Plan, 'bindings' | 'normVersions' | 'stateLineage' | 'stateSerial' | 'steps' | 'target'>

// A create or update writes, a delete removes, and an adopt or release changes ownership even when it writes nothing.
const EFFECTS = new Set(['create', 'adopt', 'delete', 'release'])

/**
 * Whether apply would run the step: a create, adopt, delete or release, or an update with changes or baseUnits. An
 * update with neither only reports held units or notes. A blocked step has no effect.
 */
export function hasEffect(step: PlanStep): boolean {
  if (step.risk === 'blocked') {
    return false
  }
  if (step.action === 'update') {
    return (step.changes ?? []).length > 0 || (step.baseUnits ?? []).length > 0
  }
  return EFFECTS.has(step.action)
}

/** Exactly what writesHash hashes. Steps without an effect are left out: they approve nothing. */
export function approvalContext(plan: Approved): ApprovalContext {
  const { target } = plan
  return {
    format: 'plan/1',
    destination: { target: target.name, portalId: target.portalId },
    policy: { protected: target.protected, drift: target.drift, allowDestroy: target.allowDestroy },
    state: { lineage: plan.stateLineage, serial: plan.stateSerial },
    normVersions: plan.normVersions,
    bindings: plan.bindings,
    steps: plan.steps.filter(hasEffect).map(approvalStep),
  }
}

/** 'sha256:' plus the hex digest of the approval context, keys sorted. planId is 'pl_' plus its first 12 hex. */
export function writesHash(plan: Approved): string {
  return sha256(stableStringify(approvalContext(plan)))
}

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

function approvalStep(step: PlanStep): ApprovalStep {
  const { address, action, transport, api, labels, baseUnits, desired, ignoreChanges, changes, expect } = step
  return {
    address,
    action,
    transport,
    api,
    labels,
    baseUnits,
    desired,
    ignoreChanges,
    changes: changes?.map(({ unit, op, after }) => ({ unit, op, after })),
    expect,
  }
}
