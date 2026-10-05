// What apply checks before it writes, docs/architecture.md section 7. Pure: the command and the executor pass what they
// read. parsePlan checks a saved file's generator version, plan/1, its digest and its own consistency; the destination,
// policy and version checks run after the portal guard; trustSteps derives each effect step's blocked status, risk and labels from
// state, policy and a fresh observation with derive.ts, and compares each step's expect with that observation. Titles
// are redrawn here from step data: a plan's own titles are never printed.
import type { Override, Target } from '@kalup/core'
import { bin } from '../brand.js'
import type { ConfigFile } from '../grammar/types.js'
import { isAddress, parseAddress } from '../ir/address.js'
import { stableStringify } from '../ir/serialize.js'
import type { Base, ResourceState, TargetState } from '../ir/state.js'
import type { Address, IROption, IRResource, Issue } from '../ir/types.js'
import { exitCodes, KalupError } from '../lib/errors.js'
import { plural } from '../lib/plural.js'
import { NORM_VERSIONS, registry } from '../lib/registry.js'
import { sanitize } from '../lib/sanitize.js'
import { effectiveResources } from '../loader/effective.js'
import { byCodeUnit, type Loaded } from '../loader/load.js'
import { onObject } from '../loader/validate.js'
import { classify, ORDERS, type UnitClass } from '../plan/classify.js'
import type { Plan, PlanAction, PlanChange, PlanStep, Risk } from '../plan/types.js'
import { validatePlan } from '../plan/validate.js'
import { type ApplyObservation, bindingChanges, createsObject, type Names, namesOf } from './apply-observe.js'
import { createdDisplay, memberOf, objectTail, removedValues, schemaWrites } from './apply-payload.js'
import {
  afterSteps,
  closesStage,
  deleteBlock,
  fieldOf,
  type Kind,
  type StepContext,
  stageDeleteRule,
  stepLabels,
  stepRisk,
  writeBlock,
  writesPipelines,
} from './derive.js'
import { hasEffect, writesHash } from './digest.js'
import { bindingsFor, dependencies } from './plan.js'
import type { Policy } from './policy.js'
import { notJson, parseJson } from './snapshot.js'
import { keptByRead, takeoverRefusal } from './takeover.js'
import {
  ARCHIVED_OBJECT,
  baseFor,
  CAPTURED,
  capturedSpec,
  coverOf,
  fieldWords,
  nameOf,
  objectOf,
  PURGED,
  placeOf,
  shellWord,
  shownName,
  specOf,
  countsAll,
  takesOf,
  takesText,
  targetFlag,
  unheldNames,
  writesTail,
} from './units.js'

/** What trusted derivation learned about one effect step, for the executor. */
export interface Trusted {
  /** The state entry at the address, owning or not. */
  entry?: ResourceState
  /** The entry owns the address: created or adopted, and naming the portal name it resolves to. */
  owned: boolean
  /** An adopt's pulled entry: the base a pull recorded for the portal name the address resolves to. */
  pulled?: ResourceState
}

const TITLE_MAX = 160
const TEXT_MAX = 400
const RANK: Partial<Record<Risk, number>> = { safe: 0, risky: 1, destructive: 2 }
const PLAN_FORMAT = /^plan\/\d+$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * A saved plan: made by this release line of kalup (`running` is this version), plan/1, a writesHash and planId
 * recomputed from its content, and changes that write the step's own desired values. E_PLAN_VERSION, E_PLAN_INVALID or
 * E_PLAN_DIGEST, exit 1, naming `file`.
 */
export function parsePlan(text: string | undefined, file: string, running: string): Plan {
  const shown = sanitize(file, 1000)
  if (text === undefined) {
    throw invalid(`${shown} was not found`)
  }
  const document = parseJson(text)
  if (document === notJson) {
    throw invalid(`${shown} is not JSON`)
  }
  const other = otherVersion(document, running)
  if (other !== undefined) {
    throw new KalupError({
      code: 'E_PLAN_VERSION',
      message: `${shown} ${other}. Nothing was sent.`,
      fix: `plan again with this version: run ${bin} plan --target <name> --out <file>, review it and apply that file`,
    })
  }
  const problems = validatePlan(document)
  if (problems.length > 0) {
    const [first] = problems
    const at = first?.configPath ? ` at ${first.configPath}` : ''
    throw invalid(`${shown} is not a plan/1 document${at}: ${first?.message}`)
  }
  const plan = document as Plan
  const disorder = structureOf(plan)
  if (disorder !== undefined) {
    throw invalid(`${shown}: ${disorder}`)
  }
  const hash = writesHash(plan)
  if (hash !== plan.writesHash || plan.planId !== `pl_${hash.slice('sha256:'.length, 'sha256:'.length + 12)}`) {
    throw new KalupError({
      code: 'E_PLAN_DIGEST',
      message: `${shown}: writesHash and planId do not match what the plan says it writes, so it was changed after ${bin} plan saved it. Nothing was sent.`,
      fix: `run ${bin} plan ${targetFlag(plan.target.name)} --out ${shellWord(file)} again and review it`,
    })
  }
  const inconsistent = plan.steps.filter(hasEffect).flatMap(disagreement)
  if (inconsistent.length > 0) {
    throw invalid(`${shown}: ${inconsistent.join('; ')}`)
  }
  return plan
}

// Why another version's plan does not apply: another plan format, or a generator of another release line. Checked
// before the schema, which a plan a newer version made need not pass. Undefined when the document states neither
// differently, and the schema has the last word.
function otherVersion(document: unknown, running: string): string | undefined {
  if (typeof document !== 'object' || document === null) {
    return undefined
  }
  const { format, generator } = document as { format?: unknown; generator?: { version?: unknown } | null }
  if (typeof format === 'string' && PLAN_FORMAT.test(format) && format !== 'plan/1') {
    return `is ${format}, and this version of ${bin} applies plan/1 plans`
  }
  const made = generator?.version
  if (typeof made === 'string' && lineOf(made) !== lineOf(running)) {
    return `was made by ${bin} ${sanitize(made)}, and this is ${bin} ${running}: a saved plan applies only under the release line that made it`
  }
  return undefined
}

// The releases a plan/1 field keeps its meaning across (docs/compatibility.md): one major version from 1.0.0, one
// minor version before it, where any minor may change a contract, and one exact pre-release. Undefined when `version`
// is not a semantic version.
function lineOf(version: string): string | undefined {
  const match = SEMVER.exec(version)
  if (match === null) {
    return undefined
  }
  const [, major, minor, patch, pre] = match
  if (pre !== undefined) {
    return `${major}.${minor}.${patch}-${pre}`
  }
  return major === '0' ? `0.${minor}` : major
}

/**
 * The plan's target as kalup.config.ts declares it now: E_PLAN_DESTINATION when it is not declared or pins another
 * portal, E_DUPLICATE_PORTAL (exit 3) when another target pins the same portal.
 */
export function destinationOf(plan: Plan, config: ConfigFile): Target {
  const { name, portalId } = plan.target
  const target = Object.hasOwn(config.targets, name) ? config.targets[name] : undefined
  const again = `run ${bin} plan against a declared target with --out, review it and apply that file`
  if (target === undefined) {
    throw destination(
      `plan ${plan.planId} is for target ${sanitize(name)}, which kalup.config.ts does not declare`,
      again,
    )
  }
  if (target.portalId !== portalId) {
    throw destination(
      `plan ${plan.planId} is for target ${sanitize(name)} on portal ${portalId}, and kalup.config.ts pins that target to portal ${target.portalId ?? 'none'}`,
      again,
    )
  }
  const other = Object.keys(config.targets).find((n) => n !== name && config.targets[n]?.portalId === portalId)
  if (other !== undefined) {
    throw new KalupError(
      {
        code: 'E_DUPLICATE_PORTAL',
        message: `target '${sanitize(name)}' pins portal ${portalId}, which target '${sanitize(other)}' pins too. Nothing was sent.`,
        file: 'kalup.config.ts',
        configPath: `targets.${sanitize(name)}.portalId`,
        fix: `each portal has one target; remove or rename one of ${sanitize(other)}, ${sanitize(name)}`,
      },
      exitCodes.invalid,
    )
  }
  return target
}

// Why config still holds what a delete takes: the address itself, with or without preventDestroy, or for a custom
// object anything on it.
function inConfig(address: Address, effective: Record<Address, IRResource>, ir: Loaded['ir']): string | undefined {
  const resource = Object.hasOwn(effective, address) ? effective[address] : undefined
  if (resource?.lifecycle?.preventDestroy === true) {
    return `${address} is in config and sets lifecycle.preventDestroy`
  }
  if (resource !== undefined || Object.hasOwn(ir.resources, address)) {
    return `${address} is still in config`
  }
  return archivedWith(address, effective, ir)
}

// Another address config holds that resolves to the same portal resource through the target's name overrides.
function heldAs(
  address: Address,
  portal: string,
  holders: Map<string, Address[]>,
  effective: Record<Address, IRResource>,
): string | undefined {
  const held = holders.get(portal) ?? []
  const guarded = held.find((a) => effective[a]?.lifecycle?.preventDestroy === true)
  if (guarded !== undefined) {
    return `${address} resolves to ${portal} in the portal, which config holds as ${guarded} and protects with lifecycle.preventDestroy`
  }
  return held.length > 0
    ? `${address} resolves to ${portal} in the portal, which config still holds as ${held.join(', ')}`
    : undefined
}

// A custom object archive takes everything on the object along, so nothing on it may be in config, and nothing config
// protects with preventDestroy.
function archivedWith(address: Address, effective: Record<Address, IRResource>, ir: Loaded['ir']): string | undefined {
  if (kindOf(address) !== 'object') {
    return undefined
  }
  const held = onObject(ir, objectOf(address))
  const guarded = held.filter((a) => effective[a]?.lifecycle?.preventDestroy === true)
  if (guarded.length > 0) {
    return `${address} archives ${guarded.join(', ')}, which config holds and protects with lifecycle.preventDestroy`
  }
  return held.length > 0 ? `${address} archives what config still holds: ${held.join(', ')}` : undefined
}

/**
 * E_PLAN_DELETE before approval: a delete step whose address kalup.config.ts and removed.ts do not ask to
 * delete. `loaded` is the project as the loader read it, as data. A delete needs a destroy tombstone, which kalup rm
 * writes (a delete's first key), or takeover's leave (takeover.ts: the object's mode, the pull scope, exclude), and an
 * address that is gone from config, so preventDestroy cannot still hold it. A delete labelled takeover needs takeover's
 * leave whatever removed.ts says, so never a custom object, a pipeline or a stage. A custom object archive needs
 * everything on the object gone from config too. No resource config still holds may resolve to the same portal
 * resource through the target's name overrides.
 */
export function checkDeletes(plan: Plan, loaded: Pick<Loaded, 'config' | 'ir'>): void {
  const { ir } = loaded
  const effective = effectiveResources(ir, plan.target.name)
  const target = Object.hasOwn(ir.targets, plan.target.name) ? ir.targets[plan.target.name] : undefined
  const names = namesOf(plan, target?.overrides ?? {})
  const holders = new Map<string, Address[]>()
  for (const address of Object.keys(effective).sort(byCodeUnit)) {
    const resource = portalResource(address, names)
    holders.set(resource, [...(holders.get(resource) ?? []), address])
  }
  const problems = plan.steps
    .filter((step) => hasEffect(step) && step.action === 'delete')
    .flatMap(({ address, labels = [] }) => {
      const kept =
        inConfig(address, effective, ir) ?? heldAs(address, portalResource(address, names), holders, effective)
      if (kept !== undefined) {
        return [kept]
      }
      const why = takeoverRefusal(loaded, plan.target.name, address)
      // The label asks for takeover's archive, so takeover's rules decide whatever removed.ts says. Apply checks the
      // rest of them against its read.
      if (labels.includes('takeover')) {
        return why === undefined ? [] : [`${address} is labelled takeover, and takeover does not archive it: ${why}`]
      }
      const tombstone = Object.hasOwn(ir.tombstones, address) ? ir.tombstones[address] : undefined
      if (tombstone?.action === 'destroy') {
        return []
      }
      return why === undefined
        ? [`${address} has no destroy tombstone and no takeover label`]
        : [`${address} has no destroy tombstone in removed.ts, and takeover does not archive it: ${why}`]
    })
  if (problems.length > 0) {
    throw new KalupError({
      code: 'E_PLAN_DELETE',
      message: sanitize(
        `plan ${plan.planId} deletes what config does not ask to delete: ${problems.join('; ')}. Nothing was written.`,
        TEXT_MAX * 2,
      ),
      fix: `to delete a resource, run ${bin} rm <address>, then ${bin} plan ${targetFlag(plan.target.name)} --out <file> and review it; a plan file is never edited by hand`,
    })
  }
}

/**
 * E_POLICY_CHANGED when the target's effective policy is not the one the plan recorded, naming each field. `takeover`
 * is the objects whose mode on the target is takeover now (settings.ts takeoverObjects).
 */
export function checkPolicy(plan: Plan, policy: Policy, takeover: string[]): void {
  const now: Record<string, unknown> = { ...policy, takeover: takeover.join(', ') || 'none' }
  const was: Record<string, unknown> = { ...plan.target, takeover: plan.target.takeover.join(', ') || 'none' }
  const fields = ['protected', 'drift', 'adopt', 'allowDestroy', 'yesLimit', 'takeover'] as const
  const changed = fields.filter((field) => was[field] !== now[field])
  if (changed.length > 0) {
    const what = changed.map((field) => `${field} was ${was[field]}, now ${now[field]}`).join('; ')
    throw new KalupError({
      code: 'E_POLICY_CHANGED',
      message: `the policy of target ${sanitize(plan.target.name)} changed since plan ${plan.planId}: ${what}. Nothing was written.`,
      fix: `run ${bin} plan ${targetFlag(plan.target.name)} --out <file> again and review it under the policy in kalup.config.ts`,
    })
  }
}

/**
 * E_PLAN_VERSION when a step's API family or version is not the registry row that would send it, the row's pin has
 * expired, or the plan's normalizer versions are not this version's.
 */
export function checkVersions(plan: Plan, now: Date): void {
  const problems: string[] = []
  for (const step of plan.steps.filter(hasEffect)) {
    if (step.action === 'release') {
      continue
    }
    const row = registry[kindOf(step.address)]
    if (step.api?.family !== row.family || step.api.version !== row.version) {
      const stated = step.api ? `${sanitize(step.api.family)} ${sanitize(step.api.version)}` : 'no API'
      problems.push(`${step.id} uses ${stated}, and this version sends ${row.family} ${row.version}`)
    } else if (now.getTime() >= Date.parse(`${row.expires}-01T00:00:00Z`)) {
      problems.push(`${step.id} uses ${row.family} ${row.version}, whose pin expired ${row.expires}`)
    }
  }
  problems.push(...normalizerProblems(plan))
  if (problems.length > 0) {
    throw new KalupError({
      code: 'E_PLAN_VERSION',
      message: `plan ${plan.planId} was made for another version of ${bin}: ${problems.join('; ')}. Nothing was written.`,
      fix: `run ${bin} plan ${targetFlag(plan.target.name)} --out <file> with this version and review it; an expired pin needs a newer release`,
    })
  }
}

// Every type either side names: a type this version has no normalizer for is a mismatch too.
function normalizerProblems(plan: Plan): string[] {
  const known: Record<string, number> = NORM_VERSIONS
  const problems: string[] = []
  for (const kind of [...new Set([...Object.keys(known), ...Object.keys(plan.normVersions)])].sort()) {
    const planned = Object.hasOwn(plan.normVersions, kind) ? plan.normVersions[kind] : undefined
    const current = Object.hasOwn(known, kind) ? known[kind] : undefined
    if (planned !== current) {
      problems.push(
        `the plan compared ${sanitize(kind)} under normalizer ${planned ?? 'none'}, this version uses ${current ?? 'none'}`,
      )
    }
  }
  return problems
}

/** What the project says about takeover on a plan's target. The command derives it from the project, as data. */
export interface TakeoverRules {
  /**
   * Per property whose options lifecycle takeover made 'exact', its removedOptions (settings.ts derivedExact): removing
   * any other option is takeover's removal.
   */
  options: Record<Address, string[]>
  /** The target's overrides: takeover archives no property in a group a skip override covers. */
  overrides: Record<string, Pick<Override, 'skip'>>
  /** removed.ts's tombstones: takeover archives nothing removed.ts names or a custom object's tombstone covers. */
  tombstones: Record<Address, unknown>
}

/**
 * Checks every effect step against state and the fresh observation. E_PLAN_STALE, listing what moved, when an expect
 * no longer holds; else E_PLAN_RISK when trusted derivation blocks a step, derives a higher risk than the plan states,
 * or a label the plan omits. `takeover` says which option removals are takeover's and which groups a skip override
 * covers; without it, the plan's takeover label says which removals are takeover's, and no override is checked. What it
 * learned per step id.
 */
export function trustSteps(
  plan: Plan,
  state: TargetState | null,
  observation: ApplyObservation,
  takeover?: TakeoverRules,
): Map<string, Trusted> {
  const names = namesOf(plan)
  const effects = plan.steps.filter(hasEffect)
  const moved = effects.flatMap((step) =>
    staleUnits(step, observation.resources[step.address], observation, names.portalName(step.address)).map(
      (unit) => `${step.address} ${unit}`,
    ),
  )
  if (moved.length > 0) {
    throw new KalupError({
      code: 'E_PLAN_STALE',
      message: sanitize(
        `the portal changed since plan ${plan.planId} was made: ${moved.join(', ')}. Nothing was written.`,
        TEXT_MAX * 2,
      ),
      fix: `run ${bin} plan ${targetFlag(plan.target.name)} --out <file> again and review it`,
    })
  }
  const trusted = new Map<string, Trusted>()
  const problems: string[] = []
  for (const step of effects) {
    const found = Object.hasOwn(state?.resources ?? {}, step.address) ? state?.resources[step.address] : undefined
    const entry = found?.origin === 'created' || found?.origin === 'adopted' ? found : undefined
    const owned = entry !== undefined && entry.id === names.portalName(step.address)
    const pulled =
      step.action === 'adopt' && found?.origin === 'pulled' && found.id === names.portalName(step.address)
        ? found
        : undefined
    const known: Trusted = { ...(entry ? { entry } : {}), owned, ...(pulled ? { pulled } : {}) }
    trusted.set(step.id, known)
    const held: Held = {
      ...known,
      overrides: takeover ? takeover.overrides : {},
      takeover: takeoverOf(step, owned, takeover),
      tombstones: takeover?.tombstones,
    }
    problems.push(...disagreements(plan, step, held, observation))
  }
  if (problems.length > 0) {
    throw new KalupError({
      code: 'E_PLAN_RISK',
      message: sanitize(
        `plan ${plan.planId} does not match what ${bin} derives from state and the portal: ${problems.join('; ')}. Nothing was written.`,
        TEXT_MAX * 2,
      ),
      fix: `run ${bin} plan ${targetFlag(plan.target.name)} --out <file> again and review it; a plan file is never edited by hand`,
    })
  }
  return trusted
}

/**
 * What trusted derivation knows of one step's address: the state entry, whether it owns it, and takeover's part, with
 * the target's overrides.
 */
interface Held extends Trusted {
  overrides: TakeoverRules['overrides']
  takeover: Pick<StepContext, 'takeover' | 'takeoverUnits'>
  /** Undefined when the host gave no takeover rules. */
  tombstones: TakeoverRules['tombstones'] | undefined
}

// Takeover's part in a step: a delete takeover archives, one no entry owns or one the plan labels takeover; or the
// option units an adopt or update removes that the property's removedOptions do not name.
function takeoverOf(
  step: PlanStep,
  owned: boolean,
  takeover: TakeoverRules | undefined,
): Pick<StepContext, 'takeover' | 'takeoverUnits'> {
  const labelled = step.labels?.includes('takeover') === true
  if (step.action === 'delete') {
    return { takeover: labelled || !owned }
  }
  const removed = (step.changes ?? []).filter((c) => c.op === 'remove')
  if (takeover === undefined) {
    return { takeoverUnits: new Set(labelled ? removed.map((c) => c.unit) : []) }
  }
  const asked = Object.hasOwn(takeover.options, step.address) ? takeover.options[step.address] : undefined
  const own = new Set((asked ?? []).map((value) => `options[${value}]`))
  const units = asked === undefined ? [] : removed.filter((c) => !own.has(c.unit))
  return { takeoverUnits: new Set(units.map((c) => c.unit)) }
}

// Where trusted derivation disagrees with a step: it blocks the step, derives a higher risk, or a label the step lacks.
function disagreements(plan: Plan, step: PlanStep, held: Held, observation: ApplyObservation): string[] {
  const { entry, owned } = held
  const block = blockOf(plan, step, held, observation)
  if (block) {
    return [`${step.id} ${step.action} ${step.address} cannot run: ${block}`]
  }
  const context: StepContext = {
    drift: plan.target.drift,
    classes: classesOf(step, held, observation),
    ...held.takeover,
  }
  const derived = owned && entry ? { ...context, owner: { origin: entry.origin as 'created' | 'adopted' } } : context
  const problems: string[] = []
  const risk = stepRisk(step, derived)
  if ((RANK[step.risk] ?? -1) < (RANK[risk] ?? 0)) {
    problems.push(`${step.id} states risk ${sanitize(step.risk)}, and it is ${risk}`)
  }
  const missing = stepLabels(step, derived).filter((label) => !step.labels?.includes(label))
  if (missing.length > 0) {
    problems.push(`${step.id} leaves out the label ${missing.join(', ')}`)
  }
  return problems
}

/**
 * What moved since the plan: `exists` when the resource is there and the step expects it absent, or the other way
 * round; `archived` when a property create's name is archived in HubSpot now; each expected field whose live value differs.
 */
export function staleUnits(
  step: PlanStep,
  observed: IRResource | undefined,
  observation?: Pick<ApplyObservation, 'archived' | 'archivedSchemas'> &
    Partial<Pick<ApplyObservation, 'members' | 'listed'>>,
  portalName = nameOf(step.address),
): string[] {
  const { expect } = step
  if (expect.exists === false) {
    if (observed !== undefined) {
      return ['exists']
    }
    return step.action === 'create' && archivedName(step, observation, portalName) ? ['archived'] : []
  }
  if (expect.exists === true && observed === undefined) {
    return ['exists']
  }
  if (expect.values === undefined || observed === undefined) {
    return []
  }
  const live = capturedSpec(observed).fields
  return Object.entries(expect.values)
    .filter(([field, value]) => {
      if (field === 'takes') {
        return movedTakes(step, value, observation)
      }
      let now = field === 'options' ? (observed.definition?.options ?? []) : live[field]
      // A write's order is checked over the members it lists: a stage this run creates first does not move them. A
      // delete's is checked whole: a pipeline delete purges every stage, so one added since the review stops it.
      if (step.action !== 'delete' && ORDERS.has(field) && Array.isArray(now) && Array.isArray(value)) {
        now = now.filter((member) => value.includes(member))
      }
      return stableStringify(now) !== stableStringify(value)
    })
    .map(([field]) => field)
    .sort(byCodeUnit)
}

// Whether a custom object archive would take more along than its step says: the step names what a person approved,
// and the read made after approval must find the same counts, all three. Read only where the observation holds the
// object's groups; a write's own read before it does not, and the trust pass has checked it by then. A read that
// could not count the pipelines has moved: an incomplete count is never proof the archive takes no more. A step
// without all three counts is the trust pass's refusal (uncheckedFields), not a change in the portal.
function movedTakes(
  step: PlanStep,
  takes: unknown,
  observation?: Partial<Pick<ApplyObservation, 'members' | 'listed'>>,
): boolean {
  const key = objectOf(step.address)
  const members = observation?.members?.[key]
  if (members === undefined || !countsAll(takes)) {
    return false
  }
  const listed = observation?.listed?.[key]
  if (listed?.pipelines === undefined) {
    return true
  }
  const counts = takesOf(members, { groups: listed.groups, pipelines: listed.pipelines })
  return stableStringify(counts) !== stableStringify(takes)
}

/**
 * A step's title from its own data, never the plan's: the kind, the label config gives (for a delete, the label it
 * expects to find), the name and the object. With `names`, the portal name follows the name wherever the two differ.
 * `warned` adds the warnings the plan's title carries, for a person about to confirm the step: that a pipeline or stage
 * delete cannot be restored, and that a field change's effect on existing values is not checked.
 */
export function stepTitle(step: PlanStep, names?: Pick<Names, 'portalName'>, warned = false): string {
  const { address, action } = step
  const kind = kindOf(address)
  const own = shownName(address)
  const portal = names?.portalName(address)
  const name = portal === undefined || portal === own ? own : `${own}, portal name ${portal}`
  const noun = NOUNS[kind]
  const where = placeOf(address)
  // HubSpot purges a pipeline or a stage on delete; a property or group is archived.
  const purged = kind === 'pipeline' || kind === 'stage'
  const removes = purged ? 'Delete' : 'Archive'
  const carried = (step.stages ?? []).length > 0 ? ` with ${plural((step.stages ?? []).length, 'stage')}` : ''
  // A custom object's label is its singular one. A delete has no desired values, only the ones it expects.
  const values = step.action === 'delete' ? step.expect.values : step.desired
  const shown = kind === 'object' ? (values?.labels as { singular?: unknown } | undefined)?.singular : values?.label
  const label = typeof shown === 'string' ? ` "${shown}"` : ''
  const what = `${noun}${label} (${name})${where}`
  const takes = values?.takes
  const titles: Partial<Record<PlanAction, () => string>> = {
    create: () => `${step.labels?.includes('reverts-ui-edit') ? 'Recreate' : 'Create'} ${what}${carried}`,
    adopt: () => `Adopt ${what}${writes(step, warned)}`,
    update: () =>
      (step.changes ?? []).length > 0 ? `Update ${what}${writes(step, warned)}` : `Record the agreed values of ${what}`,
    delete: () =>
      `${
        label
          ? `${removes} ${what}`
          : `${removes} ${noun} ${portal === undefined || portal === own ? own : `${own} (portal name ${portal})`}${where}`
      }${takesText(kind === 'object' && countsAll(takes) ? takes : undefined)}${purged && warned ? PURGED : ''}${kind === 'object' && warned ? ARCHIVED_OBJECT : ''}`,
    release: () => `Stop managing ${noun} ${own}${where}; nothing changes in HubSpot`,
  }
  const title = titles[action]
  return sanitize(title ? title() : `${action} ${address}`, TITLE_MAX)
}

const NOUNS: Record<Kind, string> = {
  object: 'custom object',
  group: 'property group',
  property: 'property',
  pipeline: 'pipeline',
  stage: 'stage',
}

/** The value config gives a unit in a step's desired values, or undefined when it gives none. */
export function desiredValue(desired: Record<string, unknown> | undefined, unit: string): unknown {
  const member = memberOf(unit)
  if (member === undefined) {
    return desired?.[unit]
  }
  const option = ((desired?.options as IROption[] | undefined) ?? []).find((o) => o.value === member.value)
  if (option === undefined || member.field === undefined) {
    return option
  }
  return member.field === 'hidden' ? (option.hidden ?? false) : option[member.field]
}

// Why trusted derivation blocks a step, or undefined when it can run. Create and adopt need no owning entry, except a
// recreate; update and release need one (a release drops any entry at the address), and so does a delete takeover does
// not archive. A delete needs the policy, an archivable property and, for a group, no remaining member apart from the
// properties this plan deletes before it; takeover's option removals need the policy too.
function blockOf(plan: Plan, step: PlanStep, held: Held, observation: ApplyObservation): string | undefined {
  const { entry, owned } = held
  const readOnly = readOnlyPipeline(step) ?? displayRefusal(plan, step, observation)
  if (readOnly !== undefined) {
    return readOnly
  }
  const observed = observation.resources[step.address]
  const names = namesOf(plan)
  switch (step.action) {
    case 'create':
      return owned && !recreates(step, observed, observation, names.portalName(step.address))
        ? 'state owns it, so a create would duplicate what state records'
        : undefined
    case 'adopt':
    case 'update':
      if ((held.takeover.takeoverUnits?.size ?? 0) > 0 && !plan.target.allowDestroy) {
        return `target ${sanitize(plan.target.name)} does not allow deletes, and takeover removes options from it`
      }
      return writeRefusal(step, held, observation)
    case 'delete':
      return deleteRefusal(
        plan,
        step,
        { owner: owned ? entry : undefined, overrides: held.overrides, tombstones: held.tombstones },
        observation,
      )
    case 'release':
      return entry === undefined ? 'state has no entry at this address' : undefined
    default:
      return `${sanitize(step.action)} is not a step apply runs`
  }
}

// A pipeline or stage of an object whose pipelines Kalup does not write: only a release, or an adopt or update that
// writes nothing, runs.
function readOnlyPipeline(step: PlanStep): string | undefined {
  const kind = kindOf(step.address)
  if (!(kind === 'pipeline' || kind === 'stage') || writesPipelines(objectOf(step.address))) {
    return
  }
  const written = step.action === 'adopt' || step.action === 'update' ? (step.changes ?? []).length : 1
  return written > 0 && step.action !== 'release'
    ? `Kalup does not write the pipelines of ${objectOf(step.address)} in this release`
    : undefined
}

// A custom object step whose display, required or searchable fields name a property HubSpot will not hold when it runs:
// not one HubSpot gives every custom object, not one this read found on the object, and not one the plan creates there
// first. HubSpot refuses such a write (observed 2026-10-05). A create's own fields are its tail (objectTail).
function displayRefusal(plan: Plan, step: PlanStep, observation: ApplyObservation): string | undefined {
  if (kindOf(step.address) !== 'object' || step.action === 'delete' || step.action === 'release') {
    return undefined
  }
  const key = objectOf(step.address)
  const names = namesOf(plan)
  const live = Object.values(observation.members[key] ?? {})
    .flat()
    .map((name) => names.localProperty(key, name))
  const created = plan.steps
    .filter((s) => hasEffect(s) && s.action === 'create' && kindOf(s.address) === 'property')
    .filter((s) => objectOf(s.address) === key)
    .map((s) => nameOf(s.address))
  const held = new Set([...live, ...created])
  const missing = unheldNames(schemaWrites(step), (name) => held.has(name))
  return missing.length > 0
    ? `it names ${missing.join(', ')}, which HubSpot will not hold, and HubSpot refuses that`
    : undefined
}

// An adopt needs no owning entry and an update one; neither writes what no builder carries, what HubSpot defines, or
// what HubSpot has no update for.
function writeRefusal(step: PlanStep, trusted: Trusted, observation: ApplyObservation): string | undefined {
  const { owned } = trusted
  if (step.action === 'adopt' && owned) {
    return 'state owns it already'
  }
  if (step.action === 'update' && !owned) {
    return 'no state entry owns it on this target'
  }
  const observed = observation.resources[step.address]
  const unsupported = observation.unsupported.includes(step.address)
  if (unsupported || observed?.managed === false) {
    return unsupported ? 'Kalup does not write this kind of property' : 'it is HubSpot-defined or calculated'
  }
  const units = unitsOf(step, trusted, observed)
  const written = (step.changes ?? []).map((c) => c.unit)
  return writeBlock(kindOf(step.address), units, written, observation.meta[step.address])?.detail
}

// `owner`: the entry that owns the address, if any. A delete no entry owns runs only as takeover's archive, and a
// delete labelled takeover meets the rules takeover.ts gives the planner, owned or not: what the plan and the host
// carry of them (takeoverRule), then against this read, never what HubSpot defines, a property in a group a skip
// override covers or one a custom object schema names, or a group that held no property.
function deleteRefusal(
  plan: Plan,
  step: PlanStep,
  { owner, overrides, tombstones }: Pick<Held, 'overrides' | 'tombstones'> & { owner: ResourceState | undefined },
  observation: ApplyObservation,
): string | undefined {
  const takeover = step.labels?.includes('takeover') === true
  if (owner === undefined && !takeover) {
    return 'no state entry owns it on this target, and Kalup deletes only what it created or adopted there'
  }
  const refused = takeover ? takeoverRule(plan, step.address, tombstones) : undefined
  if (refused !== undefined) {
    return refused
  }
  if (!plan.target.allowDestroy) {
    return `target ${sanitize(plan.target.name)} does not allow deletes`
  }
  const unchecked = owner === undefined ? [] : uncheckedFields(step, owner)
  if (unchecked.length > 0) {
    return `its expect leaves out ${unchecked.join(', ')}, which state's base holds, so an edit made in HubSpot since the review would not stop it`
  }
  const observed = observation.resources[step.address]
  if (observation.unsupported.includes(step.address) || observed?.managed === false) {
    return 'its values cannot be checked before the delete'
  }
  if (takeover && observation.meta[step.address]?.hubspotDefined === true) {
    return 'HubSpot defines it, and takeover never archives what HubSpot defines'
  }
  switch (kindOf(step.address)) {
    case 'stage':
      return stageDeleteRefusal(plan, step, observation)
    case 'pipeline':
    case 'object':
      return
    case 'group':
      return groupDeleteRefusal(plan, step, takeover, observation)
    default: {
      const named = observation.schemaNamed[objectOf(step.address)] ?? []
      const kept = takeover ? keptByRead(overrides, plan.target.name, step.address, observed, named) : undefined
      return kept === undefined
        ? deleteBlock(observation.meta[step.address])?.detail
        : `takeover never archives it: ${kept}`
    }
  }
}

// Why takeover's rules refuse a delete labelled takeover, as far as apply holds them without the project: takeover
// archives only properties and groups (takeover.ts takeoverRefusal), on an object whose mode on the target is takeover
// (the plan's, which the command checks against config), and nothing removed.ts names or a custom object's tombstone
// covers. Without the host's rules nothing says what removed.ts holds, so no takeover archive runs.
function takeoverRule(
  plan: Plan,
  address: Address,
  tombstones: TakeoverRules['tombstones'] | undefined,
): string | undefined {
  const kind = kindOf(address)
  if (kind !== 'property' && kind !== 'group') {
    const noun = kind === 'object' ? 'custom object' : kind
    return `it is labelled takeover, and takeover archives properties and groups, never a ${noun}`
  }
  const key = objectOf(address)
  if (!plan.target.takeover.includes(key)) {
    return `it is labelled takeover, and the mode of ${key} on target ${sanitize(plan.target.name)} is not takeover`
  }
  if (tombstones === undefined) {
    return 'it is labelled takeover, and apply was given no takeover rules to check it against'
  }
  if (Object.hasOwn(tombstones, address)) {
    return 'removed.ts names it, and takeover never archives what removed.ts names'
  }
  const cover = coverOf(tombstones, address)
  return cover === undefined
    ? undefined
    : `removed.ts names ${cover}, which takes it along, and takeover never archives what a tombstone covers`
}

// A group delete: takeover never archives a group that held no property, and the group must hold none but the
// properties the plan deletes before it.
function groupDeleteRefusal(
  plan: Plan,
  step: PlanStep,
  takeover: boolean,
  observation: ApplyObservation,
): string | undefined {
  const names = namesOf(plan)
  const key = objectOf(step.address)
  const name = names.portalName(step.address)
  if (takeover && (observation.members[key]?.[name] ?? []).length === 0) {
    return 'it held no property when apply read it, and HubSpot marks no group as its own, so takeover never archives an empty group'
  }
  // The plan's property deletes run before every group delete (runOrder), and a delete runs only once every step
  // before it verified, so the group delete goes only after these properties were deleted and verified.
  const deleted = new Set(
    runOrder(plan)
      .filter((s) => s.action === 'delete' && kindOf(s.address) === 'property' && objectOf(s.address) === key)
      .map((s) => names.portalName(s.address)),
  )
  return deleteBlock(undefined, { active: observation.members[key]?.[name] ?? [], deleted })?.detail
}

// A stage delete: derive's rule over this read as the steps before it in runOrder leave it, and the stages of its
// pipeline those steps delete.
function stageDeleteRefusal(plan: Plan, step: PlanStep, observation: ApplyObservation): string | undefined {
  const order = runOrder(plan)
  const before = order.slice(0, order.indexOf(step))
  const prefix = step.address.slice(0, step.address.lastIndexOf('/') + 1)
  const gone = new Set(
    before
      .filter((s) => s.action === 'delete' && s.address.startsWith(prefix))
      .map((s) => s.address.slice(prefix.length)),
  )
  return stageDeleteRule(afterSteps(observation.resources, before), step.address, gone, bin)?.detail
}

// What a delete must find before it runs and does not check: that the resource exists, each field the owning entry's
// base holds a unit of (the options for any option unit), and a pipeline's stages, as the plan records them live.
function uncheckedFields(step: PlanStep, owner: ResourceState): string[] {
  const captured: readonly string[] = CAPTURED[kindOf(step.address)]
  const needed = new Set(
    Object.keys(owner.base ?? {}).flatMap((unit) => {
      if (unit === 'options' || unit === 'optionsOrder') {
        return ['options']
      }
      return captured.includes(unit) ? [unit] : []
    }),
  )
  // A pipeline delete purges its stages, so it checks the full live list whatever the base holds.
  if (kindOf(step.address) === 'pipeline') {
    needed.add('stages')
  }
  const values = step.expect.values ?? {}
  const missing = [...needed].filter((field) => !Object.hasOwn(values, field))
  // A custom object archive takes everything on the object, so it checks all three counts.
  if (archivesObject(step) && !countsAll(values.takes)) {
    missing.push('takes')
  }
  missing.sort(byCodeUnit)
  return step.expect.exists === true ? missing : ['exists', ...missing]
}

// A create on an owned address recreates it: labelled reverts-ui-edit, and absent in the observation; a property also
// not archived. A group create of an archived group's name makes a new group (observed on 2026-09-29), so a group is
// recreated whatever the archived lists hold.
function recreates(
  step: PlanStep,
  observed: IRResource | undefined,
  observation: ApplyObservation,
  portalName: string,
): boolean {
  if (!step.labels?.includes('reverts-ui-edit') || observed !== undefined) {
    return false
  }
  // A group, a pipeline and a stage leave nothing archived for a create to restore.
  if (kindOf(step.address) !== 'property') {
    return true
  }
  const archived = observation.archived[objectOf(step.address)]
  return archived !== undefined && !archived.some((p) => p.name === portalName)
}

function archivedName(
  step: PlanStep,
  observation: Pick<ApplyObservation, 'archived' | 'archivedSchemas'> | undefined,
  portalName: string,
): boolean {
  // A create of an archived custom object's name purges that schema (observed 2026-10-05); HubSpot keeps names unique
  // ignoring case.
  if (kindOf(step.address) === 'object') {
    return (observation?.archivedSchemas ?? []).some((name) => name.toLowerCase() === portalName.toLowerCase())
  }
  // A group create of an archived group's name makes a group with the new label (observed on 2026-09-29). A pipeline or
  // a stage is purged, never archived.
  if (kindOf(step.address) !== 'property') {
    return false
  }
  return observation?.archived[objectOf(step.address)]?.some((p) => p.name === portalName) === true
}

// The trusted class of each unit an adopt or update writes: the step's desired values against the observation and
// the owning entry's base. A written unit the classification lacks counts as a conflict, the class that asks most.
function classesOf(
  step: PlanStep,
  trusted: Trusted,
  observation: ApplyObservation,
): Record<string, UnitClass> | undefined {
  if (step.action !== 'adopt' && step.action !== 'update') {
    return undefined
  }
  const units = unitsOf(step, trusted, observation.resources[step.address])
  const classes: Record<string, UnitClass> = {}
  for (const change of step.changes ?? []) {
    classes[change.unit] = units.find((u) => u.unit === change.unit)?.class ?? 'conflict'
  }
  return classes
}

function unitsOf(step: PlanStep, trusted: Trusted, observed: IRResource | undefined) {
  if (observed === undefined) {
    return []
  }
  return classify(baseOf(step, trusted), specOf(step.desired ?? {}), capturedSpec(observed), {
    options: 'additive',
    removedOptions: removedValues(step.changes),
  })
}

/**
 * The base a step classifies against: the owning entry's, or for an adopt the one a pull recorded, naming the portal
 * name the address resolves to. Undefined when another normalizer version wrote it.
 */
export function baseOf(step: PlanStep, trusted: Trusted): Base | undefined {
  const entry = trusted.owned ? trusted.entry : trusted.pulled
  return entry && baseFor(entry, step.address, entry.id ?? '')
}

// What plan/1's schema cannot say. Step ids are s1, s2 and on in step order: approval and the executor know a step by
// its id, which the digest leaves out, so no two steps may share one. No two effect steps share an address, and every
// $ref an effect step carries is an address. The order of the effect steps is not checked here: apply runs them in the
// order runOrder derives, whatever the file says.
function structureOf(plan: Plan): string | undefined {
  const misnumbered = plan.steps.findIndex((step, i) => step.id !== `s${i + 1}`)
  if (misnumbered !== -1) {
    const id = sanitize(String(plan.steps[misnumbered]?.id), 40)
    return `step ${misnumbered + 1} has the id ${id}, and step ids are s1, s2 and on in step order`
  }
  const effects = plan.steps.filter(hasEffect)
  const again = effects.find((step, i) => effects.findIndex((s) => s.address === step.address) !== i)
  if (again !== undefined) {
    return `${again.id} changes ${again.address}, which an earlier step changes too`
  }
  const loose = effects.find((step) => !dependencies(step).every(isAddress))
  if (loose !== undefined) {
    return `${loose.id} refers to something that is not an address`
  }
  const uncounted = effects.find((step) => archivesObject(step) && !countsAll(step.expect.values?.takes))
  if (uncounted !== undefined) {
    return `${uncounted.id} archives ${uncounted.address}, and its expect does not count the properties, groups and pipelines it takes`
  }
  return undefined
}

function archivesObject(step: PlanStep): boolean {
  return step.action === 'delete' && kindOf(step.address) === 'object'
}

/**
 * E_BINDING_CHANGED before approval: an effect step other than a release is on an object kalup.config.ts does not
 * declare under objects, the plan's name bindings are not the ones the name overrides of the plan's target in `config`
 * give its effect steps, or two effect steps other than releases resolve to one portal resource. A custom object's
 * type ID is checked under the lock, against the schemas list (observeForApply). A release sends nothing, and plan
 * releases an entry on an object config no longer declares.
 */
export function checkNames(plan: Plan, config: Pick<ConfigFile, 'objects' | 'targets'>): void {
  const target = Object.hasOwn(config.targets, plan.target.name) ? config.targets[plan.target.name] : undefined
  const overrides = target?.overrides ?? {}
  const effects = plan.steps.filter(hasEffect)
  const writing = effects.filter((s) => s.action !== 'release')
  const named = (bindings: Plan['bindings']) =>
    Object.fromEntries(
      Object.entries(bindings).flatMap(([address, b]) => (b.name === undefined ? [] : [[address, { name: b.name }]])),
    )
  const undeclared = [...new Set(writing.flatMap(dependencies).map(objectOf))]
    .filter((key) => !Object.hasOwn(config.objects, key))
    .sort(byCodeUnit)
    .map((key) => `the plan touches ${key}, which kalup.config.ts does not declare under objects`)
  const expected = named(bindingsFor(effects, overrides, () => undefined))
  const problems = [...undeclared, ...bindingChanges({ bindings: named(plan.bindings), steps: plan.steps }, expected)]
  const names = namesOf(plan, overrides)
  const seen = new Map<string, Address>()
  for (const step of writing) {
    const resource = portalResource(step.address, names)
    const first = seen.get(resource)
    if (first !== undefined) {
      problems.push(`${first} and ${step.address} both resolve to ${resource} in the portal`)
    }
    seen.set(resource, step.address)
  }
  if (problems.length > 0) {
    throw new KalupError({
      code: 'E_BINDING_CHANGED',
      message: sanitize(
        `plan ${plan.planId} does not name what kalup.config.ts names on target ${plan.target.name}: ${problems.join('; ')}. Nothing was written.`,
        TEXT_MAX * 2,
      ),
      fix: `run ${bin} plan ${targetFlag(plan.target.name)} --out <file> again and review it; a plan file is never edited by hand`,
    })
  }
}

// The portal resource an address resolves to: its kind, the object type its paths take (a custom object's bound type
// ID) and its portal name.
function portalResource(address: Address, names: Pick<Names, 'objectType' | 'pipelineId' | 'portalName'>): string {
  const kind = kindOf(address)
  const object = kind === 'object' ? '' : `${names.objectType(objectOf(address))}/`
  const under = kind === 'stage' ? `${names.pipelineId(address)}/` : ''
  return `${kind}:${object}${under}${names.portalName(address)}`
}

/**
 * The effect steps in the order apply runs them, from their actions and addresses alone, never the file's order:
 * custom object creates, then groups, then properties (a property may name a group the run creates), then the other
 * custom object steps (a display field may name a property the run creates; each create's display step runs here), then
 * pipeline creates, then the other stage steps (those that close a stage first, since a ticket pipeline keeps a closed
 * stage), then the other pipeline steps (a stage order is written once the pipeline's new stages exist), then releases,
 * then property deletes, then group deletes, so a group is deleted only after the deletes of its properties, then stage
 * deletes, then pipeline deletes, then custom object archives, which take what is left on the object along. Plan order
 * within each phase.
 */
export function runOrder(plan: Pick<Plan, 'steps'>): readonly PlanStep[] {
  const known = ORDERED.get(plan.steps)
  if (known) {
    return known
  }
  const effects = plan.steps.filter(hasEffect)
  // Each custom object create's display step runs with the schema updates, once every property step has run.
  const displays = effects.filter(createsObject).flatMap((step) => displayStep(step) ?? [])
  const order = formulasLast([...effects, ...displays].sort((a, b) => phase(a) - phase(b)))
  ORDERED.set(plan.steps, order)
  return order
}

// The trust pass asks for the order once per delete; a plan's steps never change, so each is ordered once.
const ORDERED = new WeakMap<readonly PlanStep[], readonly PlanStep[]>()

// Words in a calculation formula that may name a property.
const FORMULA_WORDS = /[A-Za-z0-9_]+/g

/**
 * A property step that writes a calculation formula runs after every other property step, and after each formula step
 * whose property its formula names: HubSpot refuses a formula that names a property it does not hold yet (observed,
 * 404). Formulas that name each other in a cycle keep their order.
 */
function formulasLast(steps: PlanStep[]): PlanStep[] {
  const formula = (s: PlanStep) =>
    kindOf(s.address) === 'property' && s.action !== 'delete' && typeof s.desired?.calculationFormula === 'string'
  const waiting = steps.filter(formula)
  if (waiting.length === 0) {
    return steps
  }
  const names = (s: PlanStep) => new Set(String(s.desired?.calculationFormula).match(FORMULA_WORDS))
  const ordered: PlanStep[] = []
  while (waiting.length > 0) {
    const free = waiting.find((s) => !waiting.some((o) => o !== s && names(s).has(nameOf(o.address)))) ?? waiting[0]
    ordered.push(free as PlanStep)
    waiting.splice(waiting.indexOf(free as PlanStep), 1)
  }
  const rest = steps.filter((s) => !formula(s))
  // After every object, group and property step: phase is ascending, so these come first.
  const at = rest.filter((s) => phase(s) <= 2).length
  return [...rest.slice(0, at), ...ordered, ...rest.slice(at)]
}

// Where an effect step runs, in the order runOrder gives.
function phase(step: PlanStep): number {
  const kind = kindOf(step.address)
  if (step.action === 'release') {
    return 6
  }
  if (step.action === 'delete') {
    return { object: 11, property: 7, group: 8, stage: 9, pipeline: 10 }[kind]
  }
  if (kind === 'pipeline') {
    return step.action === 'create' ? 3 : 5
  }
  if (kind === 'stage') {
    return closesStage(step.desired) ? 4 : 4.5
  }
  if (kind === 'object') {
    return step.action === 'create' ? 0 : SCHEMA_PHASE
  }
  return { group: 1, property: 2 }[kind]
}

// Custom object steps other than a create run once the properties exist: a display field may name one the run creates.
const SCHEMA_PHASE = 2.5

// The display steps runOrder derived, so apply can tell one from a plan step.
const DISPLAYS = new WeakSet<PlanStep>()

/**
 * The step that sets what a custom object create could not: the display, required and searchable fields config states
 * that name the object's own properties, which HubSpot refuses until they exist (observed 2026-10-05). It is derived
 * from the create step alone, so a plan file cannot add or drop it, and runs as an update of the object with its own
 * id and report: the create's report and entry stay as the create left them. Undefined when the create sets them all.
 */
export function displayStep(create: PlanStep): PlanStep | undefined {
  const desired = create.desired ?? {}
  const tail = objectTail(desired)
  const created = createdDisplay(desired)
  const units = Object.keys(tail)
  if (units.length === 0) {
    return undefined
  }
  const step: PlanStep = {
    id: `${create.id}.display`,
    address: create.address,
    action: 'update',
    risk: 'safe',
    transport: create.transport,
    ...(create.api ? { api: create.api } : {}),
    title: '',
    desired,
    changes: units.map((unit) => ({
      unit,
      class: 'config-change',
      op: 'set',
      before: created[unit] ?? null,
      after: tail[unit],
    })),
    expect: { exists: true },
  }
  DISPLAYS.add(step)
  return step
}

/** Whether runOrder derived this step from a custom object create. */
export function isDisplayStep(step: PlanStep): boolean {
  return DISPLAYS.has(step)
}

// Each change that does not write the step's own desired value for its unit. options.order is computed from the
// options that will exist, and a remove writes nothing.
function disagreement(step: PlanStep): string[] {
  const changed = (step.changes ?? []).flatMap((change) => {
    if (change.unit === 'options.order') {
      return []
    }
    if (ORDERS.has(change.unit)) {
      return orderDisagreement(step, change)
    }
    const member = memberOf(change.unit)
    const desired = desiredValue(step.desired, change.unit)
    let fits: boolean
    if (change.op === 'remove') {
      fits = member !== undefined && member.field === undefined && desired === undefined && change.after === null
    } else if (change.op === 'add') {
      fits = member !== undefined && member.field === undefined && sameValue(change.after, desired)
    } else {
      fits =
        member?.field !== undefined || fieldOf(change.unit) === change.unit ? sameValue(change.after, desired) : false
    }
    return fits ? [] : [`step ${step.id} changes ${sanitize(change.unit)} to a value its desired values do not hold`]
  })
  return [...carriedDisagreement(step), ...changed]
}

// The stage order written is config's order of the stages that will exist: the desired order, some left out.
function orderDisagreement(step: PlanStep, change: PlanChange): string[] {
  const desired = (step.desired?.[change.unit] ?? []) as unknown[]
  const { after } = change
  const fits =
    Array.isArray(after) && stableStringify(desired.filter((id) => after.includes(id))) === stableStringify(after)
  return fits ? [] : [`step ${step.id} writes a ${sanitize(change.unit)} order its desired values do not hold`]
}

// The stages a pipeline create carries: only on a pipeline create, each a stage of that pipeline, in the order its
// desired stage IDs give.
function carriedDisagreement(step: PlanStep): string[] {
  if (step.stages === undefined) {
    return []
  }
  const prefix = `${step.address.replace('pipeline:', 'stage:')}/`
  const ids = step.stages.map((st) => st.address.slice(prefix.length))
  const desired = ((step.desired?.stages ?? []) as unknown[]).filter((id) => ids.includes(id as string))
  const ok =
    step.action === 'create' &&
    kindOf(step.address) === 'pipeline' &&
    step.stages.every((st) => st.address.startsWith(prefix) && !st.address.slice(prefix.length).includes('/')) &&
    stableStringify(desired) === stableStringify(ids)
  return ok ? [] : [`step ${step.id} carries stages that are not its own pipeline's, in its order`]
}

function sameValue(a: unknown, b: unknown): boolean {
  return b !== undefined && stableStringify(a) === stableStringify(b)
}

function invalid(message: string): KalupError {
  return new KalupError({
    code: 'E_PLAN_INVALID',
    message: `${message}. Nothing was sent.`,
    fix: `save the plan again with ${bin} plan --target <name> --out <file>, and apply that file`,
  })
}

function destination(message: string, fix: string): KalupError {
  const issue: Issue = { code: 'E_PLAN_DESTINATION', message: `${message}. Nothing was sent.`, fix }
  return new KalupError(issue)
}

// A plan's step addresses were checked by the schema: every one parses.
function kindOf(address: Address): Kind {
  return parseAddress(address).type as Kind
}

// Every word comes from data the digest covers: an added option from its change's after, a removed one from the live
// options in expect, which apply checks against HubSpot before it writes. Never a change's before.
function writes(step: PlanStep, warned: boolean): string {
  const changes = step.changes ?? []
  const live = (step.expect.values?.options as IROption[] | undefined) ?? []
  const label = (option: unknown, unit: string) =>
    typeof (option as IROption | undefined)?.label === 'string'
      ? `"${(option as IROption).label}"`
      : String(memberOf(unit)?.value)
  return writesTail(
    changes,
    (c) =>
      c.op === 'add'
        ? label(c.after, c.unit)
        : label(Array.isArray(live) ? live.find((o) => o.value === memberOf(c.unit)?.value) : undefined, c.unit),
    warned ? fieldWords : (unit) => (unit === 'stages' ? fieldWords(unit) : unit),
  )
}
