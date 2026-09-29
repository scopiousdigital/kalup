// Trusted derivation: what a classified unit becomes, a step's risk and labels, and what HubSpot lets an
// update write. The planner builds every step from it, and apply checks a saved plan against it with state and a
// fresh observation, so a plan file cannot state a lower risk or drop a label. Pure.

import { bin } from '../brand.js'
import type { Origin } from '../ir/state.js'
import type { UnitClass, UnitResult } from '../plan/classify.js'
import type { PlanLabel, PlanStep, Risk } from '../plan/types.js'
import type { PropertyMeta } from './observe.js'
import type { Policy } from './policy.js'

/** What a unit becomes: written, held for a person to settle, kept with a note, or nothing when it agrees. */
export type Disposition = 'none' | 'write' | 'hold' | 'note'

export interface Derived {
  class: UnitClass
  disposition: Disposition
  /** Written over a value that moved in HubSpot, or that config and HubSpot never agreed on: reverts-ui-edit. */
  reverts: boolean
}

export interface StepContext {
  /** The trusted class of each written unit. Absent: the class each change states. */
  classes?: Record<string, UnitClass>
  drift: Policy['drift']
  /** The state entry that owns the address. A create with one recreates what HubSpot no longer holds. */
  owner?: { origin: Origin }
}

/** The portal names of the properties that name a group, and those the same plan deletes before it. */
export interface Members {
  active: string[]
  archived: string[]
  deleted: ReadonlySet<string>
}

/** Why HubSpot cannot take a step: its short title, a plain detail and the way out. */
export interface Block {
  detail: string
  fix?: string
  short: string
}

/** The classes a person settles: config and HubSpot moved apart, or never agreed. */
export const REVERTING: ReadonlySet<UnitClass> = new Set(['drift', 'conflict', 'diverged'])

// Units HubSpot cannot change in place: a property that differs in them has to be migrated.
const FIXED = new Set(['type', 'hasUniqueValue'])

// Where a unit's field name ends: an option member's `[`, or `.` in `options.order`.
const FIELD_END = /[.[]/

/**
 * What an update may write, by the unit's field, from HubSpot's documented update schemas: a property its label,
 * description, group (sent as groupName), formField, fieldType and options; a group its label. A custom object schema
 * is compared and never written in this release.
 */
export const WRITABLE: Record<'object' | 'group' | 'property', ReadonlySet<string>> = {
  object: new Set(),
  group: new Set(['label']),
  property: new Set(['label', 'description', 'group', 'formField', 'fieldType', 'options']),
}

/**
 * What a classified unit becomes. `converged` agrees; `config-change`, `add` and `remove` are written; `keep` is kept
 * with a note. `drift` and `conflict` are held unless `--take config` selected the unit (`taken`) or the target
 * overwrites drift; `diverged` has no base, so only a take writes it. A write over a moved or never agreed value reverts
 * an edit made in HubSpot.
 */
export function deriveChange(unit: UnitResult, policy: Pick<Policy, 'drift'>, taken: boolean): Derived {
  const reverting = REVERTING.has(unit.class)
  let disposition: Disposition
  if (unit.class === 'converged') {
    disposition = 'none'
  } else if (unit.class === 'keep') {
    disposition = 'note'
  } else if (!reverting || taken || (policy.drift === 'overwrite' && unit.class !== 'diverged')) {
    disposition = 'write'
  } else {
    disposition = 'hold'
  }
  return { class: unit.class, disposition, reverts: reverting && disposition === 'write' }
}

/**
 * A step's risk. A create is safe, unless it recreates what state owns and HubSpot no longer holds; a delete is
 * destructive; a release is safe. An adopt or update is risky when a change removes an option, sets fieldType (the
 * effect on existing values is not checked), or reverts a HubSpot edit because a person took config; under
 * `drift: 'overwrite'` a drift or conflict write keeps the risk of the change itself. Blocked stays blocked.
 */
export function stepRisk(step: PlanStep, context: StepContext): Risk {
  if (step.risk === 'blocked' || step.action === 'unknown') {
    return 'blocked'
  }
  switch (step.action) {
    case 'create':
      return context.owner ? 'risky' : 'safe'
    case 'delete':
      return 'destructive'
    case 'manual':
      return 'manual'
    case 'release':
      return 'safe'
    default:
      return (step.changes ?? []).some((c) => c.op === 'remove' || c.unit === 'fieldType' || revertsByTake(c, context))
        ? 'risky'
        : 'safe'
  }
}

/**
 * A step's labels: `reverts-ui-edit` when it writes a unit whose class is drift, conflict or diverged, or recreates
 * what state owns; `existed-before-kalup` on a delete of an adopted resource.
 */
export function stepLabels(step: PlanStep, context: StepContext): PlanLabel[] {
  if (step.risk === 'blocked') {
    return []
  }
  if (step.action === 'delete') {
    return context.owner?.origin === 'adopted' ? ['existed-before-kalup'] : []
  }
  const reverts =
    step.action === 'create'
      ? context.owner !== undefined
      : (step.changes ?? []).some((c) => REVERTING.has(classOf(c, context)))
  return reverts ? ['reverts-ui-edit'] : []
}

/** The field a unit belongs to: `options` for an option member, a member's field and `options.order`. */
export function fieldOf(unit: string): string {
  const at = unit.search(FIELD_END)
  return at === -1 ? unit : unit.slice(0, at)
}

/**
 * Why HubSpot cannot take an adopt or update of `kind`, or undefined when it can. A difference in `type` or
 * `hasUniqueValue` blocks whatever else the step holds, since the property has to be migrated. Written units must be
 * writable, a read-only definition blocks writing its fields, and read-only options block writing an option.
 */
export function writeBlock(
  kind: 'object' | 'group' | 'property',
  units: UnitResult[],
  written: string[],
  meta: PropertyMeta | undefined,
): Block | undefined {
  const fixed = kind === 'property' ? units.filter((u) => FIXED.has(u.unit) && u.class !== 'converged') : []
  if (fixed.length > 0) {
    return {
      short: `${fixed.map((u) => u.unit).join(' and ')} ${fixed.length > 1 ? 'differ' : 'differs'}`,
      detail: fixed
        .map((u) => `config has ${u.unit} ${JSON.stringify(u.desired)} and the portal ${JSON.stringify(u.observed)}`)
        .join('; '),
      fix: `change the builder to match the portal, or migrate: create a new property, copy the values over, point what uses this one at the new one, then run ${bin} rm on this one`,
    }
  }
  const unwritable = written.filter((unit) => !WRITABLE[kind].has(fieldOf(unit)))
  if (unwritable.length > 0) {
    return {
      short: 'no update for it',
      detail: `HubSpot has no update for ${unwritable.join(', ')}`,
      fix: 'change config to match the portal',
    }
  }
  const flags = meta?.modificationMetadata ?? {}
  const definition = written.filter((unit) => fieldOf(unit) !== 'options')
  if (flags.readOnlyDefinition === true && definition.length > 0) {
    return {
      short: 'read-only definition',
      detail: `HubSpot marks the definition read-only, so ${definition.join(', ')} cannot be written`,
      fix: 'change config to match the portal',
    }
  }
  const options = written.filter((unit) => fieldOf(unit) === 'options')
  if (flags.readOnlyOptions === true && options.length > 0) {
    return {
      short: 'read-only options',
      detail: `HubSpot marks the options read-only, so ${options.join(', ')} cannot be written`,
      fix: 'change config to match the portal',
    }
  }
  return undefined
}

/**
 * Why a delete cannot run, or undefined when it can: HubSpot marks the property not archivable, or, for a group,
 * properties still name it, active or archived, apart from those the same plan deletes first. On a developer test
 * account (2026-09-29) HubSpot refused to archive a group that held an active property, and archived one whose
 * properties were all archived; what a later restore of those properties then does is not confirmed.
 */
export function deleteBlock(meta: PropertyMeta | undefined, members?: Members): Block | undefined {
  if (meta?.modificationMetadata?.archivable === false) {
    return {
      short: 'not archivable',
      detail: 'HubSpot marks this property as not archivable',
      fix: "keep it in HubSpot: set its tombstone's action to release in kalup/removed.ts",
    }
  }
  if (members === undefined) {
    return undefined
  }
  const active = members.active.filter((name) => !members.deleted.has(name))
  const archived = members.archived.filter((name) => !members.deleted.has(name))
  if (active.length === 0 && archived.length === 0) {
    return undefined
  }
  const lists = [
    ...(active.length > 0 ? [active.join(', ')] : []),
    ...(archived.length > 0 ? [`archived: ${archived.join(', ')}`] : []),
  ]
  return {
    short: 'group still holds properties',
    detail: `properties in HubSpot still name this group: ${lists.join('; ')}`,
    fix: 'move them to another group or delete them first; HubSpot refused to archive a group that held an active property on a developer test account (2026-09-29)',
  }
}

function classOf(change: { class: UnitClass; unit: string }, context: StepContext): UnitClass {
  return context.classes?.[change.unit] ?? change.class
}

// A write over drift, a conflict or a diverged unit that only a take explains: overwrite covers drift and conflicts.
function revertsByTake(change: { class: UnitClass; unit: string }, context: StepContext): boolean {
  const cls = classOf(change, context)
  return REVERTING.has(cls) && !(context.drift === 'overwrite' && cls !== 'diverged')
}
