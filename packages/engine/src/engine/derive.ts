// Trusted derivation: what a classified unit becomes, a step's risk and labels, and what HubSpot lets an
// update write. The planner builds every step from it, and apply checks a saved plan against it with state and a
// fresh observation, so a plan file cannot state a lower risk or drop a label. Pure.

import { bin } from '../brand.js'
import type { Origin } from '../ir/state.js'
import type { IRResource } from '../ir/types.js'
import { STANDARD_OBJECTS } from '../lib/pull/scope.js'
import { OBJECT_FIELDS, stageField } from '../loader/tables.js'
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

/** The resource types a plan steps through. */
export type Kind = 'object' | 'group' | 'property' | 'pipeline' | 'stage' | 'association'

/**
 * What an update may write, by the unit's field, from HubSpot's documented update schema as live runs confirmed it
 * (docs/hubspot.md): a property its label, description, group (sent as groupName), formField, fieldType, options,
 * hidden, displayOrder, number and text display fields and calculation formula; a group its label; a pipeline its
 * label, displayOrder and the order of its stages; a stage its label and its metadata field; a custom object schema its
 * labels, description and its display, required and searchable properties (observed 2026-10-05). A schema's name never
 * changes: HubSpot ignores it in a PATCH.
 */
export const WRITABLE: Record<Kind, ReadonlySet<string>> = {
  object: new Set(OBJECT_FIELDS),
  group: new Set(['label']),
  pipeline: new Set(['label', 'displayOrder', 'stages']),
  stage: new Set(['label', 'probability', 'ticketState', 'state']),
  association: new Set(['label', 'inverseLabel']),
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

/**
 * Units whose change rewrites values HubSpot holds on records, which plan does not check, or changes how existing
 * records count (a stage's probability or closed state moves forecasts and open and closed reports): a step that sets
 * one is risky.
 */
export const REVALUES: ReadonlySet<string> = new Set([
  'fieldType',
  'calculationFormula',
  'probability',
  'ticketState',
  'state',
])

// An ID made of digits alone: one HubSpot assigned, as to a pipeline or stage made in the HubSpot UI.
/** An ID made of digits alone: one HubSpot assigned, as to a pipeline or stage made in the HubSpot UI. */
export const ASSIGNED = /^\d+$/

/** Whether Kalup writes the pipelines of an object: deals, tickets and custom objects. */
export function writesPipelines(object: string): boolean {
  return stageField(object, !STANDARD_OBJECTS.has(object)) !== undefined
}

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
      return context.owner || assignedId(step) ? 'risky' : 'safe'
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

/**
 * Whether a pipeline or stage create sends an ID HubSpot assigned in another portal, all digits, for itself or a stage
 * it carries: on a portal that holds the same pipeline under other IDs it makes a copy, so it is risky.
 */
export function assignedId(step: Pick<PlanStep, 'action' | 'address' | 'stages'>): boolean {
  const type = step.address.slice(0, step.address.indexOf(':'))
  const ids = [step.address, ...(step.stages ?? []).map((st) => st.address)].map((a) => a.slice(a.lastIndexOf('/') + 1))
  return step.action === 'create' && (type === 'pipeline' || type === 'stage') && ids.some((id) => ASSIGNED.test(id))
}

/** The field a unit belongs to: `options` for an option member, a member's field and `options.order`. */
export function fieldOf(unit: string): string {
  const at = unit.search(FIELD_END)
  return at === -1 ? unit : unit.slice(0, at)
}

/**
 * Why an association cannot become what config says: a plain association that gains a label, or a label config holds
 * as a plain association. Undefined when both are of one kind. Plan blocks such a step and apply refuses it.
 */
export function associationKindChange(
  desired: Record<string, unknown> | undefined,
  live: Record<string, unknown> | undefined,
): Block | undefined {
  const [labelled, held] = [desired?.label !== undefined, live?.label !== undefined]
  if (labelled === held) {
    return undefined
  }
  return {
    short: labelled ? 'a plain association given a label' : 'a label without its text',
    detail: labelled
      ? 'config gives a label to what HubSpot holds as a plain association, and what HubSpot does with a label written on a plain association is unobserved: it could relabel every association between records of the pair'
      : 'config holds as a plain association what HubSpot holds as a label, and HubSpot has no update that takes a label away',
    fix: 'keep this entry as HubSpot holds it, and add an entry under another name for the association you want; apply creates it',
  }
}

/**
 * Why HubSpot cannot take an adopt or update of `kind`, or undefined when it can. A difference in `type` or
 * `hasUniqueValue` blocks whatever else the step holds, since the property has to be migrated. Written units must be
 * writable, a read-only definition blocks writing its fields, and read-only options block writing an option. HubSpot
 * answers 400 to turning showCurrencySymbol off once the property ever had a currencyPropertyName, `''` included, and
 * nothing clears it (observed 2026-10-01); `meta` carries the value as HubSpot returned it, which config may leave out.
 */
export function writeBlock(
  kind: Kind,
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

/**
 * Whether a stage's values leave it closed: a ticket or custom object stage set or created CLOSED. Apply runs such a
 * stage step before the pipeline's other stage steps, so a ticket pipeline always keeps a closed stage.
 */
export function closesStage(values: Record<string, unknown> | undefined): boolean {
  return values?.ticketState === 'CLOSED' || values?.state === 'CLOSED'
}

/**
 * `resources` as the steps `before` a stage delete leave them: each stage those steps create added to its pipeline's
 * order, and each stage field they write set. A delete runs only once every step before it is done, so the stage delete
 * rule counts what they leave.
 */
export function afterSteps(
  resources: Record<string, IRResource>,
  before: readonly Pick<PlanStep, 'action' | 'address' | 'changes' | 'desired'>[],
): Record<string, IRResource> {
  const out = { ...resources }
  const at = (address: string) => (Object.hasOwn(out, address) ? out[address] : undefined)
  for (const step of before) {
    const writes = step.action === 'create' || step.action === 'update' || step.action === 'adopt'
    if (!(writes && step.address.startsWith('stage:'))) {
      continue
    }
    const pipeline = `pipeline:${step.address.slice('stage:'.length, step.address.lastIndexOf('/'))}`
    const id = step.address.slice(step.address.lastIndexOf('/') + 1)
    const held = at(pipeline)
    const stages = (held?.definition?.stages as string[] | undefined) ?? []
    if (held && !stages.includes(id)) {
      out[pipeline] = { ...held, definition: { ...held.definition, stages: [...stages, id] } }
    }
    const written =
      step.action === 'create'
        ? (step.desired ?? {})
        : Object.fromEntries((step.changes ?? []).map((c) => [c.unit, c.after]))
    const current = at(step.address)
    out[step.address] = { type: 'stage', managed: true, ...current, definition: { ...current?.definition, ...written } }
  }
  return out
}

/**
 * Why a stage cannot be deleted, or undefined when it can: HubSpot refuses to leave a pipeline with no stage, or a
 * ticket pipeline with no closed stage (observed 2026-10-05). `resources` holds the pipeline and its stages as a read
 * found them and the steps before the delete leave them (afterSteps); `gone` the IDs of the stages of that pipeline
 * deleted before this one. `cli` names the command in the fix.
 */
export function stageDeleteRule(
  resources: Record<string, IRResource>,
  stage: string,
  gone: ReadonlySet<string>,
  cli: string,
): Block | undefined {
  const pipeline = `pipeline:${stage.slice('stage:'.length, stage.lastIndexOf('/'))}`
  const id = stage.slice(stage.lastIndexOf('/') + 1)
  const at = (address: string) => (Object.hasOwn(resources, address) ? resources[address] : undefined)
  const ids = ((at(pipeline)?.definition?.stages as string[] | undefined) ?? []).filter(
    (other) => other !== id && !gone.has(other),
  )
  const fix = `run ${cli} rm on ${pipeline} to delete the whole pipeline, or keep the stage: set its tombstone's action to release`
  if (ids.length === 0) {
    return { short: 'last stage', detail: 'it is the last stage of its pipeline, and HubSpot keeps one', fix }
  }
  const prefix = `${pipeline.replace('pipeline:', 'stage:')}/`
  const closed = (other: string) => at(`${prefix}${other}`)?.definition?.ticketState === 'CLOSED'
  if (at(stage)?.definition?.ticketState === 'CLOSED' && !ids.some(closed)) {
    const detail = 'it is the last closed stage of its ticket pipeline, and HubSpot keeps one'
    return { short: 'last closed stage', detail, fix: "mark another stage ticketState: 'CLOSED' first" }
  }
  return undefined
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
