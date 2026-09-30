// A target as the networked commands open it: its read key and a read-mode client, and what the portal guard checks.
// Opening sends nothing, so a command can check every key before the first request. Which target a command opens is
// core's selectTarget rule; a person at a terminal chooses when the rule finds several and no selection.
import type { Target } from '@kalup/core'
import type { GuardTarget } from '@kalup/engine'
import {
  type ConfigFile,
  createHttp,
  exitCodes,
  type HttpClient,
  KalupError,
  type Loaded,
  sanitize,
  selectTarget,
  type TargetChoice,
} from '@kalup/engine'
import { resolveReadKey } from '../lib/auth.js'
import type { Issue } from '../lib/output.js'
import type { Context } from './context.js'

export interface Connection {
  guard: GuardTarget
  http: HttpClient
}

/** How the target was picked: `--target`, defaultTarget, the only target, or the person at the terminal. */
export type Via = 'flag' | 'default' | 'only' | 'chosen'

export interface Resolved {
  name: string
  via: Via
}

const CONFIG = 'kalup.config.ts'

/**
 * The one target a command runs against, after check() has loaded and validated the config and before any key lookup,
 * request or file write. Several targets and none selected ask the person at a terminal, else fail with the names.
 */
export async function resolveTarget(ctx: Context, config: ConfigFile): Promise<Resolved> {
  const selection = selectTarget(config, ctx.flags.target)
  switch (selection.status) {
    case 'selected':
      return { name: selection.name, via: selection.via }
    // validate reports the next two first, so these are guards.
    case 'unknown':
      throw new KalupError(
        {
          code: 'E_UNKNOWN_TARGET',
          message: `target '${sanitize(selection.requested)}' is not declared`,
          file: CONFIG,
          configPath: 'targets',
          fix: `${useOneOf(selection.choices)}declare targets.${sanitize(selection.requested)}`,
        },
        exitCodes.invalid,
      )
    case 'invalid-default':
      throw new KalupError(
        {
          code: 'E_DEFAULT_TARGET',
          message: `defaultTarget '${sanitize(selection.defaultTarget)}' is not a declared target`,
          file: CONFIG,
          configPath: 'defaultTarget',
          fix:
            selection.choices.length > 0
              ? `${useOneOf(selection.choices)}remove defaultTarget`
              : 'declare a target under targets, or remove defaultTarget',
        },
        exitCodes.invalid,
      )
    case 'none':
      throw new KalupError(
        {
          code: 'E_NO_TARGETS',
          message: `${CONFIG} declares no targets`,
          configPath: 'targets',
          fix: 'declare one under targets, for example targets: { prod: { portalId: <Hub ID> } }',
        },
        exitCodes.invalid,
      )
    default:
      return await choose(ctx, selection.choices)
  }
}

/** The first line of a command's text: the target it runs against, its portal, and how it was picked. */
export function targetLine(name: string, portalId: number, via: Via): string {
  const reason = { flag: '', default: ' (defaultTarget)', only: ' (the only target)', chosen: ' (chosen)' }[via]
  return `Target ${sanitize(name)}, portal ${portalId}${reason}\n`
}

// Several targets and none selected: the person at the terminal picks one, and nothing else ever does.
async function choose(ctx: Context, choices: TargetChoice[]): Promise<Resolved> {
  if (ctx.prompt === undefined) {
    const listed = choices.map((c) =>
      c.portalId === undefined ? sanitize(c.name) : `${sanitize(c.name)} (portal ${c.portalId})`,
    )
    const issue: Issue = {
      code: 'E_TARGET_REQUIRED',
      message: `${CONFIG} declares ${choices.length} targets and none is selected: ${listed.join(', ')}`,
      configPath: 'targets',
      fix: `pass --target <name>, or set defaultTarget in ${CONFIG}. An agent should ask the user which portal to use.`,
    }
    throw new KalupError(issue)
  }
  // The name is capped on its own, so a long one never pushes its portal ID out of the line.
  const options = choices.map((c) => ({
    label: c.portalId === undefined ? sanitize(c.name) : `${sanitize(c.name)}  portal ${c.portalId}`,
    value: c.name,
  }))
  const name = await ctx.prompt.choose('Which target?', options)
  if (name === undefined) {
    throw new KalupError({ code: 'E_CANCELLED', message: 'No target chosen. Nothing was read or written.' })
  }
  return { name, via: 'chosen' }
}

// The start of a fix as validate words it: the declared names to pick from, when there are any.
function useOneOf(choices: TargetChoice[]): string {
  return choices.length > 0 ? `use one of ${choices.map((c) => sanitize(c.name)).join(', ')}, or ` : ''
}

/** The client for target `name`, with the key from its variable. Its rate-limit warning goes to `issues`. */
export function connect(root: string, loaded: Pick<Loaded, 'config'>, name: string, issues: Issue[]): Connection {
  // validate rejected an unknown target and an invalid portalId before any command connects.
  const target = loaded.config.targets[name] as Target
  const portalId = pinnedPortal(name, target, 'read')
  const { key, variable } = resolveReadKey(target, root)
  const http = createHttp({ key, warn: (message) => issues.push({ code: 'W_RATE_LIMIT', message }) })
  return { http, guard: { name, portalId, variable } }
}

/**
 * The portal target `name` pins. E_PENDING_TARGET, exit 3, before any key lookup or request, for a pending target: one
 * init wrote with no portalId, which validate accepts with W_PENDING_TARGET. `use` says what the command would do.
 */
export function pinnedPortal(name: string, target: Pick<Target, 'portalId'>, use: 'read' | 'write' = 'read'): number {
  if (target.portalId !== undefined) {
    return target.portalId
  }
  throw new KalupError(
    {
      code: 'E_PENDING_TARGET',
      message: `target ${sanitize(name)} has no portalId yet, so this command cannot check the key against its portal before it would ${use === 'read' ? 'read' : 'write to'} it. Nothing was sent.`,
      file: CONFIG,
      configPath: `targets.${name}`,
      fix: `set targets.${sanitize(name)}.portalId in ${CONFIG} to the Hub ID from the HubSpot account menu`,
    },
    exitCodes.invalid,
  )
}
