// kalup apply's executor, architecture section 8. Under the portal lock it re-reads state, observes what the plan
// touches, checks the plan against both, records that a run began, then runs the effect steps one at a time: read the
// resource again, build the payload from that read, send it once, read it back until a deadline, record what verified.
// There is no resume and no rollback: a run that does not finish tells the person to plan again. Every dependency is
// an argument, so the executor never touches stdin, stdout, the environment or oclif; the command owns all of those.

import { bin } from '../brand.js'
import { parseAddress } from '../ir/address.js'
import { stableStringify } from '../ir/serialize.js'
import type { Base, ResourceState, TargetState } from '../ir/state.js'
import type { Address, IRResource, Ref } from '../ir/types.js'
import type { IssueCode } from '../issues.js'
import { type ExitCode, exitCodes, type Issue, KalupError } from '../lib/errors.js'
import {
  type HttpClient,
  type HttpRequest,
  HubSpotApiError,
  type ReadAttempt,
  type SendOutcome,
  type WriteHttpClient,
  type WriteRequest,
} from '../lib/http.js'
import {
  normalizePipelines,
  type RawGroup,
  type RawPipeline,
  type RawProperty,
  type Sensitivity,
} from '../lib/pull/normalize.js'
import { STANDARD_OBJECTS } from '../lib/pull/scope.js'
import { type Endpoint, NORM_VERSIONS, registry } from '../lib/registry.js'
import { sanitize } from '../lib/sanitize.js'
import { byCodeUnit } from '../loader/load.js'
import { advanceBase, classify, type UnitResult } from '../plan/classify.js'
import type { BlockedReason, Plan, PlanStep } from '../plan/types.js'
import { baseOf, runOrder, staleUnits, stepTitle, type TakeoverRules, type Trusted, trustSteps } from './apply-check.js'
import {
  type ApplyObservation,
  groupResource,
  localPipelines,
  type Names,
  namesOf,
  pipelineResources,
  toResource,
} from './apply-observe.js'
import {
  createBody,
  groupPatch,
  pipelineCreateBody,
  pipelinePatch,
  propertyPatch,
  removedValues,
  stageCreateBody,
  stageOrder,
  stagePatch,
} from './apply-payload.js'
import type { ApprovalMode } from './approval.js'
import { fieldOf } from './derive.js'
import { hasEffect } from './digest.js'
import { capturedSpec, objectOf, pipelineOf, specOf, stageIdOf, targetFlag } from './units.js'

export type StepOutcome = 'done' | 'unverified' | 'uncertain' | 'rejected' | 'stale' | 'not-run' | 'blocked'
export type ApplyOutcome = 'done' | 'partial' | 'uncertain' | 'nothing' | 'already-applied'

export interface StepReport {
  action: PlanStep['action']
  address: Address
  id: string
  /** The code of the issue that explains the outcome, when there is one. */
  issue?: IssueCode
  outcome: StepOutcome
  /** Why the plan blocked the step, on a blocked one: the plan step's blocked.reason. */
  reason?: BlockedReason
  /** The units that did not verify, or that moved before the write. */
  units?: string[]
}

export interface ApplyData {
  /** How the plan was approved. Null when nothing was asked: a plan with no effect. */
  approval: ApprovalMode | null
  /** The journal file, null when the run sent no request under the lock. */
  journal: string | null
  outcome: ApplyOutcome
  planId: string
  /** The state file after the run: its serial, and whether a resource entry changed. Null when it was not read. */
  state: { changed: boolean; path: string; serial: number | null } | null
  /** Every effect step, and every step the plan blocked, in plan order. */
  steps: StepReport[]
  target: { name: string; portalId: number }
}

export interface Applied {
  data: ApplyData
  exitCode: ExitCode
  issues: Issue[]
  text: string
}

export interface ApplyRequest {
  /** Who applied, as lastApply records it. Never an email address. */
  actor: string
  approval: ApprovalMode
  /** Every key the run holds, so the journal refuses a line that contains one. */
  keys: readonly string[]
  plan: Plan
  /**
   * Which option removals are takeover's (settings.ts derivedExact) and the target's overrides, from the project as
   * data. The command passes it whenever the plan deletes or removes an option; without it, the plan's takeover label
   * says which removals are takeover's.
   */
  takeover?: TakeoverRules
}

export interface ApplyDeps {
  /** The write client of the run, already through the portal guard. Every request goes through it. */
  http: WriteHttpClient
  /** Takes the portal lock, or throws E_LOCKED: acquirePortalLock. */
  lock: (portalId: number, holder: { command: string; planId?: string }) => Promise<{ release: () => void }>
  now: () => Date
  /** How apply reads the objects a plan touches: observeForApply, or a test's. */
  observe: (http: HttpClient, plan: Plan) => Promise<ApplyObservation>
  /** Opens the run's journal: openJournal. */
  openJournal: (run: JournalRun) => Journal
  /** Where a line about a long wait goes, for a person watching: stderr in human mode, nowhere under --json. */
  progress?: (line: string) => void
  /** How long a read-back polls before it gives up. Default READ_BACK_MS. */
  readBackMs?: number
  /** Aborted on SIGINT or SIGTERM: the run stops before its next request. */
  signal?: AbortSignal
  sleep: (ms: number) => Promise<void>
  /** The portal's state file: FileStateStore. */
  store: StateStore
}

/** What the executor asks of the state file. Engine code never touches the disk: the command passes FileStateStore. */
export interface StateStore {
  newLineage: () => string
  path: (portalId: number) => string
  read: (portalId: number, target?: string) => TargetState | null
  /** Compare-and-swap on the serial; true when the file changed. */
  write: (next: TargetState, expectSerial: number | null) => boolean
}

/** The run a journal records: the command passes lib/journal's openJournal. */
export interface JournalRun {
  approval: ApprovalMode
  keys: readonly string[]
  planId: string
  portalId: number
  writesHash: string
}

export interface Journal {
  /** Writes one line and flushes it before it returns. */
  append: (entry: JournalEntry) => void
  path: string
}

/** One request, by its registry path template: never a URL, a body or a key. */
export interface JournalEntry {
  address: string
  at: string
  category?: string
  correlationId?: string
  method: string
  ms: number
  outcome: 'ok' | 'rejected' | 'wait' | 'uncertain' | 'failed'
  path: string
  status?: number
  step: string
  subCategory?: string
}

/** How long a read-back polls for the written values before the step counts as unverified or uncertain. */
export const READ_BACK_MS = 60_000
/** How long a read-back waits before it tells a person watching that it is still waiting, once per step. */
const PROGRESS_MS = 3000
/** A rate limit, a lock or a 477 is waited out this many times per step; one more stops the run. */
const MAX_WAITS = 3
const LINE_MAX = 1000
// The scope http.ts names in a 403's message.
const SCOPE = /the scope (\S+)\./
const TEXT_MAX = 400
// The count in HubSpot's message for a property in use: "is currently used in 1 places and cannot be deleted".
const USES = /used in (\d+) places?/
// How many of a property's uses a refusal names, and how long one may be (a form draft's name runs to 46 characters).
const USES_SHOWN = 5
const USE_MAX = 60

type Kind = 'group' | 'property' | 'pipeline' | 'stage'

/**
 * What a read of one resource found. `archived`: a delete's evidence, the property archived, the group, pipeline or
 * stage gone. For a pipeline or a stage, `raw` is the pipeline as HubSpot returned it, and `stages` its stages under
 * their local addresses, as resources.
 */
interface Found {
  archived?: boolean
  present: boolean
  raw?: RawGroup | RawProperty | RawPipeline
  resource?: IRResource
  stages?: Record<Address, IRResource>
}

interface StepResult {
  /**
   * Entries of other addresses the step changes: the stages a pipeline create carries, or those of a pipeline it deletes
   * or releases, null to drop one.
   */
  also?: [Address, ResourceState | null][]
  /** The step's state entry after it: a new or changed entry, null to drop it, undefined to leave it as it was. */
  entry?: ResourceState | null
  issues?: Issue[]
  report: StepReport
  /** Nothing after this step runs. */
  stop?: boolean
}

/** What every request of a run goes through: the signal, the journal and the step it serves. */
interface Wire {
  /** Where each request is journaled: the step and address it serves. */
  at: { address?: string; step: string }
  deps: ApplyDeps
  /** Why the run stops before its next request, other than the signal: the journal could not be written. */
  halt?: Issue
  journal: Journal
  /** A write request was sent that may have landed: answered 2xx, or uncertain. */
  wrote: boolean
}

/** One run under the lock, once the plan checked out against state and the observation. */
interface Run extends Wire {
  /** Whether a resource entry changed in the state file. */
  changed: boolean
  /** Effect steps that created a resource in this run, by address, so a dependent create may retry a 400 or 404. */
  created: Set<Address>
  /** The serial the next save compares, null while no file exists. */
  expectSerial: number | null
  issues: Issue[]
  names: Names
  observation: ApplyObservation
  request: ApplyRequest
  state: TargetState
  trusted: Map<string, Trusted>
}

/** Thrown by a request made after the signal aborted. */
class Stopped extends Error {}

/**
 * Applies a checked, approved plan: the lock, then everything that runs under it. A refusal before the first write
 * throws; once the run began it returns, whatever happened, with the exit code of its outcome. The lock is
 * released in every case.
 */
export async function executePlan(request: ApplyRequest, deps: ApplyDeps): Promise<Applied> {
  const { plan } = request
  const lock = await deps.lock(plan.target.portalId, { command: 'apply', planId: plan.planId })
  try {
    return await underLock(request, deps)
  } finally {
    lock.release()
  }
}

/** The result of a plan with no effect: nothing was asked, read or written. */
export function nothingToApply(plan: Plan): Applied {
  const data: ApplyData = {
    planId: plan.planId,
    target: { name: plan.target.name, portalId: plan.target.portalId },
    approval: null,
    outcome: 'nothing',
    steps: blockedReports(plan),
    state: null,
    journal: null,
  }
  const line = `Nothing to apply: plan ${plan.planId} writes nothing to HubSpot or state.`
  return { data, exitCode: exitCodes.done, issues: [], text: textOf([line, ...blockedLines(plan), ...heldLines(plan)]) }
}

/** A report for every step the plan blocked, in plan order. */
function blockedReports(plan: Plan): StepReport[] {
  return plan.steps.filter((s) => s.risk === 'blocked').map((s) => report(s, 'blocked'))
}

// The steps the plan blocked, never silent: how many, then each address and why, as the plan says.
function blockedLines(plan: Plan): string[] {
  const blocked = plan.steps.filter((s) => s.risk === 'blocked')
  if (blocked.length === 0) {
    return []
  }
  return [
    `${blocked.length} blocked, not run:`,
    ...blocked.map((s) => `  ${s.id} ${s.address}: ${s.blocked?.reason}, ${s.blocked?.detail}`),
  ]
}

// The units the plan holds, never silent either: apply writes none of them, and the plan shows how to settle each. A
// person who edited the portal learns here that apply left the edit alone on purpose.
function heldLines(plan: Plan): string[] {
  const { held } = plan.counts
  if (held === 0) {
    return []
  }
  const [values, them] = held === 1 ? ['1 value differs', 'it'] : [`${held} values differ`, 'them']
  return [
    `${values} between config and HubSpot (edited in HubSpot, or never agreed) and ${held === 1 ? 'is' : 'are'} held, not written: run ${bin} plan ${targetFlag(plan.target.name)} to see ${them} and how to settle ${them}.`,
  ]
}

function textOf(lines: string[]): string {
  return `${lines.map((line) => sanitize(line, LINE_MAX)).join('\n')}\n`
}

async function underLock(request: ApplyRequest, deps: ApplyDeps): Promise<Applied> {
  const { plan } = request
  const { portalId, name } = plan.target
  const path = deps.store.path(portalId)
  const state = deps.store.read(portalId, name)
  const last = state?.lastApply
  if (state && last?.writesHash === plan.writesHash && last.outcome === 'done') {
    const data = result(request, 'already-applied', [], { changed: false, path, serial: state.serial }, null)
    const line = `Already applied at ${sanitize(last.at)}: plan ${plan.planId} on target ${sanitize(name)}, portal ${portalId}.`
    return { data, exitCode: exitCodes.done, issues: [], text: `${line} Nothing was written.\n` }
  }
  if ((state?.lineage ?? null) !== plan.stateLineage || (state?.serial ?? null) !== plan.stateSerial) {
    throw stateChanged(plan, state)
  }
  const journal = deps.openJournal({
    approval: request.approval,
    keys: request.keys,
    planId: plan.planId,
    portalId,
    writesHash: plan.writesHash,
  })
  const wire: Wire = { at: { step: 'observe' }, deps, journal, wrote: false }
  const daily = deps.http.dailyRemaining
  let observation: ApplyObservation
  try {
    observation = await deps.observe(reader(wire), plan)
  } catch (error) {
    throw error instanceof Stopped ? new KalupError(stopIssue(wire)) : error
  }
  if (wire.halt) {
    throw new KalupError(wire.halt)
  }
  const trusted = trustSteps(plan, state, observation, request.takeover)
  budget(plan, observation, daily)
  const run: Run = Object.assign(wire, {
    changed: false,
    created: new Set<Address>(),
    expectSerial: state?.serial ?? null,
    issues: [],
    names: namesOf(plan),
    observation,
    request,
    state: state ?? {
      format: 'kalup.state/1' as const,
      lineage: deps.store.newLineage(),
      serial: 0,
      portalId,
      resources: {},
    },
    trusted,
  })
  // Recorded before the first write, so a crash leaves `running` for the next plan to report. Its failure is thrown:
  // nothing was written.
  save(run, (s) => ({ ...s, lastApply: lastApply(run, 'running') }))
  const reports = await runSteps(run)
  return finish(run, reports, path)
}

// The steps in the order runOrder derives, each after the one before has settled. A save that fails stops the run.
// The entries of steps that send no request wait for one save, made before the next request goes out or at the end:
// losing them to a crash loses nothing the portal holds, and saving each alone made a large adoption quadratic.
async function runSteps(run: Run): Promise<Map<string, StepReport>> {
  const reports = new Map<string, StepReport>()
  const recorded: [Address, ResourceState | null][] = []
  let stop = false
  for (const step of runOrder(run.request.plan)) {
    if (stop) {
      reports.set(step.id, report(step, 'not-run'))
      continue
    }
    const held = heldBack(run, step, reports)
    if (held) {
      reports.set(step.id, held)
      continue
    }
    if (halted(run)) {
      stop = true
      const issue = stopIssue(run)
      run.issues.push(issue)
      reports.set(step.id, report(step, 'not-run', { issue: issue.code }))
      continue
    }
    const sends = !recordsOnly(step)
    if (sends && !saveEntries(run, recorded.splice(0))) {
      stop = true
      const failed = run.issues.at(-1)?.code
      reports.set(step.id, report(step, 'not-run', failed === undefined ? {} : { issue: failed }))
      continue
    }
    run.at = { step: step.id, address: step.address }
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one step at a time
    const done = await runStep(run, step)
    reports.set(step.id, done.report)
    run.issues.push(...(done.issues ?? []))
    stop ||= done.stop === true
    const entries = entriesOf(step, done)
    if (entries.length > 0 && !sends) {
      recorded.push(...entries)
    } else if (entries.length > 0 && !saveEntries(run, entries)) {
      stop = true
    }
  }
  saveEntries(run, recorded)
  return reports
}

// The entries a step leaves: its own, then the others it changes.
function entriesOf(step: PlanStep, done: StepResult): [Address, ResourceState | null][] {
  const own: [Address, ResourceState | null][] = done.entry === undefined ? [] : [[step.address, done.entry]]
  return [...own, ...(done.also ?? [])]
}

// A step that sends no request: a release, or an adopt or update with nothing to write.
function recordsOnly(step: PlanStep): boolean {
  return (
    step.action === 'release' ||
    ((step.action === 'adopt' || step.action === 'update') && (step.changes ?? []).length === 0)
  )
}

// A delete runs only when every step before it (in runOrder) finished and verified; a step whose group did not finish
// waits too.
function heldBack(run: Run, step: PlanStep, reports: Map<string, StepReport>): StepReport | undefined {
  if (step.action === 'delete' && [...reports.values()].some((r) => r.outcome !== 'done')) {
    return report(step, 'not-run')
  }
  const effects = run.request.plan.steps.filter(hasEffect)
  const parents = refsOf(step).filter((ref) => effects.some((s) => s.address === ref && s !== step))
  const unfinished = parents.some((ref) => {
    const parent = [...reports.values()].find((r) => r.address === ref)
    return parent !== undefined && parent.outcome !== 'done' && parent.outcome !== 'unverified'
  })
  return unfinished ? report(step, 'not-run') : undefined
}

async function runStep(run: Run, step: PlanStep): Promise<StepResult> {
  if (step.action === 'release') {
    return { report: report(step, 'done'), entry: null, also: stagesGone(run, step) }
  }
  if (recordsOnly(step)) {
    return record(run, step)
  }
  return await write(run, step)
}

// An adopt or update with nothing to write: ownership, and the base of each listed unit where the fresh observation
// equals the approved value. Held units never move.
function record(run: Run, step: PlanStep): StepResult {
  const trusted = run.trusted.get(step.id) ?? { owned: false }
  const observed = run.observation.resources[step.address]
  const previous = baseOf(step, trusted)
  const live = observed ? capturedSpec(observed) : { fields: {} }
  const base = advanceBase(previous, specOf(step.desired ?? {}), live, step.baseUnits ?? [])
  return { report: report(step, 'done'), entry: entryOf(run, step, base) }
}

// One write: read the resource again and compare it with expect, build the payload from that read, send it once, and
// read it back. A wait is waited out and the write rebuilt from a new read; a dependent create's 400 or 404 is tried
// again the same way until the read-back deadline.
async function write(run: Run, step: PlanStep): Promise<StepResult> {
  const tries: Tries = { retries: 0, waits: 0 }
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests: each attempt reads before it writes
    const attempt = await attemptWrite(run, step, tries)
    if (!('again' in attempt)) {
      return attempt
    }
    await run.deps.sleep(attempt.again)
  }
}

/** What the attempts of one write have used: waits, retries of a dependent create, and the retry deadline. */
interface Tries {
  retries: number
  retryUntil?: number
  waits: number
}

/** Try the write again after this many milliseconds, from a new read. */
interface Again {
  again: number
}

// One attempt: the read, the comparison with expect, the request, and what HubSpot's answer means.
async function attemptWrite(run: Run, step: PlanStep, tries: Tries): Promise<StepResult | Again> {
  let before: Found
  try {
    before = await find(run, step, false)
  } catch (error) {
    return failedRead(run, step, error)
  }
  const moved = before.present && before.resource === undefined ? ['type'] : staleUnits(step, before.resource)
  if (moved.length > 0) {
    return stale(run, step, moved)
  }
  if (halted(run)) {
    return stopped(run, step)
  }
  if (kindOf(step.address) === 'pipeline' && (step.changes ?? []).some((c) => c.unit === 'stages')) {
    return await reorderWrite(run, step, before)
  }
  const sent = await send(run, payload(run, step, before))
  if (sent.kind === 'wait') {
    return waited(run, step, sent, tries)
  }
  if (sent.kind !== 'rejected') {
    return await settle(run, step, sent)
  }
  return step.action === 'create' ? await refusedCreate(run, step, sent, tries) : rejected(run, step, sent)
}

// A rate limit, a lock or a 477: waited out MAX_WAITS times. The daily limit stops the run at once.
function waited(
  run: Run,
  step: PlanStep,
  sent: Extract<SendOutcome, { kind: 'wait' }>,
  tries: Tries,
): StepResult | Again {
  if (sent.daily) {
    return { report: report(step, 'not-run', { issue: 'E_DAILY_LIMIT' }), stop: true, issues: [dailyIssue(run)] }
  }
  if (tries.waits === MAX_WAITS) {
    return { report: report(step, 'not-run', { issue: 'E_RATE_LIMIT' }), stop: true, issues: [rateIssue(run, step)] }
  }
  tries.waits += 1
  return { again: sent.waitMs }
}

// A create HubSpot refused may still have made the resource, or another writer did: present is uncertain, never
// "nothing written". A dependent create's 400 or 404 is tried again until the read-back deadline.
async function refusedCreate(
  run: Run,
  step: PlanStep,
  sent: Extract<SendOutcome, { kind: 'rejected' }>,
  tries: Tries,
): Promise<StepResult | Again> {
  const found = await appeared(run, step)
  if (found !== false) {
    run.wrote = true
    const cause = reasonOf(sent) === 'PROPERTY_WITH_NAME_EXISTS' ? ' because a property of that name exists' : ''
    return uncertain(
      run,
      step,
      `HubSpot answered ${sent.status}${cause}, and a read ${found ? 'now finds it' : 'could not check'}`,
    )
  }
  const now = run.deps.now().getTime()
  tries.retryUntil ??= now + readBackMs(run)
  if ((sent.status === 400 || sent.status === 404) && dependent(run, step) && now < tries.retryUntil) {
    tries.retries += 1
    return { again: backoff(tries.retries - 1) }
  }
  return rejected(run, step, sent)
}

// After a write HubSpot may have applied: read back until the approved values show, or, for a write HubSpot
// acknowledged, until the new state shows (HubSpot may store a value differently). No evidence by the deadline:
// unverified for an acknowledged write, uncertain for any other.
async function settle(run: Run, step: PlanStep, sent: Extract<SendOutcome, { kind: 'ok' | 'uncertain' }>) {
  const { deps } = run
  const acknowledged = sent.kind === 'ok' && (step.action !== 'create' || names(sent.body, portalName(run, step)))
  if (acknowledged && step.action === 'create') {
    run.created.add(step.address)
  }
  const start = deps.now().getTime()
  const before = run.observation.resources[step.address]
  let told = false
  for (let attempt = 0; ; attempt += 1) {
    if (halted(run)) {
      run.issues.push(stopIssue(run))
      return { ...unsettled(run, step, acknowledged), stop: true }
    }
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests: the read-back polls, one read at a time
    const seen = await find(run, step, step.action === 'delete').catch((error: unknown) => {
      if (error instanceof Stopped || error instanceof KalupError) {
        return undefined
      }
      throw error
    })
    if (seen && proven(step, seen, acknowledged, before)) {
      return verified(run, step, seen)
    }
    const elapsed = deps.now().getTime() - start
    if (elapsed >= readBackMs(run)) {
      return unsettled(run, step, acknowledged)
    }
    if (!told && elapsed >= PROGRESS_MS) {
      told = true
      deps.progress?.(`${step.id}: waiting for HubSpot to show the result, up to ${readBackMs(run) / 1000} s`)
    }
    await deps.sleep(backoff(attempt))
  }
}

// Whether a read-back settles the step. A delete: the property reads archived, or the group is gone. A write: every
// written unit reads back as approved; or, for an acknowledged write, the resource shows its new state.
function proven(step: PlanStep, seen: Found, acknowledged: boolean, before: Found['resource']): boolean {
  if (step.action === 'delete') {
    return seen.archived === true
  }
  if (!(seen.present && seen.resource)) {
    return false
  }
  if (unverifiedUnits(step, seen.resource).length === 0 && carriedUnverified(step, seen).length === 0) {
    return true
  }
  if (!acknowledged) {
    return false
  }
  if (step.action === 'create' || before === undefined) {
    return true
  }
  // Read-after-write lag shows the state before the write; anything else is what HubSpot stored.
  const fields = (step.changes ?? []).map((c) => fieldOf(c.unit))
  const now = capturedSpec(seen.resource)
  const then = capturedSpec(before)
  return fields.some((field) =>
    field === 'options'
      ? stableStringify(now.options) !== stableStringify(then.options)
      : stableStringify(now.fields[field]) !== stableStringify(then.fields[field]),
  )
}

// A settled step: a verified delete drops its entry; a write records origin, id and the base of every unit that read
// back as approved, and each unit HubSpot stored differently in rewrites, with W_UNVERIFIED.
function verified(run: Run, step: PlanStep, seen: Found): StepResult {
  if (step.action === 'delete') {
    return { report: report(step, 'done'), entry: null, also: stagesGone(run, step) }
  }
  const readBack = seen.resource as NonNullable<Found['resource']>
  const own = unverifiedUnits(step, readBack)
  const bad = [...own, ...carriedUnverified(step, seen)]
  if (step.action === 'create') {
    run.created.add(step.address)
  }
  const { rewrites: before, ...entry }: ResourceState = entryOf(run, step, verifiedBase(run, step, readBack))
  const rewrites = rewritesAfter(before, writtenUnits(step, readBack), own)
  const saved: ResourceState = rewrites === undefined ? entry : { ...entry, rewrites }
  const also = carriedEntries(step, seen)
  if (bad.length === 0) {
    return { report: report(step, 'done'), entry: saved, also }
  }
  const units = bad.map((u) => u.unit)
  const stored = bad.map((u) => `${u.unit} as ${show(u.observed)}, not ${show(u.desired)} as sent`).join('; ')
  const issue: Issue = {
    code: 'W_UNVERIFIED',
    message: sanitize(`${step.id} ${stepTitle(step, run.names)}: HubSpot stores ${stored}`, TEXT_MAX),
    fix: `change config to the value HubSpot stores, then run ${bin} plan ${targetFlag(run.request.plan.target.name)}`,
  }
  return {
    report: report(step, 'unverified', { units, issue: 'W_UNVERIFIED' }),
    entry: saved,
    also,
    issues: [issue],
  }
}

// The entries of the stages a pipeline create carried, each created, with the base of every unit that read back as
// approved. A stage the read-back lacks gets no entry: the next plan shows it again.
function carriedEntries(step: PlanStep, seen: Found): [Address, ResourceState][] {
  return (step.stages ?? []).flatMap((st): [Address, ResourceState][] => {
    const live = seen.stages?.[st.address]
    if (live === undefined) {
      return []
    }
    const base = advanceBase(undefined, specOf(st.desired), capturedSpec(live))
    const entry: ResourceState = { origin: 'created', id: stageIdOf(st.address), normVersion: NORM_VERSIONS.stage }
    return [[st.address, base === undefined ? entry : { ...entry, base }]]
  })
}

// The units of the stages a pipeline create carried that did not read back as sent, under the stage's address.
function carriedUnverified(step: PlanStep, seen: Found): UnitResult[] {
  return (step.stages ?? []).flatMap((st) => {
    const live = seen.stages?.[st.address]
    if (live === undefined) {
      return [{ unit: `${st.address}`, class: 'diverged' as const, desired: st.desired }]
    }
    return classify(undefined, specOf(st.desired), capturedSpec(live), { options: 'additive' })
      .filter((u) => u.class !== 'converged')
      .map((u) => ({ ...u, unit: `${stageIdOf(st.address)}.${u.unit}` }))
  })
}

// The base a verified write leaves: a create's every owned unit that reads back as approved; an adopt's or update's
// written and listed units that do, over the owning entry's base.
function verifiedBase(run: Run, step: PlanStep, readBack: IRResource): Base | undefined {
  const live = capturedSpec(readBack)
  if (step.action === 'create') {
    const ignored = new Set(step.ignoreChanges)
    const owned = Object.fromEntries(Object.entries(step.desired ?? {}).filter(([field]) => !ignored.has(field)))
    return advanceBase(undefined, specOf(owned), live)
  }
  const units = [...(step.changes ?? []).map((c) => c.unit), ...(step.baseUnits ?? [])]
  // A write to the options changes which members both sides hold, so their order is recorded when it agrees.
  if (units.some((unit) => unit.startsWith('options'))) {
    units.push('options.order')
  }
  const trusted = run.trusted.get(step.id) ?? { owned: false }
  const previous = baseOf(step, trusted)
  return advanceBase(previous, specOf(step.desired ?? {}), live, units)
}

// The rewrites an entry keeps: those before, less every unit this write sent again, and each unit HubSpot stored
// differently this time. Undefined when none is left.
function rewritesAfter(
  before: ResourceState['rewrites'],
  written: string[],
  bad: UnitResult[],
): ResourceState['rewrites'] {
  const kept = Object.entries(before ?? {}).filter(([unit]) => !written.some((w) => covers(w, unit)))
  const now = bad.map((u) => [u.unit, { sent: u.desired ?? null, stored: u.observed ?? null }] as const)
  const all = [...kept, ...now].sort(([a], [b]) => byCodeUnit(a, b))
  return all.length > 0 ? Object.fromEntries(all) : undefined
}

// No evidence by the deadline, or a signal stopped the read-back. A write HubSpot acknowledged is unverified: a
// created resource is recorded as created without a base, since HubSpot's answer named it. Any other is uncertain.
function unsettled(run: Run, step: PlanStep, acknowledged: boolean): StepResult {
  if (!acknowledged) {
    return uncertain(run, step, `no read showed the approved values within ${readBackMs(run) / 1000} s`)
  }
  const issue: Issue = {
    code: 'W_UNVERIFIED',
    message: sanitize(
      `${step.id} ${stepTitle(step, run.names)}: HubSpot accepted it, and no read showed the result within ${readBackMs(run) / 1000} s`,
      TEXT_MAX,
    ),
    fix: `run ${bin} plan ${targetFlag(run.request.plan.target.name)} to compare the portal with state again`,
  }
  const units = (step.changes ?? []).map((c) => c.unit)
  const outcome = report(step, 'unverified', { ...(units.length > 0 ? { units } : {}), issue: 'W_UNVERIFIED' })
  if (step.action !== 'create') {
    return { report: outcome, issues: [issue] }
  }
  return { report: outcome, issues: [issue], entry: entryOf(run, step, undefined) }
}

function uncertain(run: Run, step: PlanStep, why: string): StepResult {
  const issue: Issue = {
    code: 'E_UNCERTAIN_WRITE',
    message: sanitize(
      `${step.id} ${stepTitle(step, run.names)}: HubSpot may or may not have applied it (${why}). ${bin} never sends it again.`,
      TEXT_MAX,
    ),
    fix: `run ${bin} plan ${targetFlag(run.request.plan.target.name)}: it reads what HubSpot holds and shows what is left`,
  }
  return { report: report(step, 'uncertain', { issue: 'E_UNCERTAIN_WRITE' }), issues: [issue] }
}

function rejected(run: Run, step: PlanStep, sent: Extract<SendOutcome, { kind: 'rejected' }>): StepResult {
  const code = ({ 401: 'E_AUTH', 403: 'E_SCOPE' } as Record<number, Issue['code']>)[sent.status] ?? 'E_HTTP'
  const said = sent.category ? ` (${sent.category})` : ''
  const scope = sent.status === 403 ? SCOPE.exec(sent.message)?.[1] : undefined
  const plan = `${bin} plan ${targetFlag(run.request.plan.target.name)}`
  const { why, fix } = refusal(run, step, sent, plan, {
    why: sent.message,
    fix: scope ? `add the scope ${scope} to the write key, then run ${plan}` : `run ${plan} and check the step`,
  })
  const issue: Issue = {
    code,
    message: sanitize(`${step.id} ${stepTitle(step, run.names)} was refused${said}: ${why}`, TEXT_MAX),
    fix,
  }
  return { report: report(step, 'rejected', { issue: code }), issues: [issue] }
}

// A refusal HubSpot's subCategory explains, in plain words with its fix; `otherwise` for any other, which keeps
// HubSpot's message. These answers were observed on 2026-09-29 (docs/conformance/runs/2026-09-29-89b45da9.json) and
// in the live runs of 2026-10-01 (docs/hubspot.md).
function refusal(
  run: Run,
  step: PlanStep,
  sent: Extract<SendOutcome, { kind: 'rejected' }>,
  plan: string,
  otherwise: { fix: string; why: string },
): { fix: string; why: string } {
  // A sensitive create without the object's sensitive write scope (observed 2026-10-01): HubSpot names an action, not
  // a scope, and the generic 403 text would name the ordinary write scope.
  if (sent.status === 403 && sent.message.includes('sensitive-data-property-create')) {
    const key = objectOf(step.address)
    const object = STANDARD_OBJECTS.has(key) ? key : 'custom'
    const level = step.desired?.dataSensitivity === 'highly_sensitive' ? 'highly_sensitive' : 'sensitive'
    return {
      why: `HubSpot refuses the create because the key lacks the sensitive data scope for ${key}`,
      fix: `add the scope crm.objects.${object}.${level}.write to the write key, then run ${plan}`,
    }
  }
  const reason = reasonOf(sent)
  if (reason === 'PORTAL_NOT_ENABLED_FOR_SENSITIVE_DATA') {
    return {
      why: 'HubSpot has sensitive data turned off for this portal',
      fix: `turn it on under Settings > Privacy & Consent > Sensitive data, then run ${plan}`,
    }
  }
  if (reason === 'ONLY_CURRENCY_PROPERTIES_CAN_SPECIFY_CURRENCY') {
    return {
      why: `HubSpot never turns showCurrencySymbol off once ${portalName(run, step)} had a currencyPropertyName`,
      fix: `keep showCurrencySymbol: true, or migrate to a new property under another name, then run ${plan}`,
    }
  }
  if (reason === 'CANNOT_DELETE_PROPERTY_IN_USE') {
    const count = sent.context?.usageCount?.[0] ?? USES.exec(sent.message)?.[1]
    const counted = count === undefined ? '' : ` (HubSpot counts ${count} use${count === '1' ? '' : 's'})`
    const uses = usesOf(sent)
    const where = uses.length === 0 ? '' : ` (${uses.join(', ')})`
    return {
      why: `HubSpot refuses to archive ${portalName(run, step)} because it is in use${counted}`,
      fix: `remove those uses in HubSpot first${where}, then run ${plan}`,
    }
  }
  if (reason === 'GROUP_WITH_ACTIVE_PROPERTIES') {
    return {
      why: 'HubSpot refuses to archive a group that still holds properties',
      fix: `run ${plan}: it names the properties the group holds`,
    }
  }
  // Observed 2026-10-01: `context` names the stages and the records in them, each as one bracketed list.
  if (reason === 'STAGE_ID_IN_USE') {
    const stages = sent.context?.stageIds?.[0]
    const records = sent.context?.objectIds?.[0]
    const held = [stages && `stages ${stages}`, records && `records ${records}`].filter(Boolean).join(', ')
    return {
      why: `HubSpot never deletes a stage a record sits in${held ? ` (${held})` : ''}`,
      fix: `move those records to another stage in HubSpot, or delete them, then run ${plan}`,
    }
  }
  if (reason === 'MISSING_CLOSED_STAGE') {
    return {
      why: 'HubSpot keeps a closed stage in every ticket pipeline',
      fix: `mark another stage ticketState: 'CLOSED' first, then run ${plan}`,
    }
  }
  if (reason === 'STAGE_LABEL_EXISTS') {
    return {
      why: 'another stage of the pipeline has that label, ignoring case',
      fix: `run ${plan}: it reads the portal again`,
    }
  }
  const pipelineIdTaken =
    reason === 'STAGE_ID_EXISTS_IN_ANOTHER_PIPELINE' ||
    sent.message.includes('already using stage id') ||
    sent.message.includes("There's another pipeline")
  if (pipelineIdTaken && (kindOf(step.address) === 'pipeline' || kindOf(step.address) === 'stage')) {
    // HubSpot's answer names the wrong cause for a pipeline ID another object holds (observed 2026-10-05): the plan
    // reads every pipeline in scope and names the holder.
    return {
      why: 'HubSpot refuses the ID because another pipeline or stage holds it',
      fix: `run ${plan}: it names the pipeline or stage that holds the ID`,
    }
  }
  if (reason === 'PROPERTY_WITH_NAME_EXISTS') {
    return {
      why: `HubSpot refuses the create because a property named ${portalName(run, step)} already exists`,
      fix: `run ${plan}: it reads the portal again`,
    }
  }
  return otherwise
}

// Each use HubSpot lists for a property in use (observed 2026-10-01: one `errors` entry per workflow, list, form or
// calculation property, with `parentType`, `parentDisplayType` and `parentName`), as "workflow 123", the first few.
function usesOf(sent: Extract<SendOutcome, { kind: 'rejected' }>): string[] {
  const uses = (sent.errors ?? [])
    .filter((e) => e.subCategory?.endsWith('PROPERTY_USAGE'))
    .map((e) => {
      const kind = (e.context?.parentDisplayType?.[0] ?? e.context?.parentType?.[0] ?? 'use').toLowerCase()
      return sanitize(`${kind.replaceAll('_', ' ')} ${e.context?.parentName?.[0] ?? ''}`.trim(), USE_MAX)
    })
  const rest = uses.length - USES_SHOWN
  return rest > 0 ? [...uses.slice(0, USES_SHOWN), `and ${rest} more`] : uses
}

// The last part of HubSpot's subCategory, such as PROPERTY_WITH_NAME_EXISTS of Properties.PROPERTY_WITH_NAME_EXISTS.
function reasonOf(sent: Extract<SendOutcome, { kind: 'rejected' }>): string | undefined {
  return sent.subCategory?.split('.').at(-1)
}

function stale(run: Run, step: PlanStep, moved: string[]): StepResult {
  const issue: Issue = {
    code: 'E_PLAN_STALE',
    message: sanitize(
      `${step.id} ${stepTitle(step, run.names)}: the portal changed right before the write (${moved.join(', ')}), so it was not sent and the run stopped`,
      TEXT_MAX,
    ),
    fix: `run ${bin} plan ${targetFlag(run.request.plan.target.name)} --out <file> again and review it`,
  }
  return { report: report(step, 'stale', { units: moved, issue: 'E_PLAN_STALE' }), issues: [issue], stop: true }
}

function stopped(run: Wire, step: PlanStep): StepResult {
  const issue = stopIssue(run)
  return { report: report(step, 'not-run', { issue: issue.code }), issues: [issue], stop: true }
}

// A read before the write failed: nothing was sent for this step, and the run stops.
function failedRead(run: Wire, step: PlanStep, error: unknown): StepResult {
  if (error instanceof Stopped) {
    return stopped(run, step)
  }
  if (!(error instanceof KalupError)) {
    throw error
  }
  const issue = error.issues[0]?.code
  return { report: report(step, 'not-run', issue ? { issue } : {}), issues: error.issues, stop: true }
}

// Reads one resource as the step needs it: a property singly with its sensitivity (archived for a delete's evidence),
// a group through the groups list. A 404 on a single read is "not found by this query", never proof of absence.
async function find(run: Run, step: PlanStep, archived: boolean): Promise<Found> {
  const kind = kindOf(step.address)
  const key = objectOf(step.address)
  const objectType = run.names.objectType(key)
  const name = portalName(run, step)
  if (kind === 'pipeline' || kind === 'stage') {
    return await findPipeline(run, step, archived)
  }
  if (kind === 'group') {
    const listed = await read<{ results: RawGroup[] }>(run, { type: 'group', path: 'list', params: { objectType } })
    const group = listed.results.find((g) => g.name === name && !g.archived)
    if (archived) {
      return { present: group !== undefined, archived: group === undefined }
    }
    return group ? { present: true, raw: group, resource: groupResource(group.label) } : { present: false }
  }
  // A create reads back under the sensitivity it asked for; anything else under the list the plan's read found it in.
  const sensitivity: Sensitivity =
    step.action === 'create'
      ? ((step.desired?.dataSensitivity as Sensitivity | undefined) ?? 'non_sensitive')
      : (run.observation.meta[step.address]?.sensitivity ?? 'non_sensitive')
  const query = {
    ...(archived ? { archived: 'true' } : {}),
    ...(sensitivity === 'non_sensitive' ? {} : { dataSensitivity: sensitivity }),
  }
  let raw: RawProperty
  try {
    raw = await read<RawProperty>(run, {
      type: 'property',
      path: 'read',
      params: { objectType, name },
      ...(Object.keys(query).length > 0 ? { query } : {}),
    })
  } catch (error) {
    if (error instanceof HubSpotApiError && error.status === 404) {
      return { present: false }
    }
    throw error
  }
  if (archived) {
    return { present: false, archived: raw.archived === true }
  }
  const { resource } = toResource(key, { ...raw, sensitivity }, run.names)
  return resource ? { present: true, raw, resource } : { present: true, raw }
}

// A pipeline, read singly with its stages (the list's own entry for it, observed 2026-10-05), and a stage through its
// pipeline. A 404 means the pipeline is not there: its body may be HTML, empty or JSON (observed 2026-10-05), so the
// status alone decides. A stage DELETE answers 204 for anything, so a delete is proven only by a read that lacks it.
async function findPipeline(run: Run, step: PlanStep, archived: boolean): Promise<Found> {
  const key = objectOf(step.address)
  const pipeline = kindOf(step.address) === 'stage' ? pipelineOf(step.address) : step.address
  let raw: RawPipeline
  try {
    raw = await read<RawPipeline>(run, {
      type: 'pipeline',
      path: 'read',
      params: { objectType: run.names.objectType(key), pipelineId: run.names.pipelineId(step.address) },
    })
  } catch (error) {
    if (error instanceof HubSpotApiError && error.status === 404) {
      return archived ? { present: false, archived: true } : { present: false }
    }
    throw error
  }
  const [live] = localPipelines(key, normalizePipelines(key, [raw], !STANDARD_OBJECTS.has(key)), run.names)
  const resources = Object.fromEntries(pipelineResources(live ? [{ ...live, id: pipeline.slice(pipeline.lastIndexOf('/') + 1) }] : [], pipeline))
  const resource = resources[step.address]
  if (archived) {
    return { present: resource !== undefined, archived: resource === undefined }
  }
  const stages = Object.fromEntries(Object.entries(resources).filter(([address]) => address !== pipeline))
  return resource ? { present: true, raw, resource, stages } : { present: false, raw }
}

// After a refused create: the single read, then the object's three lists. True when either finds the name, false when
// none does, undefined when a read failed or the run was stopped.
async function appeared(run: Run, step: PlanStep): Promise<boolean | undefined> {
  try {
    if ((await find(run, step, false)).present) {
      return true
    }
    if (kindOf(step.address) !== 'property') {
      return false
    }
    const objectType = run.names.objectType(objectOf(step.address))
    const name = portalName(run, step)
    for (const dataSensitivity of ['non_sensitive', 'sensitive', 'highly_sensitive']) {
      const query = dataSensitivity === 'non_sensitive' ? undefined : { dataSensitivity }
      // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, one list at a time for the rate limits
      const listed = await read<{ results: RawProperty[] }>(run, {
        type: 'property',
        path: 'list',
        params: { objectType },
        ...(query ? { query } : {}),
      })
      if (listed.results.some((p) => p.name === name && !p.archived)) {
        return true
      }
    }
    return false
  } catch (error) {
    if (error instanceof Stopped || error instanceof KalupError) {
      return undefined
    }
    throw error
  }
}

// The request of a writing step, built from the read made right before it.
function payload(run: Run, step: PlanStep, before: Found): WriteRequest {
  const kind = kindOf(step.address)
  const objectType = run.names.objectType(objectOf(step.address))
  const name = portalName(run, step)
  if (kind === 'pipeline' || kind === 'stage') {
    return pipelinePayload(run, step, before, objectType)
  }
  if (step.action === 'create') {
    const group = (step.desired?.group as Ref | undefined)?.$ref
    const body = createBody(step, { name, ...(group === undefined ? {} : { group: run.names.portalName(group) }) })
    return { type: kind, path: 'create', params: { objectType }, body } as WriteRequest
  }
  if (step.action === 'delete') {
    return { type: kind, path: 'delete', params: { objectType, name } } as WriteRequest
  }
  const body =
    kind === 'group'
      ? groupPatch(step.changes ?? [])
      : propertyPatch(step, before.raw as RawProperty, (ref) => run.names.portalName(ref))
  return { type: kind, path: 'update', params: { objectType, name }, body } as WriteRequest
}

// The request of a pipeline or stage step. A stage create takes the slot after the highest live displayOrder, a free
// one, so no stage is renumbered (observed 2026-10-05); the pipeline's own step places it after.
function pipelinePayload(run: Run, step: PlanStep, before: Found, objectType: string): WriteRequest {
  const pipelineId = run.names.pipelineId(step.address)
  if (kindOf(step.address) === 'pipeline') {
    if (step.action === 'create') {
      return { type: 'pipeline', path: 'create', params: { objectType }, body: pipelineCreateBody(step, pipelineId) }
    }
    if (step.action === 'delete') {
      return { type: 'pipeline', path: 'delete', params: { objectType, pipelineId } }
    }
    const body = pipelinePatch(step.changes ?? [])
    return { type: 'pipeline', path: 'update', params: { objectType, pipelineId }, body }
  }
  const stageId = portalName(run, step)
  if (step.action === 'create') {
    const raw = before.raw as RawPipeline | undefined
    const highest = Math.max(-1, ...(raw?.stages ?? []).map((st) => st.displayOrder))
    const body = stageCreateBody(step.desired ?? {}, stageId, highest + 1)
    return { type: 'stage', path: 'create', params: { objectType, pipelineId }, body }
  }
  if (step.action === 'delete') {
    return { type: 'stage', path: 'delete', params: { objectType, pipelineId, stageId } }
  }
  return { type: 'stage', path: 'update', params: { objectType, pipelineId, stageId }, body: stagePatch(step.changes ?? []) }
}

/**
 * A pipeline step that writes the stage order: its label and displayOrder first, in one PATCH, then the stage moves.
 * HubSpot never stores two stages at one displayOrder: a write to a taken slot places the stage right after the stage
 * that held it and renumbers the pipeline 0..n-1 (observed 2026-10-05). So with D the order the step leaves (stageOrder),
 * each stage that is not right after its predecessor in D is moved onto that predecessor's slot, one PATCH each, sent
 * once, with a read of the pipeline before each move. The one write of several requests: a pipeline PUT would drop any
 * stage it does not name.
 */
async function reorderWrite(run: Run, step: PlanStep, before: Found): Promise<StepResult | Again> {
  const objectType = run.names.objectType(objectOf(step.address))
  const pipelineId = run.names.pipelineId(step.address)
  const fields = pipelinePatch(step.changes ?? [])
  let last: Extract<SendOutcome, { kind: 'ok' | 'uncertain' }> = { kind: 'ok', status: 200, body: before.raw }
  if (Object.keys(fields).length > 0) {
    const sent = await send(run, { type: 'pipeline', path: 'update', params: { objectType, pipelineId }, body: fields })
    if (sent.kind === 'wait') {
      return waited(run, step, sent, { retries: 0, waits: 0 })
    }
    if (sent.kind === 'rejected') {
      return rejected(run, step, sent)
    }
    last = sent
  }
  const approved = (step.changes?.find((c) => c.unit === 'stages')?.after ?? []) as string[]
  let current = before
  for (let move = 0; ; move += 1) {
    const live = ((current.resource?.definition?.stages as string[] | undefined) ?? []).slice()
    const target = stageOrder(live, approved)
    const at = target.findIndex((id, i) => i > 0 && live.indexOf(id) !== live.indexOf(target[i - 1] as string) + 1)
    if (at === -1 || move > live.length || halted(run)) {
      break
    }
    const stage = target[at] as string
    const raw = current.raw as RawPipeline
    const portal = (id: string) => run.names.portalName(`${step.address.replace('pipeline:', 'stage:')}/${id}`)
    const slot = raw.stages.find((st) => st.id === portal(target[at - 1] as string))?.displayOrder
    const stageId = portal(stage)
    const body = { displayOrder: slot }
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests: each move reads the pipeline the last one left
    const sent = await send(run, { type: 'stage', path: 'update', params: { objectType, pipelineId, stageId }, body })
    if (sent.kind === 'rejected') {
      return rejected(run, step, sent)
    }
    if (sent.kind !== 'ok') {
      return sent.kind === 'wait' ? waited(run, step, sent, { retries: 0, waits: 0 }) : await settle(run, step, sent)
    }
    last = sent
    current = await find(run, step, false)
  }
  return await settle(run, step, last)
}

// Whether a create names a group this run created: HubSpot may not show the group yet, so a 400 or 404 is tried again.
function dependent(run: Run, step: PlanStep): boolean {
  return refsOf(step).some((ref) => run.created.has(ref))
}

/** The units a write approved that did not read back as approved, as classify reports them. */
function unverifiedUnits(step: PlanStep, readBack: NonNullable<Found['resource']>): UnitResult[] {
  const written = writtenUnits(step, readBack)
  return results(step, readBack).filter(
    (u) => u.class !== 'converged' && u.class !== 'keep' && written.some((w) => covers(w, u.unit)),
  )
}

// A create approves every unit of its definition; an adopt or update the units it changes.
function writtenUnits(step: PlanStep, readBack: NonNullable<Found['resource']>): string[] {
  if (step.action === 'create') {
    return results(step, readBack).map((u) => u.unit)
  }
  return (step.changes ?? []).map((c) => c.unit)
}

function results(step: PlanStep, readBack: NonNullable<Found['resource']>): UnitResult[] {
  return classify(undefined, specOf(step.desired ?? {}), capturedSpec(readBack), {
    options: 'additive',
    removedOptions: removedValues(step.changes),
  })
}

// The entry a step leaves: created for a create (a recreate keeps its origin), adopted for an adopt, the owning entry
// for an update; the portal name as id and this version's normalizer.
function entryOf(run: Run, step: PlanStep, base: Base | undefined): ResourceState {
  const trusted = run.trusted.get(step.id) ?? { owned: false }
  const kind = kindOf(step.address)
  const owning = trusted.owned ? trusted.entry : undefined
  let origin: ResourceState['origin'] = 'adopted'
  if (step.action === 'create') {
    origin = owning?.origin ?? 'created'
  } else if (step.action === 'update') {
    origin = owning?.origin ?? 'adopted'
  }
  // An update keeps what the owning entry holds, its rewrites included, and replaces its base.
  const { base: _, ...kept }: Partial<ResourceState> = step.action === 'update' && owning ? owning : {}
  const entry: ResourceState = { ...kept, origin, id: portalName(run, step), normVersion: NORM_VERSIONS[kind] }
  if (base !== undefined) {
    entry.base = base
  }
  return entry
}

// The entries of the stages under a pipeline a step deletes or releases: a stage goes with its pipeline.
function stagesGone(run: Run, step: PlanStep): [Address, null][] {
  if (kindOf(step.address) !== 'pipeline') {
    return []
  }
  const prefix = `${step.address.replace('pipeline:', 'stage:')}/`
  return Object.keys(run.state.resources)
    .filter((address) => address.startsWith(prefix))
    .map((address) => [address, null])
}

// Saves the entries in one save, none dropping one. False, with E_STATE_WRITE (or E_STATE_CONFLICT) in the issues,
// when the save failed.
function saveEntries(run: Run, entries: [Address, ResourceState | null][]): boolean {
  if (entries.length === 0) {
    return true
  }
  try {
    const changed = save(run, (s) => {
      const resources = { ...s.resources }
      for (const [address, entry] of entries) {
        if (entry === null) {
          delete resources[address]
        } else {
          resources[address] = entry
        }
      }
      return { ...s, resources }
    })
    run.changed ||= changed
    return true
  } catch (error) {
    if (!(error instanceof KalupError)) {
      throw error
    }
    run.issues.push(...error.issues.map((issue) => ({ ...issue, message: `${issue.message} ${afterWrite(run)}` })))
    return false
  }
}

// Saves state when `change` changes anything but the serial, raising the serial; compare-and-swap on the one before.
function save(run: Run, change: (state: TargetState) => TargetState): boolean {
  const next = change(run.state)
  if (stableStringify({ ...next, serial: run.state.serial }) === stableStringify(run.state)) {
    return false
  }
  const saved = { ...next, serial: run.state.serial + 1 }
  run.deps.store.write(saved, run.expectSerial)
  run.state = saved
  run.expectSerial = saved.serial
  return true
}

function lastApply(run: Run, outcome: NonNullable<TargetState['lastApply']>['outcome']) {
  const { plan, actor } = run.request
  return { planId: plan.planId, writesHash: plan.writesHash, actor, at: run.deps.now().toISOString(), outcome }
}

// The final record, the step reports in plan order with the plan's blocked steps, the exit code and the text.
function finish(run: Run, reports: Map<string, StepReport>, path: string): Applied {
  const { plan } = run.request
  const effects = [...reports.values()]
  let outcome: 'done' | 'partial' | 'uncertain' = 'partial'
  if (effects.some((r) => r.outcome === 'uncertain')) {
    outcome = 'uncertain'
  } else if (effects.every((r) => r.outcome === 'done')) {
    outcome = 'done'
  }
  let saved = run.issues.every((issue) => issue.code !== 'E_STATE_WRITE' && issue.code !== 'E_STATE_CONFLICT')
  if (saved) {
    try {
      save(run, (s) => ({ ...s, lastApply: lastApply(run, outcome) }))
    } catch (error) {
      if (!(error instanceof KalupError)) {
        throw error
      }
      saved = false
      run.issues.push(...error.issues.map((issue) => ({ ...issue, message: `${issue.message} ${afterWrite(run)}` })))
    }
  }
  const steps = plan.steps.flatMap((step): StepReport[] => {
    const found = reports.get(step.id)
    if (found) {
      return [found]
    }
    return step.risk === 'blocked' ? [report(step, 'blocked')] : []
  })
  const state = { changed: run.changed, path, serial: run.expectSerial }
  const data = result(run.request, outcome, steps, state, run.journal.path)
  let exitCode: ExitCode = exitCodes.error
  if (outcome === 'done' && saved) {
    exitCode = exitCodes.done
  } else if (run.wrote || run.changed) {
    exitCode = exitCodes.partial
  }
  if (run.deps.http.dailyRemaining === null) {
    run.issues.push(rateHeaders())
  }
  return { data, exitCode, issues: run.issues, text: text(run, data, outcome === 'done' && saved) }
}

function text(run: Run, data: ApplyData, done: boolean): string {
  const { plan } = run.request
  const titles = new Map(plan.steps.map((s) => [s.id, stepTitle(s, run.names)]))
  const lines = [
    `${done ? 'Applied' : 'Did not finish'} plan ${plan.planId} on target ${plan.target.name}, portal ${plan.target.portalId}`,
    ...data.steps
      .filter((s) => s.outcome !== 'blocked')
      .map((s) => `${s.id} ${s.outcome} ${titles.get(s.id)}${s.units ? `: ${s.units.join(', ')}` : ''}`),
    summary(data.steps.filter((s) => s.outcome !== 'blocked')),
    ...blockedLines(plan),
    ...heldLines(plan),
    `State: ${data.state?.path} (serial ${data.state?.serial ?? 'none'}). Journal: ${data.journal}`,
    ...(done ? [] : [`Run ${bin} plan ${targetFlag(plan.target.name)} to see what is left.`]),
  ]
  return textOf(lines)
}

function summary(steps: StepReport[]): string {
  const order: StepOutcome[] = ['done', 'unverified', 'uncertain', 'rejected', 'stale', 'not-run']
  const counts = order.flatMap((outcome) => {
    const n = steps.filter((s) => s.outcome === outcome).length
    return n > 0 ? [`${n} ${outcome === 'not-run' ? 'not run' : outcome}`] : []
  })
  return `${counts.join(', ')}.`
}

function result(
  request: ApplyRequest,
  outcome: ApplyOutcome,
  steps: StepReport[],
  state: ApplyData['state'],
  journal: string | null,
): ApplyData {
  const { plan, approval } = request
  return {
    planId: plan.planId,
    target: { name: plan.target.name, portalId: plan.target.portalId },
    approval,
    outcome,
    steps,
    state,
    journal,
  }
}

function report(step: PlanStep, outcome: StepOutcome, extra: Pick<StepReport, 'issue' | 'units'> = {}): StepReport {
  const reason = outcome === 'blocked' ? step.blocked?.reason : undefined
  return { id: step.id, address: step.address, action: step.action, outcome, ...extra, ...(reason ? { reason } : {}) }
}

// Refuses a run whose estimate, reads included, is more than half of what HubSpot reported left after the guard.
function budget(plan: Plan, observation: ApplyObservation, daily: number | null): void {
  const writes = plan.steps
    .filter(hasEffect)
    .filter((s) => s.action === 'create' || s.action === 'delete' || (s.changes ?? []).length > 0).length
  const estimate = 3 * writes + observation.reads
  if (daily !== null && estimate > daily / 2) {
    throw new KalupError({
      code: 'E_BUDGET',
      message: `plan ${plan.planId} needs about ${estimate} API calls, more than half of the ${daily} HubSpot reports left today. Nothing was written.`,
      fix: 'apply after the daily limit resets, or split the change into smaller plans',
    })
  }
}

// Every read of the run goes through here, one attempt at a time: each attempt is journaled, and the signal checked,
// before the next. A 429, a 5xx, a timeout or a network failure is waited out as the read client would.
async function read<T>(run: Wire, req: HttpRequest): Promise<T> {
  const endpoint = endpointOf(req)
  for (let attempt = 0; ; attempt += 1) {
    if (halted(run)) {
      throw new Stopped()
    }
    const started = run.deps.now()
    let step: ReadAttempt<T>
    try {
      // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests: each attempt waits out the one before
      step = await run.deps.http.readOnce<T>(req, attempt)
    } catch (error) {
      const known =
        error instanceof HubSpotApiError
          ? {
              status: error.status,
              ...(error.category === undefined ? {} : { category: error.category }),
              ...(error.correlationId === undefined ? {} : { correlationId: error.correlationId }),
            }
          : {}
      note(run, req, endpoint, started, { outcome: 'failed', ...known })
      throw error
    }
    if (step.kind === 'done') {
      note(run, req, endpoint, started, { outcome: 'ok', status: 200 })
      return step.value
    }
    note(run, req, endpoint, started, {
      outcome: 'wait',
      ...(step.status === undefined ? {} : { status: step.status }),
    })
    await run.deps.sleep(step.waitMs)
  }
}

async function send(run: Wire, req: WriteRequest): Promise<SendOutcome> {
  const endpoint = endpointOf(req)
  const started = run.deps.now()
  const sent = await run.deps.http.send(req)
  run.wrote ||= sent.kind === 'ok' || sent.kind === 'uncertain'
  const known = {
    ...(sent.status === undefined ? {} : { status: sent.status }),
    ...(sent.kind === 'rejected' && sent.category !== undefined ? { category: sent.category } : {}),
    ...(sent.kind === 'rejected' && sent.subCategory !== undefined ? { subCategory: sent.subCategory } : {}),
    ...(sent.kind === 'rejected' && sent.correlationId !== undefined ? { correlationId: sent.correlationId } : {}),
  }
  note(run, req, endpoint, started, { outcome: sent.kind, ...known })
  return sent
}

// The client the observation reads through: the run's own reads, journaled under the step 'observe'.
function reader(run: Wire): HttpClient {
  const { http } = run.deps
  return {
    get dailyRemaining() {
      return http.dailyRemaining
    },
    get timeZone() {
      return http.timeZone
    },
    set timeZone(value: string) {
      http.timeZone = value
    },
    request: <T>(req: HttpRequest) => read<T>(run, req),
  }
}

// Journals one request. A line that cannot be written halts the run before its next request: every request must be
// on disk before the next one goes. The request itself already went, so the run still saves what it learned.
function note(
  run: Wire,
  req: HttpRequest | WriteRequest,
  endpoint: Endpoint,
  started: Date,
  answer: Pick<JournalEntry, 'category' | 'correlationId' | 'outcome' | 'status' | 'subCategory'>,
): void {
  try {
    run.journal.append({
      at: started.toISOString(),
      step: run.at.step,
      address: run.at.address ?? req.params?.objectType ?? '',
      method: endpoint.method,
      path: endpoint.path,
      ms: Math.max(0, run.deps.now().getTime() - started.getTime()),
      ...answer,
    })
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    run.halt ??= {
      code: 'E_JOURNAL_WRITE',
      message: sanitize(
        `the journal ${run.journal.path} could not be written (${why}), so the run stopped before its next request`,
        TEXT_MAX,
      ),
      fix: `make the journal directory writable, then run ${bin} plan to see what the portal holds and what is left`,
    }
  }
}

// The run stops before its next request: the signal, or a journal that cannot be written.
function halted(run: Wire): boolean {
  return run.deps.signal?.aborted === true || run.halt !== undefined
}

function stopIssue(run: Wire): Issue {
  return run.halt ?? interruptedIssue()
}

function endpointOf(req: HttpRequest | WriteRequest): Endpoint {
  return (registry[req.type].paths as Record<string, Endpoint>)[req.path] as Endpoint
}

function stateChanged(plan: Plan, state: TargetState | null): KalupError {
  const then = plan.stateLineage === null ? 'no state' : `lineage ${plan.stateLineage}, serial ${plan.stateSerial}`
  const now = state === null ? 'no state' : `lineage ${state.lineage}, serial ${state.serial}`
  return new KalupError({
    code: 'E_STATE_CHANGED',
    message: `state for portal ${plan.target.portalId} changed since plan ${plan.planId} was made (${then}; now ${now}): another apply, pull or repair ran in between. Nothing was written.`,
    fix: `run ${bin} plan ${targetFlag(plan.target.name)} --out <file> again and review it`,
  })
}

function interruptedIssue(): Issue {
  return {
    code: 'E_CANCELLED',
    message: 'Stopped by a signal before the next request. The steps after it did not run.',
    fix: `run ${bin} plan to see what the portal holds and what is left`,
  }
}

function dailyIssue(run: Run): Issue {
  return {
    code: 'E_DAILY_LIMIT',
    message: 'The portal has used its daily API limit, so the run stopped before this write.',
    fix: `after the limit resets, run ${bin} plan ${targetFlag(run.request.plan.target.name)} to see what is left`,
  }
}

function rateIssue(run: Run, step: PlanStep): Issue {
  return {
    code: 'E_RATE_LIMIT',
    message: `HubSpot asked to wait ${MAX_WAITS + 1} times for ${step.id}, so the run stopped before sending it again.`,
    fix: `run ${bin} plan ${targetFlag(run.request.plan.target.name)} later to see what is left`,
  }
}

function rateHeaders(): Issue {
  return {
    code: 'W_RATE_HEADERS',
    message: 'HubSpot sent no daily rate-limit header, so apply could not weigh its calls against the daily limit',
  }
}

function afterWrite(run: Run): string {
  return `Journal: ${run.journal.path}. The next ${bin} plan compares the portal with the state that was kept and shows what is left.`
}

function readBackMs(run: Run): number {
  return run.deps.readBackMs ?? READ_BACK_MS
}

// 250 ms, doubling, at most 8 s: a read-back reads often at first, then less.
function backoff(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 8000)
}

function refsOf(step: PlanStep): Address[] {
  const refs: Address[] = []
  const group = (step.desired?.group as Ref | undefined)?.$ref
  if (group !== undefined) {
    refs.push(group)
  }
  for (const change of step.changes ?? []) {
    const ref = (change.after as Ref | null)?.$ref
    if (typeof ref === 'string') {
      refs.push(ref)
    }
  }
  return refs
}

function covers(written: string, unit: string): boolean {
  return unit === written || unit.startsWith(`${written}.`) || unit.startsWith(`${written}[`)
}

// A create's 2xx body is proof of existence when it names the resource: a property or group by its name, a pipeline or
// stage by its id.
function names(body: unknown, name: string): boolean {
  const named = body as { id?: unknown; name?: unknown } | null
  return typeof body === 'object' && named !== null && (named.name === name || named.id === name)
}

function portalName(run: Run, step: PlanStep): string {
  return run.names.portalName(step.address)
}

function show(value: unknown): string {
  return value === undefined ? 'absent' : (JSON.stringify(value) ?? 'null')
}

function kindOf(address: Address): Kind {
  return parseAddress(address).type as Kind
}
