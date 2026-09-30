// kalup apply: a saved plan, or for an unprotected target a plan made now, applied through the same checks.
// A saved plan is read with kalup.config.ts, whose objects must hold every step and whose name overrides must give the
// plan's bindings: the plan is the intent, and current config never replaces it. Only a plan that deletes or removes an
// option reads the rest of the project, as data: to check that kalup/removed.ts or takeover asks for each delete and
// that nothing config still holds names what it deletes, and to tell takeover's option removals from config's own. The command resolves the write key, guards the portal with it,
// checks the plan against the target's policy, names and this version, asks for approval, then hands the executor its
// dependencies. It owns the prompts and the signals; the engine never touches stdin, stdout or the environment.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Target } from '@kalup/core'
import {
  type Applied,
  type ApplyData,
  type ApprovalMode,
  bin,
  type ConfigFile,
  checkDeletes,
  checkNames,
  checkPolicy,
  checkVersions,
  createWriteHttp,
  decideApproval,
  derivedExact,
  destinationOf,
  destructiveSteps,
  effectiveResources,
  executePlan,
  exitCodes,
  guardPortal,
  hasEffect,
  KalupError,
  type Loaded,
  MILESTONE_3_WRITES,
  namesOf,
  nothingToApply,
  observeForApply,
  type Plan,
  type PortalInfo,
  parsePlan,
  policyOf,
  read,
  sanitize,
  shellWord,
  stepTitle,
  type TakeoverRules,
  takeoverObjects,
  targetFlag,
  type WriteHttpClient,
} from '@kalup/engine'
import { resolveWriteKey, type WriteKey } from '../lib/auth.js'
import { openJournal } from '../lib/journal.js'
import { findRoot, load } from '../lib/load.js'
import { acquirePortalLock } from '../lib/lock.js'
import type { Issue } from '../lib/output.js'
import { FileStateStore, stateDir } from '../lib/state.js'
import { version } from '../version.js'
import type { Context, Prompter, Result } from './context.js'
import { usageError } from './context.js'
import { readArgFile } from './files.js'
import { planTarget, selectors } from './plan.js'
import { resolveTarget, targetLine } from './target.js'
import { check } from './validate.js'

/** A target opened for writing: its write key, the one client every request of the run goes through, the guard. */
interface Opened {
  http: WriteHttpClient
  key: WriteKey
  portal: PortalInfo
  warnings: Issue[]
}

export async function apply(ctx: Context): Promise<Result<ApplyData>> {
  const [file] = ctx.args
  if (ctx.flags.yes && ctx.flags.approve !== undefined) {
    throw usageError('--yes and --approve are two ways to approve; pass one of them')
  }
  const applied = file === undefined ? await direct(ctx) : await saved(ctx, file)
  return { data: applied.data, exitCode: applied.exitCode, issues: applied.issues, text: applied.text }
}

// A saved plan: the file, then kalup.config.ts for its destination, then the key and the guard.
async function saved(ctx: Context, file: string): Promise<Applied> {
  if (ctx.flags.target !== undefined) {
    throw usageError('--target is not accepted with a plan file: the plan names its target')
  }
  if (ctx.flags.take !== undefined) {
    throw usageError(`--take belongs to ${bin} plan: take config's side there, then apply the plan it saves`)
  }
  const plan = parsePlan(readArgFile(ctx.cwd, file), file, version)
  if (!plan.steps.some(hasEffect)) {
    return nothingToApply(plan)
  }
  const root = findRoot(ctx.cwd)
  const config = readConfig(root)
  const target = destinationOf(plan, config)
  const opened = await open(root, plan.target.name, target, ctx.flags.approve !== undefined)
  return await approveAndRun(ctx, { root, plan, config, target, opened, command: `${bin} apply ${shellWord(file)}` })
}

// No file: for an unprotected target, plan now as kalup plan does, then apply that plan through the same checks.
async function direct(ctx: Context): Promise<Applied> {
  if (ctx.flags.approve !== undefined) {
    throw usageError('--approve applies a saved plan file, and no file was given')
  }
  const take = selectors(ctx.flags.take)
  const { root, loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const { name, via } = await resolveTarget(ctx, loaded.config)
  // validate rejected an unknown target and a missing portalId before any command connects.
  const target = loaded.config.targets[name] as Target
  const opened = await open(root, name, target, false)
  opened.warnings.unshift(...warnings)
  if (policyOf(target, opened.portal.accountType).protected) {
    const flag = targetFlag(name)
    throw new KalupError({
      code: 'E_PROTECTED_SAVED_PLAN',
      message: `target ${sanitize(name)} is protected, so it accepts only a saved plan that a person reviewed. Nothing was written.`,
      fix: `run ${bin} plan ${flag} --out plan.json, review it, then ask the user to run ${bin} apply plan.json in a terminal`,
    })
  }
  const { planned, issues: gaps } = await planTarget(opened.http, {
    root,
    loaded,
    portal: opened.portal,
    take,
    target: name,
  })
  // The executor warns about a missing daily figure itself.
  opened.warnings.push(...gaps, ...planned.issues.filter((issue) => issue.code !== 'W_RATE_HEADERS'))
  const { plan } = planned
  // The flag names the target itself; otherwise the text says which target the rule picked, as plan's does.
  const head = via === 'flag' ? '' : targetLine(name, opened.portal.portalId, via)
  if (!plan.steps.some(hasEffect)) {
    const nothing = nothingToApply(plan)
    return { ...nothing, issues: opened.warnings, text: `${head}${nothing.text}` }
  }
  const taken = (ctx.flags.take ?? []).map(shellWord).join(' ')
  const command = `${bin} apply ${targetFlag(name)}${taken ? ` --take ${taken}` : ''}`
  const applied = await approveAndRun(ctx, {
    root,
    plan,
    config: loaded.config,
    target,
    opened,
    command,
    loaded,
  })
  return { ...applied, text: `${head}${applied.text}` }
}

// The key, and the one write client every request goes through, reads included; then the portal guard.
async function open(root: string, name: string, target: Target, approve: boolean): Promise<Opened> {
  const warnings: Issue[] = []
  const key = resolveWriteKey(target, root, process.env, { envOnly: approve })
  const http = createWriteHttp({
    key: key.key,
    allow: MILESTONE_3_WRITES,
    warn: (message) => warnings.push({ code: 'W_RATE_LIMIT', message }),
  })
  // validate, or destinationOf for a saved plan, checked the pin.
  const portal = await guardPortal(http, { name, portalId: target.portalId as number, variable: key.variable })
  return { http, key, portal, warnings }
}

interface Approving {
  command: string
  /** kalup.config.ts as the command read it: the objects it declares and the target's name overrides. */
  config: ConfigFile
  /**
   * The project the plan was made from now, for a direct apply; a saved plan loads it when it deletes or removes an
   * option.
   */
  loaded?: Loaded
  opened: Opened
  plan: Plan
  root: string
  target: Target
}

// The policy, version, name and delete checks, the approval, then the executor with its dependencies.
async function approveAndRun(ctx: Context, run: Approving): Promise<Applied> {
  const { plan, opened, target, root, command } = run
  checkPolicy(plan, policyOf(target, opened.portal.accountType), takeoverObjects(run.config, plan.target.name))
  checkVersions(plan, new Date())
  checkNames(plan, run.config)
  const effects = plan.steps.filter(hasEffect)
  let takeover: TakeoverRules | undefined
  if (effects.some((step) => step.action === 'delete' || step.changes?.some((c) => c.op === 'remove'))) {
    // The loader parses the project as data and never runs it. A project it cannot read refuses the plan.
    const loaded = run.loaded ?? load(root)
    if (effects.some((step) => step.action === 'delete')) {
      checkDeletes(plan, loaded)
    }
    takeover = {
      options: derivedExact(loaded, plan.target.name, effectiveResources(loaded.ir, plan.target.name)),
      overrides: target.overrides ?? {},
    }
  }
  const approval = decideApproval({
    approve: ctx.flags.approve,
    command,
    credential: { envOnly: ctx.flags.approve !== undefined, separate: opened.key.separate },
    // Before the lock only the plan's stated risks are known. After it, apply refuses a plan that states less than
    // trusted code derives (E_PLAN_RISK), so a stated risk never lets --yes cover more.
    derived: Object.fromEntries(plan.steps.map((s) => [s.id, s.risk])),
    interactive: ctx.prompt !== undefined,
    plan,
    policy: plan.target,
    target: plan.target.name,
    yes: ctx.flags.yes,
  })
  if ('refuse' in approval) {
    const exitCode = approval.refuse.humanRequired ? exitCodes.humanRequired : exitCodes.error
    throw new KalupError(approval.refuse, exitCode)
  }
  if (approval.mode === 'terminal') {
    await confirm(ctx.prompt as Prompter, plan, opened.portal)
  }
  const dir = stateDir(root)
  const applied = await executePlan(
    {
      plan,
      approval: approval.mode,
      actor: actorOf(approval.mode),
      keys: [opened.key.key],
      ...(takeover ? { takeover } : {}),
    },
    {
      http: opened.http,
      store: FileStateStore(dir),
      lock: (portalId, holder) => acquirePortalLock(portalId, holder),
      openJournal: (journal) => openJournal(dir, journal),
      observe: (http, planned) => observeForApply(http, planned, target.overrides ?? {}),
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      ...(ctx.progress ? { progress: ctx.progress } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    },
  )
  return { ...applied, issues: [...opened.warnings, ...applied.issues] }
}

// The terminal confirmation: the destination and every effect in trusted words, then the target name, and the number
// of destructive steps when there are any. A wrong answer or the end of input cancels.
async function confirm(prompt: Prompter, plan: Plan, portal: PortalInfo): Promise<void> {
  const effects = plan.steps.filter(hasEffect)
  // checkNames verified the plan's name bindings against kalup.config.ts.
  const names = namesOf(plan)
  const count = (action: string, changes?: boolean) =>
    effects.filter((s) => s.action === action && (changes === undefined || (s.changes ?? []).length > 0 === changes))
      .length
  // An adoption that adds options sends a PATCH: it counts as a write and as an adoption.
  const writes = count('create') + count('update', true) + count('adopt', true)
  // Deletes, and the updates takeover removes options from.
  const destructive = destructiveSteps(plan.steps).length
  const { name, protected: guarded } = plan.target
  prompt.tell([
    `Apply plan ${plan.planId} to target ${name}, portal ${portal.portalId} (${portal.accountType}, ${guarded ? 'protected' : 'not protected'}):`,
    ...effects.map(
      (s) => `  ${s.id} ${s.risk}${s.labels?.length ? ` [${s.labels.join(', ')}]` : ''} ${stepTitle(s, names)}`,
    ),
    `${writes} writes, ${count('adopt')} adoptions, ${count('release')} releases, ${count('update', false)} base records, ${destructive} destructive`,
  ])
  const typed = await prompt.ask('Type the target name to apply:')
  if (typed?.trim() !== name) {
    throw cancelled('the answer was not the target name')
  }
  if (destructive > 0) {
    const counted = await prompt.ask(`Type the number of destructive steps (${destructive}):`)
    if (counted?.trim() !== String(destructive)) {
      throw cancelled('the answer was not the number of destructive steps')
    }
  }
}

function cancelled(why: string): KalupError {
  return new KalupError({ code: 'E_CANCELLED', message: `Not applied: ${why}. Nothing was written.` })
}

// kalup.config.ts, with the core reader. An unreadable file is the reader's IssueError, exit 3.
function readConfig(root: string): ConfigFile {
  const file = 'kalup.config.ts'
  return read(readFileSync(join(root, file), 'utf8'), file, 'config').data as ConfigFile
}

// Who applied, as state's lastApply records it: how the run was approved, never a person's name or address.
function actorOf(mode: ApprovalMode): string {
  return { terminal: 'terminal', yes: '--yes', approve: '--approve' }[mode]
}
