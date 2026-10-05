// The bodies apply sends: each built from the read made right before it. A create is
// core's create payload under the plan's names. A property PATCH carries exactly the approved units, plus the live type
// and fieldType; its options are the live list as HubSpot returned it with the approved changes applied, since HubSpot
// replaces the whole list. A group PATCH carries its label. Pure.

import { parseAddress } from '../ir/address.js'
import { toCreatePayload } from '../ir/payload.js'
import type { IROption, IRResource, Ref } from '../ir/types.js'
import type { RawOption, RawProperty } from '../lib/pull/normalize.js'
import type { PlanChange, PlanStep } from '../plan/types.js'
import { fieldOf } from './derive.js'

/** An option as HubSpot's OptionInput requires it: label, value, displayOrder and hidden, description when set. */
export interface OptionInput {
  description?: string
  displayOrder: number
  hidden: boolean
  label: string
  value: string
}

// An option member unit: `options[<value>]`, or one of its fields.
const MEMBER = /^options\[(.*)\](?:\.(label|hidden|description))?$/s

/**
 * The create body of a group or property step: core's toCreatePayload under the portal name, the property's group
 * named by its portal name, and every option complete, `hidden` included, as OptionInput requires.
 */
export function createBody(
  step: Pick<PlanStep, 'address' | 'desired'>,
  names: { group?: string; name: string },
): Record<string, unknown> {
  const { type, path } = parseAddress(step.address)
  const key = path.slice(0, path.indexOf('/'))
  const definition = { ...step.desired }
  if (type === 'property' && names.group !== undefined) {
    definition.group = { $ref: `group:${key}/${names.group}` }
  }
  const resource = { type, managed: true, definition } as IRResource
  const body = toCreatePayload(`${type}:${key}/${names.name}`, resource)
  if (Array.isArray(body.options)) {
    body.options = (body.options as Record<string, unknown>[]).map((o) => ({ ...o, hidden: o.hidden ?? false }))
  }
  return body
}

/**
 * The PATCH body of a property step with changes: each approved scalar unit (`group` sent as `groupName`, by its portal
 * name), the live `type`, the live `fieldType` unless the step sets it, and the full options when any option unit
 * changes.
 */
export function propertyPatch(
  step: Pick<PlanStep, 'changes' | 'desired'>,
  live: Pick<RawProperty, 'fieldType' | 'options' | 'type'>,
  groupName: (ref: string) => string,
): Record<string, unknown> {
  const changes = step.changes ?? []
  const body: Record<string, unknown> = {}
  for (const change of changes) {
    const field = fieldOf(change.unit)
    if (field === 'options') {
      continue
    }
    if (field === 'group') {
      body.groupName = groupName((change.after as Ref).$ref)
    } else {
      body[field] = change.after
    }
  }
  body.type = live.type
  body.fieldType ??= live.fieldType
  if (changes.some((c) => fieldOf(c.unit) === 'options')) {
    const desired = (step.desired?.options as IROption[] | undefined) ?? []
    body.options = optionsPatch(changes, live.options ?? [], desired)
  }
  return body
}

/** The PATCH body of a group step: its label. A group update may set nothing else. */
export function groupPatch(changes: PlanChange[]): Record<string, unknown> {
  const label = changes.find((c) => c.unit === 'label')
  return label ? { label: label.after } : {}
}

/**
 * The full option list a PATCH sends: every live option as HubSpot returned it, less the approved removes, with the
 * approved member edits, then the approved adds after the highest live displayOrder, in config's order (`desired`).
 * An approved `options.order` renumbers: its values first, in its order, then the rest as they were.
 */
export function optionsPatch(changes: PlanChange[], live: RawOption[], desired: IROption[] = []): OptionInput[] {
  const removed = new Set(removedValues(changes))
  const list: OptionInput[] = live.filter((o) => !removed.has(o.value)).map(complete)
  for (const change of changes) {
    const member = memberOf(change.unit)
    const option = member?.field === undefined ? undefined : list.find((o) => o.value === member.value)
    if (option && member?.field === 'hidden') {
      option.hidden = change.after === true
    } else if (option && member?.field === 'label') {
      option.label = String(change.after)
    } else if (option && member?.field === 'description') {
      option.description = String(change.after)
    }
  }
  const highest = Math.max(-1, ...live.map((o) => o.displayOrder ?? -1))
  const place = (o: IROption) => {
    const at = desired.findIndex((d) => d.value === o.value)
    return at === -1 ? desired.length : at
  }
  const adds = changes
    .filter((c) => c.op === 'add')
    .map((c) => c.after as IROption)
    .sort((a, b) => place(a) - place(b))
  adds.forEach((option, index) => {
    list.push(complete({ ...option, displayOrder: highest + 1 + index }))
  })
  const order = changes.find((c) => c.unit === 'options.order')?.after as string[] | undefined
  if (order === undefined) {
    return list
  }
  const rank = (o: OptionInput) => (order.includes(o.value) ? order.indexOf(o.value) : order.length)
  return list
    .map((o, index) => ({ o, index }))
    .sort((a, b) => rank(a.o) - rank(b.o) || byOrder(a.o, b.o) || a.index - b.index)
    .map(({ o }, displayOrder) => ({ ...o, displayOrder }))
}

// A stage's metadata field, the only one config states: deals' probability, tickets' ticketState, custom objects'
// state. HubSpot takes every metadata value as a string and derives isClosed itself.
const STAGE_METADATA = ['probability', 'ticketState', 'state'] as const

/** A stage's metadata as HubSpot takes it: the field config states, as a string. */
export function stageMetadata(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of STAGE_METADATA) {
    if (fields[field] !== undefined) {
      out[field] = String(fields[field])
    }
  }
  return out
}

/**
 * The create body of a pipeline step: its ID, label and displayOrder, and every stage it carries, in display order,
 * each with its ID, its index as displayOrder and its metadata. HubSpot refuses a pipeline without a stage.
 */
export function pipelineCreateBody(
  step: Pick<PlanStep, 'address' | 'desired' | 'stages'>,
  pipelineId: string,
): Record<string, unknown> {
  const desired = step.desired ?? {}
  return {
    pipelineId,
    label: desired.label,
    displayOrder: desired.displayOrder,
    stages: (step.stages ?? []).map((st, displayOrder) => ({
      stageId: st.address.slice(st.address.lastIndexOf('/') + 1),
      label: st.desired.label,
      displayOrder,
      metadata: stageMetadata(st.desired),
    })),
  }
}

/** The create body of a stage step: its ID, label and metadata, at `displayOrder`, a free slot after every stage. */
export function stageCreateBody(desired: Record<string, unknown>, stageId: string, displayOrder: number) {
  return { stageId, label: desired.label, displayOrder, metadata: stageMetadata(desired) }
}

/** The PATCH body of a pipeline step: its approved label and displayOrder. The stage order is written stage by stage. */
export function pipelinePatch(changes: PlanChange[]): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const change of changes) {
    if (change.unit === 'label' || change.unit === 'displayOrder') {
      body[change.unit] = change.after
    }
  }
  return body
}

/** The PATCH body of a stage step: its approved label, and its metadata field, which HubSpot merges into the rest. */
export function stagePatch(changes: PlanChange[]): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const fields: Record<string, unknown> = {}
  for (const change of changes) {
    if (change.unit === 'label') {
      body.label = change.after
    } else {
      fields[change.unit] = change.after
    }
  }
  const metadata = stageMetadata(fields)
  return Object.keys(metadata).length > 0 ? { ...body, metadata } : body
}

/**
 * The stage order a write leaves: every live stage, the approved order's stages in that order, each in a slot one of
 * them holds, so a stage the order leaves out keeps its place among its neighbours. Stages the approved order names and
 * HubSpot does not hold are left out.
 */
export function stageOrder(live: string[], approved: string[]): string[] {
  const queue = approved.filter((id) => live.includes(id))
  const placed = new Set(queue)
  return live.map((id) => (placed.has(id) ? (queue.shift() as string) : id))
}

/** The option values a step's approved changes remove. */
export function removedValues(changes: PlanChange[] = []): string[] {
  return changes
    .filter((c) => c.op === 'remove')
    .flatMap((c) => {
      const member = memberOf(c.unit)
      return member ? [member.value] : []
    })
}

/** The option value and field a member unit names, or undefined for any other unit. */
export function memberOf(unit: string): { field?: 'description' | 'hidden' | 'label'; value: string } | undefined {
  const match = MEMBER.exec(unit)
  if (!match) {
    return undefined
  }
  const field = match[2] as 'description' | 'hidden' | 'label' | undefined
  return field === undefined ? { value: match[1] as string } : { value: match[1] as string, field }
}

// An option with the fields OptionInput requires: HubSpot's own values, a missing displayOrder as -1 (after every
// positive one) and a missing hidden as false.
function complete(o: { description?: string; displayOrder?: number; hidden?: boolean; label: string; value: string }) {
  const option: OptionInput = {
    label: o.label,
    value: o.value,
    displayOrder: o.displayOrder ?? -1,
    hidden: o.hidden ?? false,
  }
  if (typeof o.description === 'string') {
    option.description = o.description
  }
  return option
}

// Options outside an approved order keep their relative place: lowest non-negative displayOrder first.
function byOrder(a: OptionInput, b: OptionInput): number {
  const at = (o: OptionInput) => (o.displayOrder < 0 ? Number.MAX_SAFE_INTEGER : o.displayOrder)
  return at(a) - at(b)
}
