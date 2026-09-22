// kalup status: is the config valid, and for each target: is the key set, does the portal guard pass, which read
// scopes does the key hold (one list call per scope, a 403 is the missing scope), is there state. A problem on one
// target is one line and one issue, never the end of the command; the exit code sums them up at the end.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { IR, Loaded } from '@kalup/core'
import {
  createHttp,
  defaultKeyVariable,
  exitCodes,
  guardPortal,
  type HttpRequest,
  HubSpotApiError,
  type Issue,
  KalupError,
  type PortalInfo,
  registry,
  resolveReadKey,
  sanitize,
} from '../lib/index.js'
import { STANDARD_OBJECTS } from '../lib/pull/index.js'
import { bin, version } from '../usage.js'
import type { Context, Result } from './run.js'
import { check } from './validate.js'

export interface ScopeCheck {
  scope: string
  ok: boolean
  /** What needs it: the object name for a standard object scope, `object:<name>` addresses for the custom scope. */
  neededFor: string[]
  /** The issue code when the probe failed for a reason other than a missing scope. */
  error?: string
}

export interface TargetStatus {
  name: string
  portalId: number
  /** The variable the read key is read from. Never its value. */
  keyVariable: string
  /** `failed`: the portal answered and refused the key or the request. `unreachable`: no response at all. */
  check: 'ok' | 'missing-key' | 'unreachable' | 'failed' | 'mismatch'
  /** The first issue's message when `check` is not ok. */
  reason?: string
  account?: PortalInfo
  scopes: ScopeCheck[]
  /** Whether .kalup/state/<target>.json exists. This version never reads it, so last apply is always "never". */
  state: 'none' | 'present'
}

export interface StatusData {
  config: { valid: true; counts: { objects: number; properties: number; groups: number } }
  targets: TargetStatus[]
}

const pinWarningDays = 90

export async function status(ctx: Context): Promise<Result<StatusData>> {
  const { root, loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) throw new KalupError(issues.slice(0, 3), exitCodes.invalid)
  const found: Issue[] = [...warnings]
  const warn = (message: string): void => {
    if (!found.some((issue) => issue.message === message)) found.push({ code: 'W_RATE_HEADERS', message })
  }
  const names = ctx.flags.target === undefined ? Object.keys(loaded.config.targets) : [ctx.flags.target]
  const targets: TargetStatus[] = []
  for (const name of names) targets.push(await checkTarget(root, name, loaded, found, warn))
  found.push(...pinWarnings())

  const counts = {
    objects: Object.keys(loaded.config.objects).length,
    properties: count(loaded.ir, 'property'),
    groups: count(loaded.ir, 'group'),
  }
  const broken = targets.some((t) => t.check !== 'ok' || t.scopes.some((s) => s.error !== undefined))
  const mismatch = targets.some((t) => t.check === 'mismatch')
  const exitCode = mismatch ? exitCodes.humanRequired : broken ? exitCodes.error : exitCodes.done
  const lines = [
    `${bin} ${version}`,
    `Config: valid (${counts.objects} objects, ${counts.properties} properties, ${counts.groups} groups)`,
    ...targets.flatMap(describe),
  ]
  return { data: { config: { valid: true, counts }, targets }, issues: found, exitCode, text: `${lines.join('\n')}\n` }
}

async function checkTarget(
  root: string,
  name: string,
  loaded: Loaded,
  issues: Issue[],
  warn: (message: string) => void,
): Promise<TargetStatus> {
  const target = loaded.config.targets[name] ?? {}
  const status: TargetStatus = {
    name,
    portalId: target.portalId ?? 0,
    keyVariable: target.credentials?.read.env ?? defaultKeyVariable,
    check: 'ok',
    scopes: [],
    state: existsSync(join(root, '.kalup', 'state', `${name}.json`)) ? 'present' : 'none',
  }
  let key: string
  try {
    key = resolveReadKey(target, root).key
  } catch (error) {
    // Only a missing key is this target's problem. An unreadable .env is the project's, and ends the command.
    if (!(error instanceof KalupError)) throw error
    return fail(status, 'missing-key', error, issues)
  }
  const http = createHttp({ key, warn })
  try {
    status.account = await guardPortal(http, { name, portalId: status.portalId, variable: status.keyVariable })
  } catch (error) {
    const code = error instanceof KalupError ? error.issues[0]?.code : undefined
    const check =
      code === 'E_TARGET_PORTAL_MISMATCH' ? 'mismatch' : error instanceof HubSpotApiError ? 'failed' : 'unreachable'
    return fail(status, check, error, issues)
  }
  for (const { scope, neededFor, request } of probes(loaded)) {
    const result: ScopeCheck = { scope, ok: true, neededFor }
    try {
      await http.request(request)
    } catch (error) {
      const known = error instanceof KalupError ? error.issues : [unreachable(error)]
      issues.push(...known)
      result.ok = false
      if (!(error instanceof HubSpotApiError && error.status === 403)) result.error = known[0]?.code
    }
    status.scopes.push(result)
  }
  return status
}

function fail(status: TargetStatus, check: TargetStatus['check'], error: unknown, issues: Issue[]): TargetStatus {
  const found = error instanceof KalupError ? error.issues : [unreachable(error)]
  issues.push(...found)
  status.check = check
  status.reason = found[0]?.message
  return status
}

// Anything that is not a typed error, a request that never got a response for example, sanitized and with no key.
function unreachable(error: unknown): Issue {
  return { code: 'E_UNREACHABLE', message: sanitize(error instanceof Error ? error.message : String(error)) }
}

interface Probe {
  scope: string
  neededFor: string[]
  request: HttpRequest
}

// One properties list per standard object in scope, and one schemas list when any custom object is in scope. An
// object in scope is custom when its name is not a standard object's, so a custom object named in config before
// its first pull (no object file yet) is checked under the custom scope too.
function probes(loaded: Loaded): Probe[] {
  const out: Probe[] = []
  const custom: string[] = []
  for (const object of Object.keys(loaded.config.objects)) {
    if (!STANDARD_OBJECTS.has(object)) {
      custom.push(`object:${object}`)
      continue
    }
    const scope = registry.property.scopes.read[0].replace('{object}', object)
    out.push({
      scope,
      neededFor: [object],
      request: { type: 'property', path: 'list', params: { objectType: object } },
    })
  }
  if (custom.length > 0) {
    out.push({ scope: registry.object.scopes.read[0], neededFor: custom, request: { type: 'object', path: 'list' } })
  }
  return out
}

function describe(t: TargetStatus): string[] {
  if (t.check === 'unreachable') return [`Target ${t.name}: unreachable, ${t.reason}`]
  if (t.check !== 'ok') return [`Target ${t.name}: ${t.reason}`]
  const a = t.account
  const scopes = t.scopes.map((s) =>
    s.ok
      ? `${s.scope} ok`
      : s.error
        ? `${s.scope} failed (${s.error})`
        : `${s.scope} missing (needed for ${s.neededFor.join(', ')})`,
  )
  return [
    `Target ${t.name}: portal ${t.portalId} matches, ${a?.accountType}, ${a?.uiDomain}, ${a?.timeZone}`,
    `  Scopes: ${scopes.length > 0 ? scopes.join(', ') : 'none needed'}`,
    `  State: ${t.state}. Last apply: never`,
  ]
}

function count(ir: IR, type: string): number {
  return Object.values(ir.resources).filter((resource) => resource.type === type).length
}

/** One warning per API family whose pin expires within 90 days. `expires` is a month; its first day counts. */
function pinWarnings(): Issue[] {
  const now = Date.now()
  const out: Issue[] = []
  const seen = new Set<string>()
  for (const row of Object.values(registry)) {
    const pin = `${row.family} ${row.version}`
    const expires = new Date(`${row.expires}-01T00:00:00Z`)
    if (seen.has(pin) || expires.getTime() - now > pinWarningDays * 86_400_000) continue
    seen.add(pin)
    out.push({
      code: 'W_PIN_EXPIRES',
      message: `the ${row.family} API pin ${row.version} expires ${row.expires}`,
      fix: `upgrade ${bin} to a release that pins a newer version`,
    })
  }
  return out
}
