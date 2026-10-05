// The plan/1 contract. plan-1.schema.json is its schema; docs/architecture.md section 7 describes every field.
import type { Address, Provenance } from '../ir/types.js'
import type { IssueCode } from '../issues.js'

export interface Plan {
  /** Every address a non-blocked step depends on whose portal identity is not its logical key. */
  bindings: Record<Address, PlanBinding>
  budget: { dailyRemaining: number | null; estimatedCalls: number }
  counts: { blocked: number; destructive: number; held: number; manual: number; risky: number; safe: number }
  coverage: PlanCoverage
  format: 'plan/1'
  generator: { name: string; version: string }
  /** 'sha256:<hex>' of the config IR, display only. */
  irHash: string
  /** Owned resources the portal no longer holds. */
  missing: PlanMissing[]
  /** The normalizer version of each resource type the plan compared with. */
  /** Keyed by resource type: property, group and object always; a later type adds its own key. */
  normVersions: { [type: string]: number; group: number; object: number; property: number }
  /** Once per resource type with steps. */
  notCovered: { lines: string[]; type: string }[]
  /** Owned resources config no longer names and no tombstone removes. */
  orphans: PlanOrphan[]
  /** Non-blocked creates when accountType is STANDARD, else 0. */
  permanentNames: number
  /** 'pl_' plus the first 12 hex characters of writesHash. */
  planId: string
  preflight: { limits: LimitReading[] }
  /** null without state, never a made-up lineage. */
  stateLineage: string | null
  /** null without state. */
  stateSerial: number | null
  steps: PlanStep[]
  target: PlanTarget
  /** 'sha256:<64 hex>' of the approval context. */
  writesHash: string
}

export interface PlanTarget {
  accountType: string
  /** Effective: defaults to 'hold'. */
  adopt: 'hold' | 'overwrite'
  /** Effective: defaults to false. */
  allowDestroy: boolean
  drift: 'hold' | 'overwrite'
  name: string
  portalId: number
  /** Effective: defaults to accountType === 'STANDARD'. */
  protected: boolean
  /** The objects whose mode on this target is takeover, sorted. */
  takeover: string[]
  uiDomain: string
  /** Effective: defaults to 25. */
  yesLimit: number
}

/** name when a name override resolves the address, id for an existing custom object. */
export interface PlanBinding {
  id?: string
  name?: string
}

export interface PlanCoverage {
  complete: boolean
  excluded: Address[]
  unreadable: { object: string; scope?: string }[]
  unsupported: Address[]
}

/** One Limits Tracking reading. An unreadable reading blocks nothing. */
export type LimitReading =
  | {
      byObjectType?: { limit: number; objectTypeId: string; usage: number }[]
      key: string
      limit: number
      status: 'read'
      usage: number
    }
  | { issue: IssueCode; key: string; status: 'unreadable' }

export interface PlanOrphan {
  address: Address
  /** Names both rm commands. */
  note: string
}

export interface PlanMissing {
  address: Address
  /** null when it is not known whether HubSpot holds it archived. */
  archived: boolean | null
  archivedAt?: string
  origin: 'created' | 'adopted'
  /** The ways out, commands included. */
  resolve: string[]
}

export type PlanAction = 'create' | 'adopt' | 'update' | 'delete' | 'release' | 'manual' | 'unknown'
export type Risk = 'safe' | 'risky' | 'destructive' | 'blocked' | 'manual'
export type BlockedReason =
  | 'limit'
  | 'scope'
  | 'dependency-blocked'
  | 'no-credential'
  | 'ambiguous'
  | 'override'
  | 'unsupported'
  | 'not-owned'
  | 'policy'

export type PlanLabel = 'reverts-ui-edit' | 'overwrites-portal' | 'takeover' | 'existed-before-kalup'

export interface PlanStep {
  /** Unknown only with risk blocked. */
  action: PlanAction
  address: Address
  /** Required on every step except a manual or release one. A release has none: it sends no request. */
  api?: { family: string; version: string }
  /** Units apply records in the base because config and portal already agree on them. */
  baseUnits?: string[]
  /** Required when risk is blocked, and only then. */
  blocked?: { blocks: Address[]; detail: string; fix?: string; reason: BlockedReason }
  changes?: PlanChange[]
  /** create: the full IR definition. adopt: config-owned fields minus ignoreChanges, with config values. */
  desired?: Record<string, unknown>
  expect: PlanExpect
  fulfilment?: { disclosure: string; executor: string }
  held?: PlanHeld[]
  /** s1, s2 and on, in step order. */
  id: string
  /** Create only: set on create, released after. */
  ignoreChanges?: string[]
  labels?: PlanLabel[]
  manual?: ManualStep
  notes?: PlanNote[]
  provenance?: Provenance
  risk: Risk
  /**
   * A pipeline create only: the stages it carries, in display order, each with its full definition. HubSpot refuses a
   * pipeline without a stage, so the pipeline and its config stages are created in one request.
   */
  stages?: PlanStage[]
  /** Human text from a fixed template, sanitized. */
  title: string
  /** 'public-api' for ga rows with a write path. */
  transport: string
}

/** One stage a pipeline create carries: its address and its full definition. */
export interface PlanStage {
  address: Address
  desired: Record<string, unknown>
}

/** before is the live value, after the value written. op is set for a scalar unit, add or remove for an option. */
export interface PlanChange {
  after: unknown
  before: unknown
  class: 'config-change' | 'drift' | 'conflict' | 'diverged' | 'add' | 'remove'
  op: 'set' | 'add' | 'remove'
  unit: string
}

export interface PlanHeld {
  /** The value config and the portal last agreed on, from state. Left out when state holds none, as for diverged. */
  base?: unknown
  class: 'drift' | 'conflict' | 'diverged'
  config: unknown
  live: unknown
  /**
   * portal: the command that takes the portal side, a pull or a pull --accept. Left out when no pull takes it: the
   * resource names a portal name a name override shadows (`shadowed:<name>`), or a property holds a type or fieldType
   * its builder does not take, or sits in a portal group removed.ts names; in those cases a note on the same unit says
   * why.
   */
  resolve?: { portal: string }
  unit: string
}

/** A unit kept as it is; note names the pull command. */
export interface PlanNote {
  live: unknown
  note: string
  unit: string
}

/** exists is false on a create and true on adopt, update and delete. A release may expect nothing. */
export interface PlanExpect {
  baseHash?: string
  exists?: boolean
  revisionId?: string
  values?: Record<string, unknown>
}

export interface ManualStep {
  instructions: string[]
  url: string
  verify: { kind: 'read-back' } | { kind: 'human-confirm'; prompt: string }
}
