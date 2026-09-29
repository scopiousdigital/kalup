// kalup.state/1: .kalup/state/portal-<portalId>.json, docs/architecture.md section 5. state-1.schema.json is
// its schema, and docs/compatibility.md says what the format promises.
import stateSchema from '../../schemas/state-1.schema.json' with { type: 'json' }
import { bin } from '../brand.js'
import { KalupError } from '../lib/errors.js'
import { sanitize } from '../lib/sanitize.js'
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
  return state
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
