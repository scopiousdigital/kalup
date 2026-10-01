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
  /** Written over a value that moved in HubSpot, or that config and HubSpot never agreed on. */
  reverts: boolean
}

export interface StepContext {
  /** The trusted class of each written unit. Absent: the class each change states. */
  classes?: Record<string, UnitClass>
  drift: Policy['drift']
  /** The state entry that owns the address. A create with one recreates what HubSpot no longer holds. */
  owner?: { origin: Origin }
  /** A delete that archives what config lacks because the mode is takeover. */
  takeover?: boolean
  /** The option units an adopt or update removes because takeover made the options lifecycle 'exact'. */
  takeoverUnits?: ReadonlySet<string>
}

/** The portal names of the active properties that name a group, and those the same plan deletes before it. */
export interface Members {
  active: string[]
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

// Units HubSpot cannot change in place: a property that differs in them has to be migrated. HubSpot answers 200 to a
// PATCH of hasUniqueValue, dataSensitivity or referencedObjectType and keeps the old value (observed, docs/hubspot.md).
const FIXED = new Set(['type', 'hasUniqueValue', 'dataSensitivity', 'externalOptions', 'referencedObjectType'])

// Where a unit's field name ends: an option member's `[`, or `.` in `options.order`.
const FIELD_END = /[.[]/

/**
 * What an update may write, by the unit's field, from HubSpot's documented update schema as live runs confirmed it
 * (docs/hubspot.md): a property its label, description, group (sent as groupName), formField, fieldType, options,
 * hidden, displayOrder, number and text display fields and calculation formula; a group its label. A custom object
 * schema is compared and never written in this release.
 */
export const WRITABLE: Record<'object' | 'group' | 'property', ReadonlySet<string>> = {
  object: new Set(),
  group: new Set(['label']),
  property: new Set([
    'label',
    'description',
    'group',
    'formField',
    'fieldType',
    'options',
    'hidden',
    'displayOrder',
    'numberDisplayHint',
    'showCurrencySymbol',
    'currencyPropertyName',
    'textDisplayHint',
    'calculationFormula',
  ]),
}

/** Units whose change rewrites values HubSpot holds on records, which plan does not check: a step that sets one is risky. */
const REVALUES = new Set(['fieldType', 'calculationFormula'])

/**
 * What a classified unit becomes. `converged` agrees; `config-change`, `add` and `remove` are written; `keep` is kept
 * with a note. `drift` and `conflict` are held unless `--take config` selected the unit (`taken`) or the target
 * overwrites drift; `diverged` has no base, so only a take or `adopt: 'overwrite'` writes it. A write over a moved or
 * never agreed value overwrites what HubSpot holds.
 */
export function deriveChange(
  unit: UnitResult,
  policy: Pick<Policy, 'drift'> & Partial<Pick<Policy, 'adopt'>>,
  taken: boolean,
): Derived {
  const reverting = REVERTING.has(unit.class)
  const overwrites = unit.class === 'diverged' ? policy.adopt === 'overwrite' : policy.drift === 'overwrite'
  let disposition: Disposition
  if (unit.class === 'converged') {
    disposition = 'none'
  } else if (unit.class === 'keep') {
    disposition = 'note'
  } else if (!reverting || taken || overwrites) {
    disposition = 'write'
  } else {
    disposition = 'hold'
  }
  return { class: unit.class, disposition, reverts: reverting && disposition === 'write' }
}

/**
 * A step's risk. A create is safe, unless it recreates what state owns and HubSpot no longer holds; a delete is
 * destructive; a release is safe. An adopt or update is destructive when takeover removes an option, and risky when a
 * change removes an option, sets fieldType or calculationFormula (the effect on existing values is not checked), or
 * writes over a HubSpot value because a person took config or `adopt: 'overwrite'` wrote a unit with no base; under
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
      if ((step.changes ?? []).some((c) => c.op === 'remove' && context.takeoverUnits?.has(c.unit))) {
        return 'destructive'
      }
      return (step.changes ?? []).some((c) => c.op === 'remove' || REVALUES.has(c.unit) || revertsByTake(c, context))
        ? 'risky'
        : 'safe'
  }
}

/**
 * A step's labels: `reverts-ui-edit` when it writes a unit whose class is drift or conflict, or recreates what state
 * owns; `overwrites-portal` when it writes a diverged unit, a value config and HubSpot never agreed on; `takeover` when
 * takeover archives it or removes an option from it; `existed-before-kalup` on a delete of an adopted resource.
 */
export function stepLabels(step: PlanStep, context: StepContext): PlanLabel[] {
  if (step.risk === 'blocked') {
    return []
  }
  if (step.action === 'delete') {
    return [
      ...(context.takeover ? ['takeover' as const] : []),
      ...(context.owner?.origin === 'adopted' ? ['existed-before-kalup' as const] : []),
    ]
  }
  if (step.action === 'create') {
    return context.owner === undefined ? [] : ['reverts-ui-edit']
  }
  const classes = (step.changes ?? []).map((c) => classOf(c, context))
  const labels: PlanLabel[] = []
  if (classes.some((c) => c === 'drift' || c === 'conflict')) {
    labels.push('reverts-ui-edit')
  }
  if (classes.includes('diverged')) {
    labels.push('overwrites-portal')
  }
  if ((step.changes ?? []).some((c) => c.op === 'remove' && context.takeoverUnits?.has(c.unit))) {
    labels.push('takeover')
  }
  return labels
}

/** The field a unit belongs to: `options` for an option member, a member's field and `options.order`. */
export function fieldOf(unit: string): string {
  const at = unit.search(FIELD_END)
  return at === -1 ? unit : unit.slice(0, at)
}

/**
 * Why HubSpot cannot take an adopt or update of `kind`, or undefined when it can. A difference in `type` or
 * `hasUniqueValue` blocks whatever else the step holds, since the property has to be migrated. Written units must be
 * writable, a read-only definition blocks writing its fields, and read-only options block writing an option. HubSpot
 * answers 400 to turning showCurrencySymbol off once the property ever had a currencyPropertyName, `''` included, and
 * nothing clears it (observed 2026-10-01); `meta` carries the value as HubSpot returned it, which config may leave out.
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
  const currency = meta?.currencyPropertyName
  const symbolOff = units.some((u) => u.unit === 'showCurrencySymbol' && u.desired !== true)
  if (written.includes('showCurrencySymbol') && symbolOff && currency !== undefined) {
    return {
      short: 'currency property set',
      detail: `HubSpot never turns showCurrencySymbol off once the property had a currencyPropertyName; this one holds ${JSON.stringify(currency)}, and clearing it does not lift the refusal`,
      fix: `keep showCurrencySymbol: true, or migrate: create a new property under another name, copy the values over, point what uses this one at the new one, then run ${bin} rm on this one`,
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
 * active properties still name it, apart from those the same plan deletes first. HubSpot refuses to archive a group
 * that holds an active property and archives one whose properties are all archived (observed 2026-09-29 and
 * 2026-10-01); an archived group never comes back, and its archived properties can only be restored into another
 * group, so archived members do not block.
 */
export function deleteBlock(meta: PropertyMeta | undefined, members?: Members): Block | undefined {
  if (meta?.modificationMetadata?.archivable === false) {
    return {
      short: 'not archivable',
      detail: 'HubSpot marks this property as not archivable',
      fix: "keep it in HubSpot: set its tombstone's action to release in removed.ts",
    }
  }
  if (members === undefined) {
    return undefined
  }
  const active = members.active.filter((name) => !members.deleted.has(name))
  if (active.length === 0) {
    return undefined
  }
  return {
    short: 'group still holds properties',
    detail: `properties in HubSpot still name this group: ${active.join(', ')}`,
    fix: 'move them to another group or delete them first; HubSpot archives a group only once every property in it is archived',
  }
}

function classOf(change: { class: UnitClass; unit: string }, context: StepContext): UnitClass {
  return context.classes?.[change.unit] ?? change.class
}

// A write over drift, a conflict or a diverged unit that only a take or adopt: 'overwrite' explains: drift overwrite
// covers drift and conflicts, and a diverged write stays risky whatever wrote it.
function revertsByTake(change: { class: UnitClass; unit: string }, context: StepContext): boolean {
  const cls = classOf(change, context)
  return REVERTING.has(cls) && !(context.drift === 'overwrite' && cls !== 'diverged')
}
