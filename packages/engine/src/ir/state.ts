// kalup.state/1: .kalup/state/portal-<portalId>.json, docs/architecture.md section 5. state-1.schema.json is
// its schema, and docs/compatibility.md says what the format promises.
import stateSchema from '../../schemas/state-1.schema.json' with { type: 'json' }
import { bin } from '../brand.js'
import { KalupError } from '../lib/errors.js'
import { handledType } from '../lib/registry.js'
import { sanitize } from '../lib/sanitize.js'
import { holdsKey } from '../lib/secrets.js'
import { parseAddress } from './address.js'
import { stableStringify } from './serialize.js'
import type { Address, Issue } from './types.js'
import { type JsonSchema, validateSchema } from './validate.js'

/**
 * created and adopted entries are owned. pulled owns nothing: pull recorded the base of a resource no entry owned, so
 * the plan that adopts it classifies against that base.
 */
export type Origin = 'created' | 'adopted' | 'reference' | 'pulled'

/**
 * Per owned unit, the value config and portal last agreed on; possibly partial. Scalar units by field name; `options`
 * a map keyed by option value whose members hold the agreed `label`, `hidden` and `description` (a member with no
 * fields: only its membership is agreed); `optionsOrder` the agreed order of the members both sides held.
 */
export type Base = Record<string, unknown>

export interface ResourceState {
  attested?: { by: string; at: string }
  base?: Base
  baseHash?: string
  /** The portal name the entry owns. null for runbook-only types. */
  id: string | null
  normVersion?: number
  origin: Origin
  /** Units whose read-back showed HubSpot storing another value than the one sent, with both values. */
  rewrites?: Record<string, { sent: unknown; stored: unknown }>
  /**
   * An association's HubSpot type IDs in this portal, its direction's first: they name it while HubSpot's schema read
   * does not list its name yet (observed 2026-10-05: about 5 minutes after a create).
   */
  typeIds?: [number, number]
  via?: string
  /**
   * The units apply wrote within the settling window before its last write, each with when it verified the write (ISO
   * 8601 in UTC). HubSpot may serve an older copy for some minutes after a write, so a read that disagrees on such a
   * unit is settling (engine/settling.ts).
   */
  written?: Record<string, string>
  /**
   * When apply last verified a write to the resource, whatever units it named: a create, or an update or adopt that
   * sent a change (ISO 8601 in UTC). A read that does not show the resource within the settling window after it is
   * settling.
   */
  writtenAt?: string
}

export interface TargetState {
  format: 'kalup.state/1'
  lastApply?: {
    actor: string
    at: string
    outcome: 'running' | 'done' | 'partial' | 'uncertain'
    planId: string
    writesHash: string
  }
  /**
   * What a later version wrote that this one does not handle, kept apart when the file is read and written back as it
   * is: entries of resource types this version does not plan, and top-level fields it does not know. No command reads
   * it; `resources` never holds an entry of a type this version does not handle. Not a field of the file.
   */
  later?: LaterState
  /** 16 lowercase hex characters, new on rebuild and rebind. */
  lineage: string
  /** The verified portal the file describes. The file holds no target name. */
  portalId: number
  resources: Record<Address, ResourceState>
  serial: number
}

/** A later version's part of a state file, written back unchanged. */
export interface LaterState {
  fields: Record<string, unknown>
  resources: Record<Address, unknown>
}

// TypeScript gives heterogeneous JSON arrays `?: undefined` members, so the literal type does not fit JsonSchema.
const STATE_SCHEMA = stateSchema as unknown as JsonSchema

// The top-level fields this version reads, from the schema: any other is a later version's.
const STATE_FIELDS: ReadonlySet<string> = new Set(Object.keys(STATE_SCHEMA.properties ?? {}))

// The fields of an entry this version reads, from the schema.
const ENTRY_FIELDS: ReadonlySet<string> = new Set(
  Object.keys((STATE_SCHEMA.$defs?.resourceState as JsonSchema | undefined)?.properties ?? {}),
)

/** An entry with only the fields this version knows: what a rewrite keeps of it. */
export function knownFields(entry: ResourceState): ResourceState {
  return Object.fromEntries(Object.entries(entry).filter(([field]) => ENTRY_FIELDS.has(field))) as ResourceState
}

/** Checks a document against state-1.schema.json. Empty when it conforms. */
export function validateState(document: unknown): Issue[] {
  return validateSchema(STATE_SCHEMA, document).map(({ path, message }) => ({
    code: 'E_STATE_SCHEMA',
    message,
    ...(path ? { configPath: path } : {}),
  }))
}

const FORMAT = 'kalup.state/1'
const notJson = Symbol('not JSON')

/**
 * The state of `portalId` from the text of `file`, where the host keeps it. E_STATE_INVALID when the text is not JSON,
 * names a format other than kalup.state/1, does not match its schema, or describes another portal. `target` names the
 * target in the fix.
 */
export function parseState(text: string, file: string, portalId: number, target?: string): TargetState {
  const document = parseJson(text)
  if (document === notJson) {
    throw invalid(file, 'is not JSON', target)
  }
  // Another format is another version's state: never read as this one, and never rebuilt over, which would lose it.
  const format = (document as { format?: unknown } | null)?.format
  if (typeof format === 'string' && format !== FORMAT) {
    throw new KalupError({
      code: 'E_STATE_INVALID',
      message: `${file} is ${sanitize(format)}, and this version of ${bin} reads ${FORMAT}.`,
      file,
      fix: `use the version of ${bin} that wrote it, or a newer one`,
    })
  }
  const issues = validateState(document)
  if (issues.length > 0) {
    const [first] = issues
    const at = first?.configPath ? ` at ${first.configPath}` : ''
    throw invalid(file, `does not match ${FORMAT}${at}: ${first?.message}`, target)
  }
  const state = document as TargetState
  if (state.portalId !== portalId) {
    throw invalid(file, `describes portal ${state.portalId}, not portal ${portalId}`, target)
  }
  return withLater(state)
}

// The state with what a later version wrote moved to `later`: the entries of types this version does not handle and
// the top-level fields it does not know.
function withLater(document: TargetState): TargetState {
  const fields = Object.fromEntries(Object.entries(document).filter(([key]) => !STATE_FIELDS.has(key)))
  const entries = Object.entries(document.resources)
  const resources = Object.fromEntries(entries.filter(([address]) => !handled(address)))
  const known = Object.fromEntries(Object.entries(document).filter(([key]) => STATE_FIELDS.has(key))) as TargetState
  const state: TargetState = { ...known, resources: Object.fromEntries(entries.filter(([a]) => handled(a))) }
  if (Object.keys(fields).length + Object.keys(resources).length > 0) {
    state.later = { fields, resources }
  }
  return state
}

function handled(address: Address): boolean {
  return handledType(parseAddress(address).type)
}

/**
 * The text a host writes for `state`: what a later version wrote merged back as it was, checked against kalup.state/1,
 * one JSON document and a newline. Throws, writing nothing, when the document does not match the schema or a string in
 * it, a key or a value, holds anything shaped like a HubSpot key.
 */
export function stateText(state: TargetState): string {
  const { later, ...known } = state
  const document = {
    ...later?.fields,
    ...known,
    resources: { ...later?.resources, ...known.resources },
  }
  const problems = validateState(document)
  if (problems.length > 0) {
    throw new Error(`refusing to save state that does not match kalup.state/1: ${problems[0]?.message}`)
  }
  if (strings(document).some((value) => holdsKey(value))) {
    throw new Error('refusing to save state that holds a key')
  }
  return `${stableStringify(document)}\n`
}

// Every string in a JSON value, the keys of its objects included.
function strings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap(strings)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, field]) => [key, ...strings(field)])
  }
  return []
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return notJson
  }
}

function invalid(file: string, why: string, target = '<target>'): KalupError {
  // The file's base name under either separator, as the host's path module gives it.
  const name = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1)
  return new KalupError({
    code: 'E_STATE_INVALID',
    message: `${file} ${why}.`,
    file,
    fix: `rename ${name}.bak, the state before its last save, into its place if it reads; else move the file away and run ${bin} state rebuild --target ${target}`,
  })
}

/** An association address written from the other side: `association:<b>/<a>/<name>` for `association:<a>/<b>/<name>`. */
export function reversedAssociation(address: Address): Address | undefined {
  if (!address.startsWith('association:')) {
    return undefined
  }
  const [from, to, ...name] = address.slice('association:'.length).split('/')
  return `association:${to}/${from}/${name.join('/')}`
}

/**
 * State with each association entry under the address `held` gives the association. An association's identity is its
 * name, and its direction is only how config writes it, so an entry at the reversed address moves to the held one, its
 * labels and type IDs swapped; one the held address has an entry of the same name for already is dropped. Every save
 * of the state so read keeps the move.
 */
export function followAssociations<T extends TargetState | null>(state: T, held: (address: Address) => boolean): T {
  if (state === null) {
    return state
  }
  const resources = { ...state.resources }
  let moved = false
  for (const [address, entry] of Object.entries(state.resources)) {
    const reversed = reversedAssociation(address)
    if (reversed === undefined || held(address) || !held(reversed)) {
      continue
    }
    const there = Object.hasOwn(resources, reversed) ? resources[reversed] : undefined
    if (there !== undefined && there.id !== entry.id) {
      continue
    }
    delete resources[address]
    resources[reversed] = there ?? reversedEntry(entry)
    moved = true
  }
  return moved ? { ...state, resources } : state
}

// An association's entry as its other direction holds it: one side's label is the other side's inverse label.
function reversedEntry(entry: ResourceState): ResourceState {
  const { base, rewrites, typeIds, written, ...rest } = entry
  const out: ResourceState = { ...rest }
  if (base !== undefined) {
    out.base = swapLabels(base)
  }
  if (rewrites !== undefined) {
    out.rewrites = swapLabels(rewrites)
  }
  if (written !== undefined) {
    out.written = swapLabels(written)
  }
  if (typeIds !== undefined) {
    out.typeIds = [typeIds[1], typeIds[0]]
  }
  return out
}

function swapLabels<V>(units: Record<string, V>): Record<string, V> {
  const { label, inverseLabel, ...rest } = units
  return {
    ...rest,
    ...(inverseLabel === undefined ? {} : { label: inverseLabel }),
    ...(label === undefined ? {} : { inverseLabel: label }),
  }
}

/** The type IDs state records per association address, which name a label HubSpot's schema read does not list yet. */
export function associationIds(state: TargetState | null): Record<Address, [number, number]> {
  const out: Record<Address, [number, number]> = {}
  for (const [address, entry] of Object.entries(state?.resources ?? {})) {
    if (entry.typeIds !== undefined && address.startsWith('association:')) {
      out[address] = entry.typeIds
    }
  }
  return out
}
