// The ir/1 contract. docs/architecture.md section 3 and the spec's "The IR" section define every field here.

/** '<type>:<path>', for example 'property:companies/billing_status'. See address.ts. */
export type Address = string

/** A logical reference, allowed anywhere inside a definition where HubSpot wants an ID. */
export interface Ref {
  $ref: Address
}

export interface IR {
  irVersion: 1
  project: string
  generator: { name: string; version: string; frontend: 'ts' | 'portal' }
  resources: Record<Address, IRResource>
  targets: Record<string, IRTarget>
  tombstones: Record<Address, IRTombstone>
  x?: Record<string, unknown>
}

export interface IRResource {
  type: string
  managed: boolean
  definition?: Record<string, unknown>
  lookup?: Record<string, string>
  binding?: Binding
  lifecycle?: Lifecycle
  provenance?: Provenance
  x?: Record<string, unknown>
}

export interface Binding {
  key?: string
  codec?: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'multiEnum' | 'stringArray' | 'json'
  aliases?: Record<string, string>
  required?: boolean
  readonly?: boolean
  export?: string
}

/** The lifted lifecycle block with its default filled in. The grammar's LifecycleFields is the file shape. */
export interface Lifecycle {
  options: 'additive' | 'exact'
  removedOptions?: string[]
  ignoreChanges?: string[]
  preventDestroy?: boolean
}

export interface Provenance {
  blueprint: string
  version: string
  sourceAddress: Address
  prefix: string
  hash: string
}

export interface IRTarget {
  portalId: number
  protected?: boolean
  drift?: 'hold' | 'overwrite'
  overrides?: Record<Address, IROverride>
}

export interface IROverride {
  skip?: true
  name?: string
  definition?: Record<string, unknown>
  lookup?: Record<string, string>
}

export interface IRTombstone {
  action: 'destroy' | 'release'
  reason?: string
}

/** One entry of a command's issues[], as the envelope contract defines it. */
export interface Issue {
  code: string
  message: string
  file?: string
  line?: number
  configPath?: string
  fix?: string
  docs?: string
  humanRequired?: boolean
}
