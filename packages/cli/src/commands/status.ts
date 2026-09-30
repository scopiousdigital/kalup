// kalup status: is the config valid, and for each target: is the key set, does the portal guard pass, which read
// scopes does the key hold (one list call per scope, a 403 is the missing scope), which key apply writes with and the
// write scopes it needs, and what the pinned portal's state file says: its lineage and serial and the last apply. The
// write key is never resolved or sent, as by every read command, and no request could check a write scope. State is
// read, never written. A problem on one target is one line and one issue, never the end of the command; the exit code
// sums them up at the end.
import { isAbsolute, relative, sep } from 'node:path'
import type { IR, Loaded, TargetState } from '@kalup/engine'
import {
  bin,
  createHttp,
  type ExitCode,
  exitCodes,
  guardPortal,
  type HttpClient,
  type HttpRequest,
  HubSpotApiError,
  KalupError,
  limitScope,
  type PortalInfo,
  pinWarnings,
  plural,
  policyOf,
  readScope,
  registry,
  STANDARD_OBJECTS,
  sanitize,
} from '@kalup/engine'
import { defaultKeyVariable, resolveReadKey } from '../lib/auth.js'
import type { Issue } from '../lib/output.js'
import { FileStateStore, stateDir } from '../lib/state.js'
import { version } from '../version.js'
import type { Context, Result } from './context.js'
import { type ScopeLine, scopeLines } from './init.js'
import { check } from './validate.js'

export interface ScopeCheck {
  /** The issue code when the probe failed for a reason other than a missing scope. */
  error?: string
  /** What needs it: the object name for a standard object scope, `object:<name>` addresses for the custom scope. */
  neededFor: string[]
  ok: boolean
  scope: string
}

export interface TargetStatus {
  account?: PortalInfo
  /** `failed`: the portal answered and refused the key or the request. `unreachable`: no response at all. */
  check: 'ok' | 'missing-key' | 'unreachable' | 'failed' | 'mismatch'
  /** Present on the target defaultTarget names: the one pull, plan and snapshot use without --target. */
  default?: true
  /** The variable the read key is read from. Never its value. */
  keyVariable: string
  name: string
  portalId: number
  /**
   * Whether apply will need a saved plan: the config's `protected`, or when the config is silent, true on every account
   * type but a test portal, a sandbox and an app developer account. Absent until the portal answered.
   */
  protected?: boolean
  /** `default` when the config does not set `protected` and the account type decided it. */
  protectedBy?: 'config' | 'default'
  /** The first issue's message when `check` is not ok. */
  reason?: string
  scopes: ScopeCheck[]
  /** The state file of the pinned portal, read and never written. */
  state: StateStatus
  /**
   * The variable apply takes the write key from, never its value: `credentials.write`, else the read key's. `separate`
   * when the target names its own. Status never resolves or sends the write key.
   */
  write: { keyVariable: string; separate: boolean }
}

export interface StateStatus {
  /** The issue code when the file could not be read, E_STATE_INVALID. */
  error?: string
  exists: boolean
  /** The last apply the file records. `running` means an apply did not finish. */
  lastApply?: Pick<NonNullable<TargetState['lastApply']>, 'at' | 'outcome' | 'planId'>
  lineage?: string
  path: string
  serial?: number
}

export interface StatusData {
  config: { valid: true; counts: { objects: number; properties: number; groups: number } }
  /** The crm.objects read scope init recommends for plan's property limit check. Not checked: status sends no probe. */
  recommended: { scope: string; neededFor: string[] }
  targets: TargetStatus[]
  /** The write scopes apply needs on the write key besides the read scopes. Not checked: no request can. */
  writeScopes: ScopeLine[]
}

export async function status(ctx: Context): Promise<Result<StatusData>> {
  const { root, loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) {
    throw new KalupError(issues.slice(0, 3), exitCodes.invalid)
  }
  const found: Issue[] = [...warnings]
  const warn = (message: string): void => {
    if (!found.some((issue) => issue.message === message)) {
      found.push({ code: 'W_RATE_HEADERS', message })
    }
  }
  const names = ctx.flags.target === undefined ? Object.keys(loaded.config.targets) : [ctx.flags.target]
  const targets: TargetStatus[] = []
  for (const name of names) {
    // biome-ignore lint/performance/noAwaitInLoops: serial on purpose, one portal at a time for HubSpot's rate limits and target order
    targets.push(await checkTarget(root, name, loaded, found, warn))
  }
  found.push(...pinWarnings(Object.values(registry)))

  const counts = {
    objects: Object.keys(loaded.config.objects).length,
    properties: count(loaded.ir, 'property'),
    groups: count(loaded.ir, 'group'),
  }
  const recommended = {
    scope: limitScope(Object.keys(loaded.config.objects)),
    neededFor: ['the property limit check in plan'],
  }
  const writeScopes = scopeLines(Object.keys(loaded.config.objects), 'write')
  const exitCode = exitCodeOf(targets)
  const lines = [
    `${bin} ${version}`,
    `Config: valid (${plural(counts.objects, 'object')}, ${plural(counts.properties, 'property', 'properties')}, ${plural(counts.groups, 'group')})`,
    ...targets.flatMap((t) => describe(root, t, recommended.scope, writeScopes)),
  ]
  return {
    data: { config: { valid: true, counts }, recommended, targets, writeScopes },
    issues: found,
    exitCode,
    text: `${lines.join('\n')}\n`,
  }
}

async function checkTarget(
  root: string,
  name: string,
  loaded: Loaded,
  issues: Issue[],
  warn: (message: string) => void,
): Promise<TargetStatus> {
  const target = loaded.config.targets[name] ?? {}
  const keyVariable = target.credentials?.read.env ?? defaultKeyVariable
  const writeVariable = target.credentials?.write?.env ?? keyVariable
  const out: TargetStatus = {
    name,
    ...(name === loaded.config.defaultTarget ? { default: true as const } : {}),
    portalId: target.portalId ?? 0,
    keyVariable,
    check: 'ok',
    scopes: [],
    state: stateOf(root, target.portalId ?? 0, name, issues),
    write: { keyVariable: writeVariable, separate: writeVariable !== keyVariable },
  }
  let http: HttpClient
  try {
    http = createHttp({ key: resolveReadKey(target, root).key, warn })
  } catch (error) {
    // Only a missing key is this target's problem. An unreadable .env is the project's, and ends the command.
    if (!(error instanceof KalupError)) {
      throw error
    }
    return fail(out, 'missing-key', error, issues)
  }
  try {
    out.account = await guardPortal(http, { name, portalId: out.portalId, variable: out.keyVariable })
  } catch (error) {
    return fail(out, guardFailure(error), error, issues)
  }
  out.protected = policyOf(target, out.account.accountType).protected
  out.protectedBy = target.protected === undefined ? 'default' : 'config'
  for (const probe of probes(loaded)) {
    // biome-ignore lint/performance/noAwaitInLoops: serial on purpose, one probe at a time keeps inside HubSpot's rate limits
    out.scopes.push(await checkScope(http, probe, issues))
  }
  return out
}

// The list call for one scope. A 403 means the key lacks the scope; any other failure also records its code.
async function checkScope(http: HttpClient, probe: Probe, issues: Issue[]): Promise<ScopeCheck> {
  const result: ScopeCheck = { scope: probe.scope, ok: true, neededFor: probe.neededFor }
  try {
    await http.request(probe.request)
  } catch (error) {
    const known = error instanceof KalupError ? error.issues : [unreachable(error)]
    issues.push(...known)
    result.ok = false
    if (!(error instanceof HubSpotApiError && error.status === 403)) {
      result.error = known[0]?.code
    }
  }
  return result
}

// The pinned portal's state file as status reports it. An unreadable one is this target's issue, not the command's end.
function stateOf(root: string, portalId: number, name: string, issues: Issue[]): StateStatus {
  const store = FileStateStore(stateDir(root))
  const out: StateStatus = { path: store.path(portalId), exists: false }
  try {
    const state = store.read(portalId, name)
    if (state === null) {
      return out
    }
    const last = state.lastApply
    return {
      ...out,
      exists: true,
      lineage: state.lineage,
      serial: state.serial,
      ...(last ? { lastApply: { planId: last.planId, at: last.at, outcome: last.outcome } } : {}),
    }
  } catch (error) {
    if (!(error instanceof KalupError)) {
      throw error
    }
    issues.push(...error.issues)
    return { ...out, exists: true, error: error.issues[0]?.code }
  }
}

function guardFailure(error: unknown): TargetStatus['check'] {
  if (error instanceof KalupError && error.issues[0]?.code === 'E_TARGET_PORTAL_MISMATCH') {
    return 'mismatch'
  }
  return error instanceof HubSpotApiError ? 'failed' : 'unreachable'
}

function fail(target: TargetStatus, outcome: TargetStatus['check'], error: unknown, issues: Issue[]): TargetStatus {
  const found = error instanceof KalupError ? error.issues : [unreachable(error)]
  issues.push(...found)
  target.check = outcome
  target.reason = found[0]?.message
  return target
}

// The worst outcome decides: a portal mismatch needs a person, any other failed check or probe is an error.
function exitCodeOf(targets: TargetStatus[]): ExitCode {
  if (targets.some((t) => t.check === 'mismatch')) {
    return exitCodes.humanRequired
  }
  const broken = targets.some(
    (t) => t.check !== 'ok' || t.scopes.some((s) => s.error !== undefined) || t.state.error !== undefined,
  )
  return broken ? exitCodes.error : exitCodes.done
}

// Anything that is not a typed error, a request that never got a response for example, sanitized and with no key.
function unreachable(error: unknown): Issue {
  return { code: 'E_UNREACHABLE', message: sanitize(error instanceof Error ? error.message : String(error)) }
}

interface Probe {
  neededFor: string[]
  request: HttpRequest
  scope: string
}

// One properties list per read scope the standard objects in scope need (communications and postal mail share one,
// listed with the first of them), and one schemas list when any custom object is in scope. An object in scope is
// custom when its name is not a standard object's, so a custom object named in config before its first pull (no
// object file yet) is checked under the custom scope too.
function probes(loaded: Loaded): Probe[] {
  const out = new Map<string, Probe>()
  const custom: string[] = []
  for (const object of Object.keys(loaded.config.objects)) {
    if (!STANDARD_OBJECTS.has(object)) {
      custom.push(`object:${object}`)
      continue
    }
    const scope = readScope(registry.property, object)
    const probe = out.get(scope)
    if (probe !== undefined) {
      probe.neededFor.push(object)
      continue
    }
    out.set(scope, {
      scope,
      neededFor: [object],
      request: { type: 'property', path: 'list', params: { objectType: object } },
    })
  }
  const list = [...out.values()]
  if (custom.length > 0) {
    list.push({ scope: registry.object.scopes.read[0], neededFor: custom, request: { type: 'object', path: 'list' } })
  }
  return list
}

function describe(root: string, t: TargetStatus, recommended: string, writeScopes: ScopeLine[]): string[] {
  // The mark sits beside the name: after the protection note, "default" would read as the protection's source.
  const head = `Target ${t.name}${t.default ? ' (defaultTarget)' : ''}`
  if (t.check === 'unreachable') {
    return [`${head}: unreachable, ${t.reason}`, writeLine(t, writeScopes), stateLine(root, t.state)]
  }
  if (t.check !== 'ok') {
    return [`${head}: ${t.reason}`, writeLine(t, writeScopes), stateLine(root, t.state)]
  }
  const a = t.account
  const scopes = t.scopes.map(scopeText)
  const why = t.protectedBy === 'default' ? ` (${a?.accountType} account, default)` : ''
  return [
    `${head}: portal ${t.portalId} matches, ${a?.accountType}, ${a?.uiDomain}, ${a?.timeZone}, protected: ${t.protected ? 'yes' : 'no'}${why}`,
    `  Scopes: ${scopes.length > 0 ? scopes.join(', ') : 'none needed'}`,
    `  Also recommended: ${recommended}, not checked (the property limit check in plan)`,
    writeLine(t, writeScopes),
    stateLine(root, t.state),
  ]
}

// The key apply writes with and the write scopes it needs besides the read scopes. Neither is checked.
function writeLine(t: TargetStatus, writeScopes: ScopeLine[]): string {
  const scopes = writeScopes.map((s) => s.scope).join(', ')
  const needs = t.write.separate ? `, which needs the read scopes and ${scopes}` : `, which also needs ${scopes}`
  return `  Write: apply uses ${t.write.keyVariable}${scopes === '' ? '' : `${needs}, not checked`}`
}

// The state file, relative to the project when it lives there, its lineage and serial, and the last apply.
function stateLine(root: string, state: StateStatus): string {
  const rel = relative(root, state.path)
  const path = rel.startsWith('..') || isAbsolute(rel) ? state.path : rel.split(sep).join('/')
  if (state.error !== undefined) {
    return `  State: ${path} cannot be read (${state.error})`
  }
  if (!state.exists) {
    return `  State: none (${path}). Last apply: never`
  }
  const last = state.lastApply
  let applied = 'never'
  if (last?.outcome === 'running') {
    applied = `plan ${sanitize(last.planId)} at ${sanitize(last.at)}: an apply did not finish; run ${bin} plan`
  } else if (last) {
    applied = `plan ${sanitize(last.planId)} at ${sanitize(last.at)}, ${last.outcome}`
  }
  return `  State: ${path}, lineage ${state.lineage}, serial ${state.serial}. Last apply: ${applied}`
}

function scopeText(s: ScopeCheck): string {
  if (s.ok) {
    return `${s.scope} ok`
  }
  return s.error ? `${s.scope} failed (${s.error})` : `${s.scope} missing (needed for ${s.neededFor.join(', ')})`
}

function count(ir: IR, type: string): number {
  return Object.values(ir.resources).filter((resource) => resource.type === type).length
}
