// The one approval contract: a person at a terminal, --yes for an unprotected target with nothing risky, or
// --approve with the digest of a plan a reviewer saw and a write key only a reviewed CI environment holds. A delete
// needs the person, always. Pure: the command asks the person and passes what it learned.
import type { Plan, Risk } from '@kalup/core'
import type { Issue } from '../lib/output.js'
import { sanitize } from '../lib/sanitize.js'
import { hasEffect } from './digest.js'
import type { Policy } from './policy.js'

export type ApprovalMode = 'terminal' | 'yes' | 'approve'

export interface ApprovalRequest {
  /** `--approve <writesHash>`. */
  approve?: string
  /** The command a person runs at a terminal: `kalup apply <plan-file>`, or the direct form for a plan made now. */
  command: string
  /** How the write key was resolved: from the process environment only, and from a variable of its own. */
  credential: { envOnly: boolean; separate: boolean }
  /**
   * The risk of each effect step, by step id. Before the lock it is the plan's stated risk; apply then derives it with
   * trusted code and refuses a plan that states less (E_PLAN_RISK), so a stated risk never lets --yes pass more.
   */
  derived: Record<string, Risk>
  /** A person is at a terminal: stdin and stderr are terminals, no --json, CI unset. */
  interactive: boolean
  plan: Pick<Plan, 'steps' | 'writesHash'>
  policy: Pick<Policy, 'protected'>
  target: string
  /** `--yes`. */
  yes: boolean
}

export type Approval = { mode: ApprovalMode } | { refuse: Issue }

/** --yes covers at most this many writes, adoptions and releases together. */
export const YES_LIMIT = 25

// How many steps a refusal names before it counts the rest.
const NAMED = 5

/**
 * Which approval covers the plan's effects, or why none does. E_APPROVE_MISMATCH is exit 1; every other refusal is
 * exit 4 with humanRequired, and its fix names the command for a person at a terminal, never --approve.
 */
export function decideApproval(request: ApprovalRequest): Approval {
  const { approve, command, interactive, plan, yes } = request
  const effects = plan.steps.filter(hasEffect)
  const deletes = effects.filter((s) => s.action === 'delete')
  const person = `ask the user to run ${command} in a terminal, where they confirm it`
  if (deletes.length > 0) {
    if (yes || approve !== undefined) {
      const flag = yes ? '--yes' : '--approve'
      return refuse(
        `Deleting needs a person at a terminal: this plan deletes ${count(deletes.length, 'resource')}, and ${flag} never covers a delete.`,
        `${person} and type the target name and the number of destructive steps`,
      )
    }
    if (interactive) {
      return { mode: 'terminal' }
    }
    return refuse(
      `Deleting needs a person at a terminal, and there is none here (no terminal, --json, or CI set): this plan deletes ${count(deletes.length, 'resource')}.`,
      `${person} and type the target name and the number of destructive steps`,
    )
  }
  if (approve !== undefined) {
    if (approve !== plan.writesHash) {
      return {
        refuse: {
          code: 'E_APPROVE_MISMATCH',
          message:
            'The digest given to --approve is not the writesHash of this plan: the plan changed after the review, or the digest belongs to another plan. Nothing was written.',
          fix: `review this plan again; a person can apply it with ${command} in a terminal`,
        },
      }
    }
    if (!(request.credential.envOnly && request.credential.separate)) {
      return refuse(
        '--approve needs a write key that only the reviewed CI environment holds: a credentials.write of its own, read from the process environment only.',
        `give the target credentials.write with a variable only the reviewed CI environment holds, or ${person}`,
        'E_APPROVE_CREDENTIAL',
      )
    }
    return { mode: 'approve' }
  }
  if (yes) {
    const why = yesRefusal(request, effects)
    return why === undefined ? { mode: 'yes' } : refuse(`--yes does not cover this plan: ${why}.`, person)
  }
  if (interactive) {
    return { mode: 'terminal' }
  }
  return refuse(
    `Applying needs approval from a person at a terminal, and there is none here (no terminal, --json, or CI set): this plan has ${count(effects.length, 'step')} to apply.`,
    person,
  )
}

// The first condition of --yes that fails: the target is protected, a step is risky or destructive, or there are
// more than YES_LIMIT writes, adoptions and releases. A base-only update writes nothing and does not count.
function yesRefusal(request: ApprovalRequest, effects: Plan['steps']): string | undefined {
  if (request.policy.protected) {
    return `target ${sanitize(request.target)} is protected, and a protected target needs a person at a terminal`
  }
  const risky = effects.filter((s) => {
    const risk = request.derived[s.id] ?? s.risk
    return risk === 'risky' || risk === 'destructive'
  })
  if (risky.length > 0) {
    const named = risky.slice(0, NAMED).map((s) => `${s.id} (${request.derived[s.id] ?? s.risk})`)
    const more = risky.length > NAMED ? ` and ${risky.length - NAMED} more` : ''
    return `${named.join(', ')}${more} ${risky.length === 1 ? 'is' : 'are'} not safe`
  }
  const counted = effects.filter((s) => s.action !== 'update' || (s.changes ?? []).length > 0)
  if (counted.length > YES_LIMIT) {
    return `it has ${counted.length} writes, adoptions and releases, and --yes covers at most ${YES_LIMIT}`
  }
  return undefined
}

function refuse(message: string, fix: string, code: Issue['code'] = 'E_APPROVAL_REQUIRED'): Approval {
  return { refuse: { code, message, fix, humanRequired: true } }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}
