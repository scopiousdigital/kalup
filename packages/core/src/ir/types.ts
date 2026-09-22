// The ir/1 contract. docs/architecture.md section 3 and the spec's "The IR" section define every field here.

/** '<type>:<path>', for example 'property:companies/billing_status'. See address.ts. */
export type Address = string

/** A logical reference, allowed anywhere inside a definition where HubSpot wants an ID. */
export interface Ref {
  $ref: Address
}

export interface IR {
  generator: { name: string; version: string; frontend: 'ts' | 'portal' }
  irVersion: 1
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

export interface Binding {
  aliases?: Record<string, string>
  codec?: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'multiEnum' | 'stringArray' | 'json'
  export?: string
  key?: string
  readonly?: boolean
  required?: boolean
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
  drift?: 'hold' | 'overwrite'
  overrides?: Record<Address, IROverride>
  portalId: number
  protected?: boolean
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

/** One entry of a command's issues[], as the envelope contract defines it. */
export interface Issue {
  code: string
  configPath?: string
  docs?: string
  file?: string
  fix?: string
  humanRequired?: boolean
  line?: number
  message: string
}
