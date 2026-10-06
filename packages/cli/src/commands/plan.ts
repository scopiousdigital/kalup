// kalup plan: what apply would do to one target. Validate runs first, then the portal guard, then the verified portal's
// state, read and never written, then the reads the engine plans from: the target's observation, the Limits Tracking
// readings and the archived properties, all through read-tagged paths. Nothing is written to the portal or to state;
// --out writes the plan/1 document, to .kalup/plans/ when it names no file. --exit-code exits 2 when anything is
// pending.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { HttpClient } from '@kalup/engine'
import {
  type ArchivedProperty,
  archivedProperties,
  archivedSchemaNames,
  associationIds,
  plan as decide,
  exitCodes,
  guardPortal,
  type Issue,
  isAddress,
  KalupError,
  type Loaded,
  observeTarget,
  type Plan,
  type Planned,
  type PortalInfo,
  planPath,
  planPending,
  planReads,
  planText,
  preflight,
  type Selector,
  sanitize,
  stableStringify,
  type TargetState,
} from '@kalup/engine'
import { openStateStore, unmovedState } from '../lib/state.js'
import { version } from '../version.js'
import type { Context, Result } from './context.js'
import { usageError } from './context.js'
import { shown, writeArgFile, wrote } from './files.js'
import { connect, resolveTarget, targetLine } from './target.js'
import { check } from './validate.js'

const TAKE = "--take config <address[#unit]>, for example --take config 'property:companies/billing_status#label'"

export async function plan(ctx: Context): Promise<Result<Plan>> {
  const take = selectors(ctx.flags.take)
  const { root, loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const { name: target, via } = await resolveTarget(ctx, loaded.config)
  const { http, guard } = connect(root, loaded, target, warnings)
  const portal = await guardPortal(http, guard)
  const { planned, issues: read } = await planTarget(http, { root, loaded, portal, take, target })
  // The flag names the target itself; otherwise the text says which target the rule picked.
  const project = {
    targets: Object.keys(loaded.config.targets),
    overrides: loaded.config.targets[target]?.overrides ?? {},
  }
  let text = `${via === 'flag' ? '' : targetLine(target, guard.portalId, via)}${planText(planned.plan, project)}`
  if (ctx.flags.out !== undefined) {
    writeArgFile(ctx.cwd, ctx.flags.out, `${stableStringify(planned.plan)}\n`)
    text += wrote(shown(ctx.cwd, ctx.flags.out))
  } else if (ctx.flags.outDefault) {
    // .kalup/ is gitignored, so a plan saved here stays on this machine, as state does.
    const path = join(root, planPath(target, planned.plan.planId))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${stableStringify(planned.plan)}\n`)
    text += wrote(shown(ctx.cwd, path))
  }
  // --exit-code: 2 when anything is pending, blocked steps included, as compare and pull --check exit on a difference.
  const pending = ctx.flags.exitCode ? planPending(planned.plan) : undefined
  if (pending !== undefined) {
    text += `${pending}\n`
  }
  const exitCode = pending === undefined ? exitCodes.done : exitCodes.differences
  return { data: planned.plan, issues: [...warnings, ...read, ...planned.issues], text, exitCode }
}

/**
 * The plan for one target after the portal guard, from the reads the plan command makes: the verified portal's state,
 * read and never written, the target's observation, the Limits Tracking readings, the archived properties and, when
 * the plan creates a custom object, the archived custom object names, all through read-tagged paths. `issues` are the
 * observation's. Direct apply plans through here too.
 */
export async function planTarget(
  http: HttpClient,
  input: { loaded: Loaded; portal: PortalInfo; root: string; take: Selector[]; target: string },
): Promise<{ issues: Issue[]; planned: Planned }> {
  const { loaded, portal, root, take, target } = input
  const state = openStateStore(root).read(portal.portalId, target)
  // The association type IDs state records name the labels HubSpot's schema read does not list yet.
  const { observation, issues } = await observeTarget(http, loaded, target, { associationIds: associationIds(state) })
  issues.push(...unfinished(state?.lastApply), ...unmovedState(root, portal.portalId))
  const reads = planReads({ loaded, observation, state, take, target })
  const { limits } = await preflight(http, reads.limits)
  const archived: Record<string, ArchivedProperty[]> = {}
  for (const [key, objectType] of Object.entries(reads.archived)) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one object at a time for the rate limits
    archived[key] = await archivedProperties(http, objectType)
  }
  // A create of an archived custom object's name purges it, so plan blocks one; the names come from the archived list.
  const archivedSchemas = reads.schemas ? await archivedSchemaNames(http) : []
  const planned = decide({
    archivedProperties: archived,
    archivedSchemas,
    dailyRemaining: http.dailyRemaining,
    limits,
    loaded,
    observation,
    portal,
    state,
    take,
    target,
    version,
  })
  return { issues, planned }
}

// W_UNFINISHED_APPLY: the last apply stopped without finishing (the process ended while it ran) or left a write whose
// outcome is unknown. What it wrote shows in this plan as adopt steps or held units; the warning says to review them.
function unfinished(last: TargetState['lastApply']): Issue[] {
  if (last === undefined || (last.outcome !== 'running' && last.outcome !== 'uncertain')) {
    return []
  }
  const how = last.outcome === 'running' ? 'did not finish' : 'left a write whose outcome is unknown'
  return [
    {
      code: 'W_UNFINISHED_APPLY',
      message: sanitize(
        `the last apply (${last.planId}, at ${last.at}) ${how}; resources it may have written appear below as adopt steps or held values`,
        400,
      ),
      fix: 'review those steps before you apply this plan; kalup status shows the last apply',
    },
  ]
}

/**
 * The `--take` values as selectors. The flag reads `--take config <address[#unit]>`: a side, then one or more
 * selectors, repeatable. Only config's side can be taken here; pull takes the portal's.
 */
export function selectors(values: string[] | undefined): Selector[] {
  const out: Selector[] = []
  // Selectors since the last `config`; undefined before the first.
  let named: number | undefined
  for (const value of values ?? []) {
    if (value === 'config') {
      if (named === 0) {
        throw usageError(`--take config names no address: ${TAKE}`)
      }
      named = 0
    } else if (named === undefined) {
      const hint =
        value === 'portal' ? '; to take the portal side, run the pull command a held value names' : `: ${TAKE}`
      throw usageError(`--take takes config's side only${hint}`)
    } else {
      out.push(selectorOf(value))
      named += 1
    }
  }
  if (named === 0) {
    throw usageError(`--take config names no address: ${TAKE}`)
  }
  return out
}

// `<address>` or `<address>#<unit>`. The address may hold `*`, which an address allows.
function selectorOf(value: string): Selector {
  const at = value.indexOf('#')
  const address = at === -1 ? value : value.slice(0, at)
  const unit = at === -1 ? undefined : value.slice(at + 1)
  if (!isAddress(address) || unit === '') {
    throw usageError(`--take config ${sanitize(value)} is not an address with an optional #unit: ${TAKE}`)
  }
  return unit === undefined ? { address } : { address, unit }
}
