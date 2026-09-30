// The ir/1 contract. docs/architecture.md section 3 and the spec's "The IR" section define every field here.
import type { BuilderKind } from '../grammar/types.js'
import type { IssueCode } from '../issues.js'

/** '<type>:<path>', for example 'property:companies/billing_status'. See address.ts. */
export type Address = string

/** A logical reference, allowed anywhere inside a definition where HubSpot wants an ID. */
export interface Ref {
  $ref: Address
}

export interface IR {
  generator: { name: string; version: string; frontend: 'ts' | 'portal' }
  irVersion: 1
  /** A snapshot's record of its read. Required when frontend is 'portal'. */
  observation?: IRObservation
  project: string
  resources: Record<Address, IRResource>
  targets: Record<string, IRTarget>
  tombstones: Record<Address, IRTombstone>
  x?: Record<string, unknown>
}

export interface IRResource {
  binding?: Binding
  definition?: Record<string, unknown>
  lifecycle?: Lifecycle
  lookup?: Record<string, string>
  managed: boolean
  provenance?: Provenance
  type: string
  x?: Record<string, unknown>
}

/** One enumeration option. Array index is display order. The app alias lives in binding.aliases, never here. */
export interface IROption {
  description?: string
  hidden?: boolean
  label: string
  value: string
}

export interface Binding {
  aliases?: Record<string, string>
  codec?: BuilderKind
  export?: string
  key?: string
  readonly?: boolean
  required?: boolean
  /** `.strict()` on p.enum or p.multiEnum: the app's codec throws on a value the options do not list. */
  strict?: boolean
}

/** The lifted lifecycle block with its default filled in. The grammar's LifecycleFields is the file shape. */
export interface Lifecycle {
  ignoreChanges?: string[]
  options: 'additive' | 'exact'
  preventDestroy?: boolean
  removedOptions?: string[]
}

export interface Provenance {
  blueprint: string
  hash: string
  prefix: string
  sourceAddress: Address
  version: string
}

export interface IRTarget {
  adopt?: 'hold' | 'overwrite'
  allowDestroy?: boolean
  drift?: 'hold' | 'overwrite'
  overrides?: Record<Address, IROverride>
  portalId: number
  protected?: boolean
  yesLimit?: number
}

export interface IROverride {
  definition?: Record<string, unknown>
  lookup?: Record<string, string>
  name?: string
  skip?: true
}

export interface IRTombstone {
  action: 'destroy' | 'release'
  reason?: string
}

export interface IRObservation {
  coverage: Coverage
  /** ISO 8601 in UTC. The one timestamp an ir/1 document carries. */
  observedAt: string
  target: { name: string; portalId: number }
}

/** What a read covered. Only a complete read proves that a resource is absent. */
export interface Coverage {
  /** Every object read (status read, absent or excluded) and nothing else missing. */
  complete: boolean
  /** Documented response fields Kalup does not capture, per resource type. */
  notCaptured: Record<'property' | 'group' | 'object', string[]>
  /** One entry per config object key. */
  objects: Record<string, ObjectCoverage>
  /** Custom objects in the portal that config does not name; 'unknown' when the schemas list was not read. */
  otherObjects: string[] | 'unknown'
}

/** Empty lists are left out. */
export interface ObjectCoverage {
  /** Addresses a skip override leaves out. */
  excluded?: Address[]
  /** Unreadable only. */
  issue?: IssueCode
  /** Unreadable only. */
  missingScope?: string
  /** A custom object that exists. */
  objectTypeId?: string
  /** Present properties outside the pull scope that config does not name. */
  outOfScope?: string[]
  /** Address to the portal name a name override points it at. */
  renamed?: Record<Address, string>
  /** Portal names equal to the local name of a renamed address, so not reported at it. */
  shadowed?: string[]
  status: 'read' | 'unreadable' | 'absent' | 'excluded'
  /** Present properties config names that are in a group whose name no address can hold, so not captured: unknown. */
  unaddressable?: string[]
  unsupported?: UnsupportedProperty[]
  /** A custom object HubSpot returned without a singular or plural label, its fields as returned. Not a resource. */
  unsupportedSchema?: UnsupportedSchema
}

export interface UnsupportedSchema {
  labels: { plural?: string; singular?: string }
  primaryDisplayProperty?: string
  requiredProperties?: string[]
  searchableProperties?: string[]
  secondaryDisplayProperties?: string[]
}

/**
 * A present property Kalup does not write: no builder carries its type or fieldType, or HubSpot fills its options (an
 * owner or externalOptions property). It is compared like any property but is not a resource.
 */
export interface UnsupportedProperty {
  description?: string
  /** HubSpot's flag, only when true. */
  externalOptions?: boolean
  fieldType: string
  group: Ref
  hubspotDefined: boolean
  label: string
  name: string
  options?: IROption[]
  /** As HubSpot returned it, such as `OWNER`. */
  referencedObjectType?: string
  type: string
}

/** One entry of a command's issues[], as the envelope contract defines it. */
export interface Issue {
  code: IssueCode
  configPath?: string
  docs?: string
  file?: string
  fix?: string
  humanRequired?: boolean
  line?: number
  message: string
}
