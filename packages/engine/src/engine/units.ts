// What the engine modules share, one version of each so they agree: the specs classify takes from each side,
// what a classified unit becomes (docs/architecture.md section 6), an address's parts, the pull command, and whether no
// pull writes a resource: one that names a shadowed portal name, or a property outside its object's pull scope.
import type { ObjectScope, Override } from '@kalup/core'
import { bin } from '../brand.js'
import { pairOf, parseAddress } from '../ir/address.js'
import { DEFAULTS, PROPERTY_FIELDS } from '../ir/defaults.js'
import type { Base, ResourceState } from '../ir/state.js'
import type { Address, IROption, IRResource, Ref } from '../ir/types.js'
import { plural } from '../lib/plural.js'
import { type Listed, SHADOWED } from '../lib/pull/normalize.js'
import { inScope, scopeOf } from '../lib/pull/scope.js'
import { NORM_VERSIONS } from '../lib/registry.js'
import { displayNames, hubspotName, OBJECT_FIELDS, TYPE_FIELDS } from '../loader/tables.js'
import type { Spec, UnitClass } from '../plan/classify.js'
import type { PlanChange } from '../plan/types.js'
import { memberOf } from './apply-payload.js'
import { REVALUES } from './derive.js'

/** A word a POSIX shell passes through as it is. */
const PLAIN_WORD = /^[\w./:@%+=,-]+$/

/**
 * A word zsh passes through as it is too: no `#`, which zsh's extendedglob reads as a pattern (so an address with a
 * unit, such as `property:x/y#label`, is quoted), and no `=` first, which zsh expands to a command's path.
 */
const PLAIN_ARGUMENT = /^[\w./:@%+,-][\w./:@%+=,-]*$/

export type Disposition = 'none' | 'hold' | 'write' | 'note'

export const DISPOSITION: Record<UnitClass, Disposition> = {
  converged: 'none',
  'config-change': 'write',
  drift: 'hold',
  conflict: 'hold',
  diverged: 'hold',
  add: 'write',
  remove: 'write',
  keep: 'note',
}

/**
 * The definition fields an observation captures, by what it read. A reference property captures only its options,
 * and an unsupported property neither hasUniqueValue nor formField. A property captures a display field only when its
 * type shows it (propertyCaptured).
 */
export const CAPTURED = {
  object: [...OBJECT_FIELDS] as string[],
  group: ['label'],
  pipeline: ['label', 'displayOrder', 'stages'],
  association: ['label', 'inverseLabel'],
  stage: ['label', 'probability', 'ticketState', 'state'],
  property: PROPERTY_FIELDS.filter((field) => field !== 'options') as string[],
  unsupported: ['label', 'group', 'type', 'fieldType', 'description'],
}

/** The fields a managed property's observation captures: CAPTURED.property less the display fields its type lacks. */
export function propertyCaptured(type: unknown): string[] {
  return CAPTURED.property.filter(
    (field) => !Object.hasOwn(TYPE_FIELDS, field) || TYPE_FIELDS[field]?.includes(type as string),
  )
}

/**
 * An observation's spec: it owns every field it captures, and one it left out holds its default, or null, which
 * differs from any value config states. Options, when passed, are as captured.
 */
export function observedSpec(
  fields: readonly string[],
  definition: Record<string, unknown>,
  options?: IROption[],
): Spec {
  const spec: Spec = { fields: Object.fromEntries(fields.map((field) => [field, capturedValue(definition, field)])) }
  return options === undefined ? spec : { ...spec, options }
}

/** The spec of a resource an observation captured. A property owns its options, none when it has none. */
export function capturedSpec(resource: IRResource): Spec {
  const definition = resource.definition ?? {}
  if (resource.type !== 'property') {
    return observedSpec(CAPTURED[resource.type as 'object' | 'group' | 'pipeline' | 'stage'], definition)
  }
  const options = (definition.options as IROption[] | undefined) ?? []
  return observedSpec(resource.managed ? propertyCaptured(definition.type) : [], definition, options)
}

/** The fields config owns on a resource that exists: those it states, less those ignoreChanges released on create. */
export function ownedFields(resource: IRResource): Record<string, unknown> {
  const ignored = new Set(resource.lifecycle?.ignoreChanges)
  return Object.fromEntries(Object.entries(resource.definition ?? {}).filter(([field]) => !ignored.has(field)))
}

/** Definition fields as classify takes them: options apart, present only when stated. */
export function specOf(fields: Record<string, unknown>): Spec {
  const { options, ...rest } = fields
  return options === undefined ? { fields: rest } : { fields: rest, options: options as IROption[] }
}

// `object:<k>` names k itself; `group:<k>/<g>`, `property:<k>/<p>`, `pipeline:<k>/<p>` and `stage:<k>/<p>/<s>` are
// under k.
export function objectOf(address: Address): string {
  const { type, path } = parseAddress(address)
  return type === 'object' ? path : path.slice(0, path.indexOf('/'))
}

/** The path after the object: a stage's is `<pipeline>/<stage>`; see stageIdOf for its own ID. */
export function nameOf(address: Address): string {
  const { type, path } = parseAddress(address)
  return type === 'object' ? path : path.slice(path.indexOf('/') + 1)
}

/** The pipeline a stage address is under, `pipeline:<k>/<p>`. */
export function pipelineOf(stage: Address): Address {
  return `pipeline:${stage.slice('stage:'.length, stage.lastIndexOf('/'))}`
}

/**
 * The tombstone address that covers `address`, if removed.ts holds one: its custom object's for anything on a custom
 * object, else its pipeline's for a stage. Deleting or releasing that resource takes `address` along.
 */
export function coverOf(tombstones: Record<Address, unknown>, address: Address): Address | undefined {
  const { type } = parseAddress(address)
  if (type === 'object') {
    return undefined
  }
  const object = `object:${objectOf(address)}`
  if (Object.hasOwn(tombstones, object)) {
    return object
  }
  // HubSpot removes an association with either of its objects.
  const other = type === 'association' ? `object:${pairOf(address)[1]}` : undefined
  if (other !== undefined && Object.hasOwn(tombstones, other)) {
    return other
  }
  return type === 'stage' && Object.hasOwn(tombstones, pipelineOf(address)) ? pipelineOf(address) : undefined
}

/** A pipeline's or stage's own ID: the last segment of its address. */
export function ownId(address: Address): string {
  return address.slice(address.lastIndexOf('/') + 1)
}

/**
 * A resource's own name, what its portal name defaults to and a title shows: a stage's own ID, an association's
 * internal name, otherwise the name in its address.
 */
export function shownName(address: Address): string {
  const { type } = parseAddress(address)
  return type === 'stage' || type === 'association' ? ownId(address) : nameOf(address)
}

/**
 * The portal name an address resolves to on a target: its name override, else its own name. A stage's is its stage ID;
 * its pipeline's ID is the pipeline address's.
 */
export function resolvedName(overrides: Record<string, Override>, address: Address): string {
  // An own key only: an address such as 'constructor' must not find Object.prototype.
  const override = Object.hasOwn(overrides, address) ? overrides[address] : undefined
  return (override?.skip === true ? undefined : override?.name) ?? shownName(address)
}

/** The resource types HubSpot purges on delete, with no archive and no restore (observed 2026-10-01 and 2026-10-05). */
export const PURGED_TYPES: ReadonlySet<string> = new Set(['pipeline', 'stage', 'association'])

/** What a title calls an association: a label, or the plain association of its pair when it has none. */
export function associationNoun(definition: Record<string, unknown> | undefined): string {
  return typeof definition?.label === 'string' ? 'association label' : 'plain association'
}

/**
 * Where a title places a resource after its name: its pipeline and object for a stage, its pair for an association, its
 * object for the rest.
 */
export function placeOf(address: Address): string {
  const { type } = parseAddress(address)
  if (type === 'object') {
    return ''
  }
  if (type === 'association') {
    const [from, to] = pairOf(address)
    return ` between ${from} and ${to}`
  }
  const pipeline = type === 'stage' ? ` of pipeline ${ownId(pipelineOf(address))}` : ''
  return `${pipeline} on ${objectOf(address)}`
}

/** How a title words a field a step sets: a field whose change rewrites or recounts record values says so. */
export function fieldWords(unit: string): string {
  if (unit === 'stages') {
    return 'the stage order'
  }
  return REVALUES.has(unit) ? `${unit} (the effect on existing values is not checked)` : unit
}

/** What a title adds to the delete of a pipeline or stage: HubSpot purges both (observed 2026-10-01). */
export const PURGED = '; it cannot be restored'

/**
 * What a title adds to the delete of a purged resource: for an association, also what records lose, by the labels it
 * shows (a label's delete takes that labelled association from every record; a plain association's, every association
 * between records of the two objects). Short, as a title holds 160 characters.
 */
export function purgedText(address: Address, values: Record<string, unknown> | undefined): string {
  if (!address.startsWith('association:')) {
    return PURGED
  }
  return typeof values?.label === 'string'
    ? `${PURGED}, and records lose that label`
    : `${PURGED}, and records lose every association between them`
}

/** What a title adds to a custom object archive: the archived schema keeps none of them (observed 2026-10-05). */
export const ARCHIVED_OBJECT = '; HubSpot keeps no properties on an archived custom object'

/**
 * The names a custom object step's display, required and searchable fields hold that HubSpot will not hold when the
 * write runs: not HubSpot's own, and not one `holds` vouches for. Plan and apply share it, each with its own `holds`:
 * the portal as its read found it, and the property creates that run before the write.
 */
export function unheldNames(fields: Record<string, unknown>, holds: (name: string) => boolean): string[] {
  return displayNames(fields).filter((name) => !(hubspotName(name) || holds(name)))
}

/** What a custom object archive takes along, by count: its own properties, its groups and its pipelines. */
export interface Takes {
  groups: number
  pipelines: number
  properties: number
}

/**
 * What an archive of a custom object takes along, from HubSpot's lists as a read returned them: its properties
 * (`members`, portal group name to its unarchived properties; HubSpot's own left out of the count) and the counts
 * `listed` holds, every unarchived group and every pipeline. Plan and apply count from the same lists, and neither
 * counts from an incomplete read.
 */
export function takesOf(members: Record<string, string[]>, listed: Required<Listed>): Takes {
  const named = new Set(Object.values(members).flat())
  const own = [...named].filter((name) => !hubspotName(name))
  return { properties: own.length, groups: listed.groups, pipelines: listed.pipelines }
}

/** Whether a step's `takes` holds all three counts, each a whole number from 0 up. */
export function countsAll(takes: unknown): takes is Takes {
  if (typeof takes !== 'object' || takes === null || Array.isArray(takes)) {
    return false
  }
  return ['properties', 'groups', 'pipelines'].every((field) => {
    const count = (takes as Record<string, unknown>)[field]
    return typeof count === 'number' && Number.isInteger(count) && count >= 0
  })
}

/** A title's words for what an archive takes along: ` with its 3 properties, 1 group and 2 pipelines`. */
export function takesText(takes: Takes | undefined): string {
  if (takes === undefined) {
    return ''
  }
  const parts = [plural(takes.properties, 'property', 'properties'), plural(takes.groups, 'group')]
  return ` with its ${parts.join(', ')} and ${plural(takes.pipelines, 'pipeline')}`
}

/**
 * What an update or adopt step writes, in words, as the end of its title: `, set label, relabel option "north", add
 * option "Paused"`. `option` gives an added or removed option's words, `field` a set field's. The units stay in the
 * step's changes.
 */
export function writesTail(
  changes: PlanChange[],
  option: (change: PlanChange) => string,
  field: (unit: string) => string = (unit) => unit,
): string {
  const fields: string[] = []
  const options: string[] = []
  for (const c of changes.filter((change) => change.op === 'set')) {
    const member = memberOf(c.unit)
    if (c.unit === 'options.order') {
      options.push('reorder options')
    } else if (member?.field === 'label') {
      options.push(`relabel option "${member.value}"`)
    } else if (member?.field === 'hidden') {
      options.push(`${c.after === true ? 'hide' : 'show'} option "${member.value}"`)
    } else if (member?.field === 'description') {
      options.push(`change the description of option "${member.value}"`)
    } else {
      fields.push(field(c.unit))
    }
  }
  const listed = (op: 'add' | 'remove') => {
    const words = changes.filter((c) => c.op === op).map(option)
    return words.length > 0 ? [`${op} ${words.length === 1 ? 'option' : 'options'} ${words.join(', ')}`] : []
  }
  const parts = [
    ...(fields.length > 0 ? [`set ${fields.join(', ')}`] : []),
    ...options,
    ...listed('add'),
    ...listed('remove'),
  ]
  return parts.map((part) => `, ${part}`).join('')
}

/** The command that copies one address from a target's portal into config. */
export function pullCommand(target: string, address: Address): string {
  return `${bin} pull ${targetFlag(target)} --only ${address}`
}

/** The command that takes the portal side of one conflicting unit, keeping the rest of config. */
export function acceptCommand(target: string, address: Address, unit: string): string {
  return `${bin} pull ${targetFlag(target)} --accept ${shellWord(`${address}#${unit}`)}`
}

/** The command that takes config's side of one held unit: it writes config over what HubSpot holds. */
export function takeCommand(target: string, address: Address, unit: string): string {
  return `${bin} plan ${targetFlag(target)} --take config ${shellWord(`${address}#${unit}`)}`
}

/** One argument of a printed command, shell-quoted unless a shell passes it through as it is. */
export function shellWord(value: string): string {
  return PLAIN_ARGUMENT.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

/** `--target <name>` for a printed command. Any name is a target's, so one that is not a plain word is shell-quoted. */
export function targetFlag(target: string): string {
  return `--target ${PLAIN_WORD.test(target) ? target : `'${target.replaceAll("'", "'\\''")}'`}`
}

/** The note on an option only the target holds, which additive options keep: how to bring it into config. */
export function keptNote(target: string, address: Address): string {
  return `kept; to add it to config, run ${pullCommand(target, address)}`
}

/** Why no pull brings a kept option into config from a resource that names a shadowed portal name, and the way out. */
export function shadowedNote(target: string): string {
  return `no pull adds it to config while a name override shadows a name the resource refers to; correct or remove that override under targets.${target}.overrides`
}

/**
 * Whether a property the files do not define is outside its object's pull scope, `objects` in kalup.config.ts:
 * `include` does not name it, and it is HubSpot-defined, `exclude` names it or the object's `custom` is off. pull
 * never brings such a property into the files, whatever `--only` says, so no pull command helps it.
 */
export function outsidePull(objects: Record<string, ObjectScope>, address: Address, hubspotDefined: boolean): boolean {
  const object = objectOf(address)
  const scope = Object.hasOwn(objects, object) ? objects[object] : undefined
  return !inScope(scopeOf(scope), { name: nameOf(address), hubspotDefined })
}

/** Why no pull takes the portal side of a property outside its object's pull scope, and the way out. */
export function outOfScopeNote(
  objects: Record<string, ObjectScope>,
  address: Address,
  hubspotDefined: boolean,
): string {
  const object = objectOf(address)
  return `no pull refreshes it: it is outside the pull scope of ${object}; ${intoScope(objects, address, hubspotDefined)} in kalup.config.ts to take the portal side with pull`
}

/**
 * How to bring a property into its object's pull scope: add it to `include`, which wins over a pattern of `exclude`.
 * A name `exclude` lists itself comes out of `exclude` instead, since validate refuses a name both hold; a custom
 * property then needs nothing more while `custom` is on.
 */
export function intoScope(objects: Record<string, ObjectScope>, address: Address, hubspotDefined: boolean): string {
  const object = objectOf(address)
  const name = nameOf(address)
  const scope = Object.hasOwn(objects, object) ? objects[object] : undefined
  if (!(scope?.exclude ?? []).includes(name)) {
    return `add '${name}' to objects.${object}.include`
  }
  const out = `remove '${name}' from objects.${object}.exclude`
  return hubspotDefined || !scopeOf(scope).custom ? `${out} and add it to objects.${object}.include` : out
}

/**
 * Whether the read found the resource naming a portal resource a name override shadows, as `shadowed:<name>`: a
 * property's group, or a property a custom object schema names. pull never writes such a resource.
 */
export function shadows({ definition = {} }: IRResource): boolean {
  const group = (definition.group as Ref | undefined)?.$ref
  const names = [
    group === undefined ? undefined : nameOf(group),
    definition.primaryDisplayProperty,
    definition.requiredProperties,
    definition.searchableProperties,
    definition.secondaryDisplayProperties,
  ].flat()
  return names.some((name) => typeof name === 'string' && name.startsWith(SHADOWED))
}

function capturedValue(definition: Record<string, unknown>, field: string): unknown {
  if (Object.hasOwn(definition, field)) {
    return definition[field]
  }
  return Object.hasOwn(DEFAULTS.definition, field) ? DEFAULTS.definition[field] : null
}

/**
 * The base an entry holds for the portal name `id`: an owning or pulled entry naming it, written by this version's
 * normalizer. Another normalizer version's base counts as absent for one cycle.
 */
export function baseFor(entry: ResourceState, address: Address, id: string): Base | undefined {
  const usable = entry.origin === 'created' || entry.origin === 'adopted' || entry.origin === 'pulled'
  if (!usable || entry.base === undefined || entry.id !== id) {
    return undefined
  }
  const kind = parseAddress(address).type as keyof typeof NORM_VERSIONS
  if (!Object.hasOwn(NORM_VERSIONS, kind) || (entry.normVersion ?? NORM_VERSIONS[kind]) !== NORM_VERSIONS[kind]) {
    return undefined
  }
  return entry.base
}
