// blueprint/1 and the blueprints lock, ADR 0011. blueprint-1.schema.json and blueprints-lock-1.schema.json are their
// schemas.
import type { Address, Binding, Lifecycle, Ref } from '../ir/types.js'

/** A versioned, data-only IR fragment: groups and managed properties. */
export interface Blueprint {
  blueprintVersion: 1
  /** The author's own text: third-party, printed only to a person at a terminal. */
  description?: string
  irVersion: 1
  /** `acme/renewals`. */
  name: string
  /** `object:<key>` references the project must provide. */
  requires?: Ref[]
  resources: Record<Address, BlueprintResource>
  /** MAJOR.MINOR.PATCH with an optional pre-release. */
  version: string
}

/** A group or a managed property in IR form. No provenance, no x, never managed: false. */
export interface BlueprintResource {
  binding?: Omit<Binding, 'export'>
  definition: Record<string, unknown>
  lifecycle?: Lifecycle
  type: 'group' | 'property'
}

/** kalup/blueprints.lock.json. Tool-written. */
export interface BlueprintLock {
  /** By blueprint name. */
  blueprints: Record<string, LockEntry>
  lockVersion: 1
  /** Every `<source>@<version>` ever recorded, to its hash. */
  sources: Record<string, string>
}

export interface LockEntry {
  /** `sha256:` and the hex digest of the bytes as fetched. */
  hash: string
  /** The conflicts the last upgrade kept config's value for. */
  held: LockHeld[]
  /** The stored original: kalup/.blueprints/<name with / as -->@<version>.json. */
  original: string
  prefix: string
  /** Local address to its address in the blueprint. */
  resources: Record<Address, Address>
  /** A path relative to the project root with forward slashes, or an https URL. */
  source: string
  version: string
}

/** One unit an upgrade kept config's value of while the blueprint changed it too. */
export interface LockHeld {
  address: Address
  /** Config's value; absent when config has none. */
  local?: unknown
  /** The upstream value; absent when the blueprint has none. */
  remote?: unknown
  unit: string
}
