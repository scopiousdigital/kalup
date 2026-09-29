// What apply checks before it writes, docs/architecture.md section 7. Pure: the command and the executor pass what they
// read. parsePlan checks a saved file's generator version, plan/1, its digest and its own consistency; the destination,
// policy and version checks run after the portal guard; trustSteps derives each effect step's blocked status, risk and labels from
// state, policy and a fresh observation with derive.ts, and compares each step's expect with that observation. Titles
// are redrawn here from step data: a plan's own titles are never printed.
import type { Target } from '@kalup/core'
import { bin } from '../brand.js'
import type { ConfigFile } from '../grammar/types.js'
import { isAddress, parseAddress } from '../ir/address.js'
import { stableStringify } from '../ir/serialize.js'
import type { Base, ResourceState, TargetState } from '../ir/state.js'
import type { Address, IR, IROption, IRResource, Issue } from '../ir/types.js'
import { exitCodes, KalupError } from '../lib/errors.js'
import { NORM_VERSIONS, registry } from '../lib/registry.js'
import { sanitize } from '../lib/sanitize.js'
import { effectiveResources } from '../loader/effective.js'
import { byCodeUnit } from '../loader/load.js'
import { classify, type UnitClass } from '../plan/classify.js'
import type { Plan, PlanAction, PlanStep, Risk } from '../plan/types.js'
import { validatePlan } from '../plan/validate.js'
import { type ApplyObservation, bindingChanges, type Names, namesOf } from './apply-observe.js'
import { memberOf, removedValues } from './apply-payload.js'
import { deleteBlock, fieldOf, stepLabels, stepRisk, writeBlock } from './derive.js'
import { hasEffect, writesHash } from './digest.js'
import { bindingsFor, dependencies } from './plan.js'
import type { Policy } from './policy.js'
import { notJson, parseJson } from './snapshot.js'
import { CAPTURED, capturedSpec, nameOf, objectOf, shellWord, specOf, targetFlag } from './units.js'

/** What trusted derivation learned about one effect step, for the executor. */
export interface Trusted {
  /** The state entry at the address, owning or not. */
  entry?: ResourceState
  /** The entry owns the address: created or adopted, and naming the portal name it resolves to. */
  owned: boolean
}

type Kind = 'object' | 'group' | 'property'

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

/**
 * E_PLAN_DELETE before approval: a delete step whose address kalup.config.ts and kalup/removed.ts do not ask to
 * delete. `ir` is the project as the loader read it, as data. A delete needs a destroy tombstone, which kalup rm writes
 * (a delete's first key), and an address that is gone from config, so preventDestroy cannot still hold it. No resource
 * config still holds may resolve to the same portal resource through the target's name overrides.
 */
export function checkDeletes(plan: Plan, ir: IR): void {
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
    .flatMap(({ address }) => {
      const resource = Object.hasOwn(effective, address) ? effective[address] : undefined
      if (resource?.lifecycle?.preventDestroy === true) {
        return [`${address} is in config and sets lifecycle.preventDestroy`]
      }
      if (resource !== undefined || Object.hasOwn(ir.resources, address)) {
        return [`${address} is still in config`]
      }
      const portal = portalResource(address, names)
      const held = holders.get(portal) ?? []
      const guarded = held.find((a) => effective[a]?.lifecycle?.preventDestroy === true)
      if (guarded !== undefined) {
        return [
          `${address} resolves to ${portal} in the portal, which config holds as ${guarded} and protects with lifecycle.preventDestroy`,
        ]
      }
      if (held.length > 0) {
        return [`${address} resolves to ${portal} in the portal, which config still holds as ${held.join(', ')}`]
      }
      const tombstone = Object.hasOwn(ir.tombstones, address) ? ir.tombstones[address] : undefined
      return tombstone?.action === 'destroy' ? [] : [`${address} has no destroy tombstone in kalup/removed.ts`]
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

/** E_POLICY_CHANGED when the target's effective policy is not the one the plan recorded, naming each field. */
export function checkPolicy(plan: Plan, policy: Policy): void {
  const fields = ['protected', 'drift', 'allowDestroy'] as const
  const changed = fields.filter((field) => plan.target[field] !== policy[field])
  if (changed.length > 0) {
    const what = changed.map((field) => `${field} was ${plan.target[field]}, now ${policy[field]}`).join('; ')
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

/**
 * Checks every effect step against state and the fresh observation. E_PLAN_STALE, listing what moved, when an expect
 * no longer holds; else E_PLAN_RISK when trusted derivation blocks a step, derives a higher risk than the plan states,
 * or a label the plan omits. What it learned per step id.
 */
export function trustSteps(plan: Plan, state: TargetState | null, observation: ApplyObservation): Map<string, Trusted> {
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
    trusted.set(step.id, entry ? { entry, owned } : { owned })
    problems.push(...disagreements(plan, step, entry, owned, observation))
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

// Where trusted derivation disagrees with a step: it blocks the step, derives a higher risk, or a label the step lacks.
function disagreements(
  plan: Plan,
  step: PlanStep,
  entry: ResourceState | undefined,
  owned: boolean,
  observation: ApplyObservation,
): string[] {
  const block = blockOf(plan, step, entry, owned, observation)
  if (block) {
    return [`${step.id} ${step.action} ${step.address} cannot run: ${block}`]
  }
  const context = { drift: plan.target.drift, classes: classesOf(step, entry, owned, observation) }
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
 * round; `archived` when a create's name is archived in HubSpot now; each expected field whose live value differs.
 */
export function staleUnits(
  step: PlanStep,
  observed: IRResource | undefined,
  observation?: Pick<ApplyObservation, 'archived' | 'archivedGroups'>,
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
      const now = field === 'options' ? (observed.definition?.options ?? []) : live[field]
      return stableStringify(now) !== stableStringify(value)
    })
    .map(([field]) => field)
    .sort(byCodeUnit)
}

/**
 * A step's title from its own data, never the plan's: the kind, the label config gives, the name and the object. With
 * `names`, the portal name follows the name wherever the two differ.
 */
export function stepTitle(step: PlanStep, names?: Pick<Names, 'portalName'>): string {
  const { address, action } = step
  const kind = kindOf(address)
  const own = nameOf(address)
  const portal = names?.portalName(address)
  const name = portal === undefined || portal === own ? own : `${own}, portal name ${portal}`
  const noun = { object: 'custom object', group: 'property group', property: 'property' }[kind]
  const where = kind === 'object' ? '' : ` on ${objectOf(address)}`
  // A custom object's label is its singular one.
  const shown =
    kind === 'object' ? (step.desired?.labels as { singular?: unknown } | undefined)?.singular : step.desired?.label
  const label = typeof shown === 'string' ? ` "${shown}"` : ''
  const what = `${noun}${label} (${name})${where}`
  const titles: Partial<Record<PlanAction, () => string>> = {
    create: () => `${step.labels?.includes('reverts-ui-edit') ? 'Recreate' : 'Create'} ${what}`,
    adopt: () => `Adopt ${what}${writes(step)}`,
    update: () =>
      (step.changes ?? []).length > 0 ? `Update ${what}${writes(step)}` : `Record the agreed values of ${what}`,
    delete: () =>
      `Archive ${noun} ${portal === undefined || portal === own ? own : `${own} (portal name ${portal})`}${where}`,
    release: () => `Stop managing ${noun} ${own}${where}; nothing changes in HubSpot`,
  }
  const title = titles[action]
  return sanitize(title ? title() : `${action} ${address}`, TITLE_MAX)
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
// recreate; update, delete and release need one (a release drops any entry at the address). A delete needs the policy,
// an archivable property and, for a group, no remaining member apart from the properties this plan deletes before it.
function blockOf(
  plan: Plan,
  step: PlanStep,
  entry: ResourceState | undefined,
  owned: boolean,
  observation: ApplyObservation,
): string | undefined {
  const kind = kindOf(step.address)
  // A custom object is adopted, or its base recorded, and never written: writeBlock refuses any change to it.
  if (kind === 'object' && step.action !== 'adopt' && step.action !== 'update') {
    return 'custom object schema writes are not supported in this release'
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
      return writeRefusal(step, entry, owned, observation)
    case 'delete':
      return deleteRefusal(plan, step, owned ? entry : undefined, observation)
    case 'release':
      return entry === undefined ? 'state has no entry at this address' : undefined
    default:
      return `${sanitize(step.action)} is not a step apply runs`
  }
}

// An adopt needs no owning entry and an update one; neither writes what no builder carries, what HubSpot defines, or
// what HubSpot has no update for.
function writeRefusal(
  step: PlanStep,
  entry: ResourceState | undefined,
  owned: boolean,
  observation: ApplyObservation,
): string | undefined {
  if (step.action === 'adopt' && owned) {
    return 'state owns it already'
  }
  if (step.action === 'update' && !owned) {
    return 'no state entry owns it on this target'
  }
  const observed = observation.resources[step.address]
  const unsupported = observation.unsupported.includes(step.address)
  if (unsupported || observed?.managed === false) {
    return unsupported ? 'no builder carries its portal type' : 'it is HubSpot-defined or calculated'
  }
  const units = unitsOf(step, entry, owned, observed)
  const written = (step.changes ?? []).map((c) => c.unit)
  return writeBlock(kindOf(step.address), units, written, observation.meta[step.address])?.detail
}

// `owner`: the entry that owns the address, if any.
function deleteRefusal(
  plan: Plan,
  step: PlanStep,
  owner: ResourceState | undefined,
  observation: ApplyObservation,
): string | undefined {
  if (owner === undefined) {
    return 'no state entry owns it on this target, and Kalup deletes only what it created or adopted there'
  }
  if (!plan.target.allowDestroy) {
    return `target ${sanitize(plan.target.name)} does not allow deletes`
  }
  const unchecked = uncheckedFields(step, owner)
  if (unchecked.length > 0) {
    return `its expect leaves out ${unchecked.join(', ')}, which state's base holds, so an edit made in HubSpot since the review would not stop it`
  }
  const observed = observation.resources[step.address]
  if (observation.unsupported.includes(step.address) || observed?.managed === false) {
    return 'its values cannot be checked before the delete'
  }
  const names = namesOf(plan)
  const key = objectOf(step.address)
  if (kindOf(step.address) !== 'group') {
    return deleteBlock(observation.meta[step.address])?.detail
  }
  const archived = observation.archived[key]
  if (archived === undefined) {
    return `the archived properties of ${key} were not read`
  }
  const name = names.portalName(step.address)
  // The plan's property deletes run before every group delete (runOrder), and a delete runs only once every step
  // before it verified, so the group delete goes only after these properties were deleted and verified.
  const deleted = new Set(
    runOrder(plan)
      .filter((s) => s.action === 'delete' && kindOf(s.address) === 'property' && objectOf(s.address) === key)
      .map((s) => names.portalName(s.address)),
  )
  const members = {
    active: observation.members[key]?.[name] ?? [],
    archived: archived.filter((p) => p.groupName === name).map((p) => p.name),
    deleted,
  }
  return deleteBlock(undefined, members)?.detail
}

// What a delete must find before it runs and does not check: that the resource exists, and each field the owning
// entry's base holds a unit of (the options for any option unit), as the plan records them from the live values.
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
  const values = step.expect.values ?? {}
  const missing = [...needed].filter((field) => !Object.hasOwn(values, field)).sort(byCodeUnit)
  return step.expect.exists === true ? missing : ['exists', ...missing]
}

// A create on an owned address recreates it: labelled reverts-ui-edit, a property the observation shows absent and not
// archived. A group has no documented archived flag, so no group is recreated.
function recreates(
  step: PlanStep,
  observed: IRResource | undefined,
  observation: ApplyObservation,
  portalName: string,
): boolean {
  if (!step.labels?.includes('reverts-ui-edit') || kindOf(step.address) !== 'property' || observed !== undefined) {
    return false
  }
  const archived = observation.archived[objectOf(step.address)]
  return archived !== undefined && !archived.some((p) => p.name === portalName)
}

function archivedName(
  step: PlanStep,
  observation: Pick<ApplyObservation, 'archived' | 'archivedGroups'> | undefined,
  portalName: string,
): boolean {
  const key = objectOf(step.address)
  if (kindOf(step.address) === 'group') {
    return observation?.archivedGroups[key]?.includes(portalName) === true
  }
  return observation?.archived[key]?.some((p) => p.name === portalName) === true
}

// The trusted class of each unit an adopt or update writes: the step's desired values against the observation and
// the owning entry's base. A written unit the classification lacks counts as a conflict, the class that asks most.
function classesOf(
  step: PlanStep,
  entry: ResourceState | undefined,
  owned: boolean,
  observation: ApplyObservation,
): Record<string, UnitClass> | undefined {
  if (step.action !== 'adopt' && step.action !== 'update') {
    return undefined
  }
  const units = unitsOf(step, entry, owned, observation.resources[step.address])
  const classes: Record<string, UnitClass> = {}
  for (const change of step.changes ?? []) {
    classes[change.unit] = units.find((u) => u.unit === change.unit)?.class ?? 'conflict'
  }
  return classes
}

function unitsOf(step: PlanStep, entry: ResourceState | undefined, owned: boolean, observed: IRResource | undefined) {
  if (observed === undefined) {
    return []
  }
  return classify(baseOf(step, entry, owned), specOf(step.desired ?? {}), capturedSpec(observed), {
    options: 'additive',
    removedOptions: removedValues(step.changes),
  })
}

/** The base an owning entry holds for the step's type, or undefined when another normalizer version wrote it. */
export function baseOf(step: PlanStep, entry: ResourceState | undefined, owned: boolean): Base | undefined {
  const kind = kindOf(step.address)
  return owned && entry && (entry.normVersion ?? NORM_VERSIONS[kind]) === NORM_VERSIONS[kind] ? entry.base : undefined
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
  return undefined
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
function portalResource(address: Address, names: Pick<Names, 'objectType' | 'portalName'>): string {
  const kind = kindOf(address)
  return `${kind}:${kind === 'object' ? '' : `${names.objectType(objectOf(address))}/`}${names.portalName(address)}`
}

/**
 * The effect steps in the order apply runs them, from their actions and addresses alone, never the file's order:
 * groups, then properties (a property may name a group the run creates), then releases, then property deletes, then
 * group deletes, so a group is deleted only after the deletes of its properties. Plan order within each phase.
 */
export function runOrder(plan: Pick<Plan, 'steps'>): PlanStep[] {
  return plan.steps.filter(hasEffect).sort((a, b) => phase(a) - phase(b))
}

// Where an effect step runs: objects, groups, then properties, then releases, then property deletes, then group
// deletes.
function phase(step: PlanStep): number {
  const kind = kindOf(step.address)
  if (step.action === 'release') {
    return 3
  }
  if (step.action === 'delete') {
    return kind === 'group' ? 5 : 4
  }
  return { object: 0, group: 1, property: 2 }[kind]
}

// Each change that does not write the step's own desired value for its unit. options.order is computed from the
// options that will exist, and a remove writes nothing.
function disagreement(step: PlanStep): string[] {
  return (step.changes ?? []).flatMap((change) => {
    if (change.unit === 'options.order') {
      return []
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
function writes(step: PlanStep): string {
  const changes = step.changes ?? []
  const live = (step.expect.values?.options as IROption[] | undefined) ?? []
  const label = (option: unknown, unit: string) =>
    typeof (option as IROption | undefined)?.label === 'string'
      ? `"${(option as IROption).label}"`
      : memberOf(unit)?.value
  const set = changes.filter((c) => c.op === 'set').map((c) => c.unit)
  const added = changes.filter((c) => c.op === 'add').map((c) => label(c.after, c.unit))
  const removed = changes
    .filter((c) => c.op === 'remove')
    .map((c) => label(Array.isArray(live) ? live.find((o) => o.value === memberOf(c.unit)?.value) : undefined, c.unit))
  return [
    set.length > 0 ? `, set ${set.join(', ')}` : '',
    added.length > 0 ? `, add options ${added.join(', ')}` : '',
    removed.length > 0 ? `, remove options ${removed.join(', ')}` : '',
  ].join('')
}
