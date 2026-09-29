// kalup.state/1: .kalup/state/portal-<portalId>.json, docs/architecture.md section 5. state-1.schema.json is
// its schema, and docs/compatibility.md says what the format promises.
import stateSchema from '../../schemas/state-1.schema.json' with { type: 'json' }
import type { Address, Issue } from './types.js'
import { type JsonSchema, validateSchema } from './validate.js'

/** created and adopted entries are owned. */
export type Origin = 'created' | 'adopted' | 'reference'

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
  via?: string
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
  /** 16 lowercase hex characters, new on rebuild and rebind. */
  lineage: string
  /** The verified portal the file describes. The file holds no target name. */
  portalId: number
  resources: Record<Address, ResourceState>
  serial: number
}

export interface StateStore {
  lock: (portalId: number, who: string) => Promise<{ release: () => Promise<void> }>
  read: (portalId: number) => Promise<TargetState | null>
  /** Throws when the stored serial is not expectSerial. */
  write: (portalId: number, next: TargetState, expectSerial: number | null) => Promise<void>
}

// TypeScript gives heterogeneous JSON arrays `?: undefined` members, so the literal type does not fit JsonSchema.
const STATE_SCHEMA = stateSchema as unknown as JsonSchema

/** Checks a document against state-1.schema.json. Empty when it conforms. */
export function validateState(document: unknown): Issue[] {
  return validateSchema(STATE_SCHEMA, document).map(({ path, message }) => ({
    code: 'E_STATE_SCHEMA',
    message,
    ...(path ? { configPath: path } : {}),
  }))
}
