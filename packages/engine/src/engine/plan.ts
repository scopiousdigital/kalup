// kalup plan's engine: what apply would do to one target, from the config, the target's observation, its state and the
// reads planReads asks for. Pure: the command reads the portal and state first and prints the result. State decides
// ownership and the base: an address state owns is updated against its base, one it does not own is adopted
// with every difference held, and only a tombstone on an owned address deletes or releases. derive.ts decides what each
// unit becomes, each step's risk and labels, and what HubSpot lets a step write.
import type { Override } from '@kalup/core'
import { bin } from '../brand.js'
import { isAddress, parseAddress } from '../ir/address.js'
import { DEFAULTS } from '../ir/defaults.js'
import { escapeJson, stableStringify } from '../ir/serialize.js'
import type { Base, ResourceState, TargetState } from '../ir/state.js'
import type {
  Address,
  Coverage,
  IROption,
  IRResource,
  IRTombstone,
  Issue,
  ObjectCoverage,
  Ref,
  UnsupportedProperty,
} from '../ir/types.js'
import { KalupError } from '../lib/errors.js'
import type { PortalInfo } from '../lib/guard.js'
import { pinWarnings } from '../lib/pins.js'
import { plural } from '../lib/plural.js'
import { unsupportedReason } from '../lib/pull/normalize.js'
import type { ArchivedProperty } from '../lib/pull/read.js'
import { addressMatcher, STANDARD_OBJECT_TYPE_IDS, STANDARD_OBJECTS } from '../lib/pull/scope.js'
import { NORM_VERSIONS, registry } from '../lib/registry.js'
import { sanitize } from '../lib/sanitize.js'
import { effectiveResources } from '../loader/effective.js'
import { byCodeUnit, type Loaded } from '../loader/load.js'
import { FIELD_TYPES, HUBSPOT_TYPES, OBJECT_DEFAULT_PROPERTIES, OBJECT_DISPLAY_FIELDS } from '../loader/tables.js'
import { classify, ORDERS, type UnitResult } from '../plan/classify.js'
import type {
  BlockedReason,
  LimitReading,
  Plan,
  PlanBinding,
  PlanChange,
  PlanHeld,
  PlanMissing,
  PlanNote,
  PlanOrphan,
  PlanStage,
  PlanStep,
} from '../plan/types.js'
import { validatePlan } from '../plan/validate.js'
import { objectTail } from './apply-payload.js'
import {
  ASSIGNED,
  afterSteps,
  type Block,
  closesStage,
  deleteBlock,
  deriveChange,
  fieldOf,
  type Kind,
  type Members,
  REVERTING,
  type StepContext,
  stageDeleteRule,
  stepLabels,
  stepRisk,
  writeBlock,
  writesPipelines,
} from './derive.js'
import { hasEffect, sha256, writesHash } from './digest.js'
import { type Observation, objectTypeIds, type PropertyMeta, type Status, statusOf } from './observe.js'
import { type Policy, policyOf } from './policy.js'
import { headroom, type LimitRequest } from './preflight.js'
import { modeOf, optionsOf, takeoverObjects } from './settings.js'
import { type Candidates, takeoverCandidates } from './takeover.js'
import {
  acceptCommand,
  baseFor,
  capturedSpec,
  fieldWords,
  keptNote,
  nameOf,
  objectOf,
  ownedFields,
  ownId,
  PURGED,
  pipelineOf,
  placeOf,
  pullCommand,
  shadowedNote,
  shadows,
  shellWord,
  shownName,
  specOf,
  takeCommand,
  targetFlag,
  writesTail,
} from './units.js'

export interface PlanInput {
  /** Per object key planReads named, its archived properties. */
  archivedProperties: Record<string, ArchivedProperty[]>
  /** The names of the custom object schemas HubSpot holds archived, when planReads asked for them. */
  archivedSchemas?: string[]
  /** The HTTP client's dailyRemaining once every read is done. */
  dailyRemaining: number | null
  /** What preflight read for planReads' request. */
  limits: LimitReading[]
  loaded: Pick<Loaded, 'config' | 'ir' | 'optionsStated'>
  /** observeTarget's observation of the target. */
  observation: Observation
  /** What the portal guard verified. */
  portal: Pick<PortalInfo, 'accountType' | 'portalId' | 'uiDomain'>
  /** The verified portal's state as the command read it; null when it has none. */
  state: TargetState | null
  /** The `--take config` selectors, in the order given. */
  take: Selector[]
  target: string
  /** The CLI's version, the generator's. The name is the brand's. */
  version: string
}

/**
 * One `--take config` selector: an address, which may hold the `*` of `--only`, and optionally a unit. A unit selects
 * itself and the units under it: `options` every option unit, `options[low]` that option's fields.
 */
export interface Selector {
  address: string
  unit?: string
}

export interface Planned {
  /** W_LIMIT_HEADROOM, W_INCOMPLETE, W_RATE_HEADERS, and W_PIN_EXPIRES for the registry rows the steps use. */
  issues: Issue[]
  plan: Plan
}

export interface PlanReads {
  /**
   * For each object that exists and gets a property create, or holds a property state owns that HubSpot no longer
   * has: the object type archivedProperties takes. A group delete needs no archived list: only active properties
   * block it (observed 2026-10-01).
   */
  archived: Record<string, string>
  limits: LimitRequest
  /**
   * Whether the plan creates a custom object: the command then reads the archived schemas, since a create of an archived
   * schema's name purges it (observed 2026-10-05).
   */
  schemas: boolean
}

type StepInput = Omit<PlanInput, 'dailyRemaining' | 'portal' | 'version'>
type Owned = ResourceState & { origin: 'created' | 'adopted' }

/** Who owns an address on this target. */
interface Owner {
  /** The state entry that owns it: created or adopted, and naming the portal name the address resolves to. */
  entry?: Owned
  /** A created or adopted entry that names another portal name, so owns nothing here. */
  stale?: Owned
}

interface Context {
  coverage: Coverage
  /** The steps decided so far, by address: a later step looks up its parents here. */
  decided: Map<Address, PlanStep>
  /** Every config address state owns and HubSpot no longer holds, and whether a take selected it. */
  gone: { address: Address; taken: boolean }[]
  input: StepInput
  /** The indexes of the take selectors that matched a held unit or a missing resource. */
  matched: Set<number>
  /** Owned config resources HubSpot no longer holds that no take recreates. */
  missing: PlanMissing[]
  overrides: Record<string, Override>
  /** The pipelines and stages the observation holds, by object: the ID rules look them up once per plan. */
  pipelines: PipelineIndex
  policy: Pick<Policy, 'adopt' | 'allowDestroy' | 'drift'>
  /** What takeover would archive on the target, from its observation. */
  takeover: Candidates
}

interface PipelineIndex {
  /** The pipelines the observation holds, by object. */
  pipelines: Map<string, Address[]>
  /** The stages the observation holds, by object. */
  stages: Map<string, Address[]>
}

function indexPipelines(observation: Observation): PipelineIndex {
  const out: PipelineIndex = { pipelines: new Map(), stages: new Map() }
  for (const address of Object.keys(observation.resources)) {
    const kind = kindOf(address)
    if (kind === 'pipeline' || kind === 'stage') {
      const by = out[kind === 'pipeline' ? 'pipelines' : 'stages']
      by.set(objectOf(address), [...(by.get(objectOf(address)) ?? []), address])
    }
  }
  return out
}

interface Decided {
  excluded: Address[]
  gone: Context['gone']
  issues: Issue[]
  matched: Set<number>
  missing: PlanMissing[]
  steps: PlanStep[]
}

/** A present resource config manages, classified. */
interface Present {
  action: 'adopt' | 'update'
  address: Address
  /** The base the units were classified against. */
  base: Base | undefined
  kind: Kind
  observed: IRResource
  owned: Record<string, unknown>
  owner: Owner
  resource: IRResource
  units: UnitResult[]
}

// The fields a create's line starts with, and the ones it marks because HubSpot never changes them after the create.
const CREATED_FIRST = ['label', 'group', 'fieldType']
const CREATE_ONLY = new Set(['hasUniqueValue', 'dataSensitivity'])
// Fields a create's line leaves to other lines: the builder's type, the options, a pipeline's stage IDs.
const HIDDEN_CREATED = new Set(['type', 'options', 'stages'])

// Step order: objects, then groups, then properties, then pipelines and their stages.
const KINDS: Kind[] = ['object', 'group', 'property', 'pipeline', 'stage']

// Every planned type's registry row is ga with write paths, so every step goes through the public API.
const TRANSPORT = 'public-api'

// The order of these lists means nothing, so they compare as sets, as in classify.
const SETS = new Set(['requiredProperties', 'searchableProperties'])

// The steps that carry their config resource's provenance, the blueprint it came from (architecture section 7). It is
// for the person reading the plan: writesHash leaves it out.
const PROVENANCE_ACTIONS = new Set<PlanStep['action']>(['create', 'adopt', 'update', 'delete'])

const NOT_COVERED: Partial<Record<Kind, string>> = {
  object: 'Not copied, HubSpot has no API: record page layouts, saved views.',
  property: 'Not copied, HubSpot has no API: conditional property logic, field-level permissions.',
  pipeline:
    'Not copied, HubSpot has no API: stage required properties, conditional stage properties, pipeline automation, pipeline permissions.',
}

// Why a pipeline or stage of an object other than deals, tickets and a custom object is not written.
function noPipelineWrites(object: string): string {
  return `Kalup reads and compares the pipelines of ${object} and does not write them in this release`
}

const INCOMPLETE_FIX = 'give the key the scopes the plan warns about, then plan again'

const TITLE_MAX = 160
const TEXT_MAX = 400
const VALUE_MAX = 80
const LINE_MAX = 400

/**
 * The plan for `input.target`: one step per object, group and property config manages, except those a skip override
 * leaves out or that agree with the portal and their base, then the releases and deletes the tombstones ask for. It
 * conforms to plan/1 before it is returned; a plan that does not is a bug and throws E_PLAN_SCHEMA. A take selector
 * that matches nothing throws E_TAKE_UNMATCHED.
 */
export function plan(input: PlanInput): Planned {
  const { loaded, observation, portal, state, target } = input
  const coverage = coverageOf(observation)
  const decided = decide(effective(input), coverage)
  const { steps, excluded, issues, missing } = decided
  unmatched(input, decided)
  const keys = new Set(steps.map((s) => objectOf(s.address)))
  const unobserved = [...keys].filter((key) => own(coverage.objects, key) === undefined).sort(byCodeUnit)
  const policy = loaded.config.targets[target] ?? {}
  const open = steps.filter((s) => s.risk !== 'blocked')
  const kinds = KINDS.filter((kind) => steps.some((s) => kindOf(s.address) === kind))
  const planTarget: Plan['target'] = {
    name: target,
    portalId: portal.portalId,
    accountType: portal.accountType,
    uiDomain: portal.uiDomain,
    ...policyOf(policy, portal.accountType),
    takeover: takeoverObjects(loaded.config, target),
  }
  // Only what apply runs: a held-only step that appears or clears changes nothing an approval binds.
  const bindings = bindingsOf(steps.filter(hasEffect), policy.overrides ?? {}, coverage)
  const normVersions = { ...NORM_VERSIONS }
  const stateLineage = state?.lineage ?? null
  const stateSerial = state?.serial ?? null
  const hash = writesHash({ target: planTarget, stateLineage, stateSerial, normVersions, bindings, steps })
  const result: Plan = {
    format: 'plan/1',
    planId: `pl_${hash.slice('sha256:'.length, 'sha256:'.length + 12)}`,
    generator: { name: bin, version: input.version },
    target: planTarget,
    stateLineage,
    stateSerial,
    normVersions,
    bindings,
    irHash: sha256(stableStringify(loaded.ir)),
    counts: countsOf(steps),
    permanentNames: portal.accountType === 'STANDARD' ? open.filter((s) => s.action === 'create').length : 0,
    budget: { estimatedCalls: callsOf(steps, missing, bindings), dailyRemaining: input.dailyRemaining },
    writesHash: hash,
    preflight: { limits: input.limits },
    coverage: planCoverage(coverage, steps, excluded, unobserved),
    notCovered: kinds.flatMap((kind) => {
      const line = NOT_COVERED[kind]
      return line ? [{ type: kind, lines: [line] }] : []
    }),
    orphans: orphansOf(input, steps),
    missing,
    steps,
  }
  const invalid = validatePlan(result)
  if (invalid.length > 0) {
    throw new KalupError(invalid)
  }
  const pins = pinWarnings(kinds.map((kind) => registry[kind]))
  return { plan: result, issues: [...issues, ...warnings(input, result.coverage, unobserved), ...pins] }
}

/**
 * What the command reads between the observation and plan: the Limits Tracking readings for the creates it plans, and
 * the archived properties of each object that exists and gets a property create or holds a property state owns that
 * HubSpot no longer has.
 */
export function planReads(input: Pick<PlanInput, 'loaded' | 'observation' | 'state' | 'take' | 'target'>): PlanReads {
  const { observation } = input
  const coverage = coverageOf(observation)
  // With no archived names and no limits read yet nothing is blocked on them, so these are every create the plan can
  // hold. The step text is thrown away.
  const blank = { ...effective(input), archivedProperties: {}, archivedSchemas: [], limits: [] }
  const decided = decide(blank, coverage)
  const objectCreates = decided.steps.some(
    (s) => s.action === 'create' && s.risk !== 'blocked' && kindOf(s.address) === 'object',
  )
  const creates = decided.steps
    .filter((s) => s.action === 'create' && s.risk !== 'blocked' && kindOf(s.address) === 'property')
    .map((s) => s.address)
  const gone = decided.gone.filter((g) => kindOf(g.address) === 'property')
  // The archived lists take a standard object's name, as the live lists do, and a custom object's type ID.
  const ids = objectTypeIds(observation)
  const archived: Record<string, string> = {}
  for (const key of [...creates, ...gone.map((g) => g.address)].map(objectOf)) {
    const objectType = own(ids, key) ?? (STANDARD_OBJECTS.has(key) ? key : undefined)
    if (objectType !== undefined) {
      archived[key] = objectType
    }
  }
  return {
    archived,
    schemas: objectCreates,
    limits: {
      objectTypes: objectCreates,
      properties: creates.length > 0 || gone.some((g) => g.taken),
      pipelines: decided.steps.some(
        (s) => s.action === 'create' && s.risk !== 'blocked' && kindOf(s.address) === 'pipeline',
      ),
      objectTypeIds: typeIdsOf(coverage),
    },
  }
}

/** What the project adds to a plan's text: the targets it declares and the overrides of the plan's target. */
export interface PlanProject {
  overrides: Record<string, Override>
  targets: string[]
}

/**
 * The plan as lines a person reads. Every line is sanitized: portal strings reach it. With `project`, a step holding
 * units config and the portal never agreed on also names the override that keeps the portal's values on this target
 * alone, when the project has other targets.
 */
export function planText(doc: Plan, project?: PlanProject): string {
  const { target, counts, budget } = doc
  const lines = [
    `Plan ${doc.planId} for target ${target.name}, portal ${target.portalId} (${target.accountType}, ${target.protected ? 'protected' : 'not protected'})`,
    settingsLine(target),
  ]
  // Takeover's steps follow one heading that says why they are there.
  const first = doc.steps.findIndex(takeoverNoted)
  lines.push(
    ...doc.steps.flatMap((step, i) => [
      ...(i === first ? [takeoverHeading(doc)] : []),
      ...stepLines(doc, step, project),
    ]),
    ...diverged(doc),
    ...stateLines(doc),
  )
  const daily =
    budget.dailyRemaining === null ? 'the daily remainder is unknown' : `${budget.dailyRemaining} left today`
  lines.push(
    `${counts.safe} safe, ${counts.risky} risky, ${counts.destructive} destructive, ${counts.blocked} blocked, ${counts.manual} manual; ${counts.held} held`,
    coverageText(doc.coverage),
    // A plan that asks apply for nothing costs no call, so it says nothing about the budget.
    ...(budget.estimatedCalls > 0 ? [`About ${plural(budget.estimatedCalls, 'API call')}; ${daily}.`] : []),
    ...(doc.permanentNames > 0
      ? [`${plural(doc.permanentNames, 'internal name')} created here can never be renamed.`]
      : []),
    ...doc.notCovered.flatMap((n) => n.lines),
  )
  return `${lines.map((line) => sanitize(line, LINE_MAX)).join('\n')}\n`
}

/**
 * What a plan leaves pending, as one sentence, or undefined when nothing is: steps apply would run, and steps, units
 * and resources a person has to settle, blocked steps included, and an incomplete read, which leaves unknown what the
 * unread objects need. `plan --exit-code` exits 2 when there is any.
 */
export function planPending(doc: Plan): string | undefined {
  const count = (n: number, one: string, many = `${one}s`) => (n > 0 ? [plural(n, one, many)] : [])
  const { counts, coverage } = doc
  const unreadKeys = coverage.unreadable.map((u) => u.object).join(', ')
  const parts = [
    ...count(doc.steps.filter(hasEffect).length, 'step to apply', 'steps to apply'),
    ...count(counts.blocked, 'blocked step, which counts as pending', 'blocked steps, which count as pending'),
    ...count(counts.manual, 'manual step'),
    ...count(counts.held, 'held value'),
    ...count(doc.missing.length, 'resource missing in HubSpot', 'resources missing in HubSpot'),
    ...(coverage.complete
      ? []
      : [`an incomplete read${unreadKeys ? ` (not read: ${unreadKeys})` : ''}, which counts as pending`]),
  ]
  return parts.length > 0 ? `Changes pending: ${parts.join(', ')}.` : undefined
}

// A step takeover asks for: an archive or an option removal, which carries the mode note, blocked or not.
function takeoverNoted(step: PlanStep): boolean {
  return step.notes?.some((n) => n.unit === 'mode') === true
}

// The heading before takeover's steps: what takeover does, and whether a person confirms it or every step is blocked.
function takeoverHeading(doc: Plan): string {
  const { takeover, allowDestroy, name } = doc.target
  const open = doc.steps.some((s) => takeoverNoted(s) && s.risk !== 'blocked')
  let how = 'each confirmed by a person at a terminal'
  if (!open) {
    how = allowDestroy ? 'every such step is blocked' : `blocked: allowDestroy is false on target ${name}`
  }
  return `Takeover on ${takeover.join(', ')}: what config lacks in the pull scope is archived, and options only the portal holds are removed; ${how}`
}

// One line when the plan holds units config and the portal never agreed on: the ways to write config over all of them.
function diverged(doc: Plan): string[] {
  const n = doc.steps.flatMap((s) => s.held ?? []).filter((h) => h.class === 'diverged').length
  if (n === 0) {
    return []
  }
  const { name } = doc.target
  return [
    `${plural(n, 'value')} config and HubSpot never agreed on (diverged): set adopt: 'overwrite' under targets.${name} in kalup.config.ts to write config over them, or run ${bin} plan ${targetFlag(name)} --take config '<address glob>'`,
  ]
}

// The settings that decide what a step does on the target, as the plan's target block records them: the mode per
// object, what a first adoption and drift do with differing units, whether deletes may run, and --yes's limit.
function settingsLine(target: Plan['target']): string {
  const mode = target.takeover.length > 0 ? `takeover on ${target.takeover.join(', ')}, else addon` : 'addon'
  return `Settings: mode ${mode}; adopt ${target.adopt}; drift ${target.drift}; allowDestroy ${target.allowDestroy}; yesLimit ${target.yesLimit}`
}

// A step's line, its labels in brackets after the risk, then what it writes with both values, a create's key fields,
// its held units with config, portal and base, notes and block. Plan data only, so any host can print it.
function stepLines(doc: Plan, step: PlanStep, project: PlanProject | undefined): string[] {
  const labels = step.labels?.length ? ` [${step.labels.join(', ')}]` : ''
  const block = step.blocked
    ? [`  ${step.blocked.detail}`, ...(step.blocked.fix === undefined ? [] : [`  fix: ${step.blocked.fix}`])]
    : []
  const created = step.action === 'create' && step.risk !== 'blocked' ? createdLine(step.desired ?? {}) : []
  // A pipeline create shows each stage it carries, in display order, with its fields.
  const carriedLines = (step.risk === 'blocked' ? [] : (step.stages ?? [])).map(
    (st) => `  + stage ${show(st.desired.label)} (${show(ownId(st.address))})${stageFields(st.desired)}`,
  )
  return [
    `${step.id} ${step.risk}${labels} ${step.title}`,
    ...created,
    ...carriedLines,
    ...(step.changes ?? []).map((c) => `  ${c.unit === 'stages' ? orderLine(step, c) : changeLine(c)}`),
    ...(step.held ?? []).map((h) =>
      h.unit === 'stages'
        ? `  held stage order ${h.class}: ${heldOrder(step, h)}. ${exits(doc, step, h)}`
        : `  held ${h.unit} ${h.class}: ${heldValues(h)}. ${exits(doc, step, h)}`,
    ),
    ...sharedLine(doc, step, project),
    ...(step.notes ?? []).map((n) => `  note ${n.unit}: ${n.note}`),
    ...block,
  ]
}

// One written unit: an option added or removed by its label and value, anything else as the portal's value, then
// config's.
function changeLine(c: PlanChange): string {
  if (c.op === 'add' || c.op === 'remove') {
    const option = (c.op === 'add' ? c.after : c.before) as IROption
    return `${c.op === 'add' ? '+' : '-'} option ${show(option.label)} (${show(option.value)})`
  }
  return `${c.unit}: ${shown(c.before)} -> ${shown(c.after)}`
}

// A stage order written, by label: the IDs stay in the plan document.
function orderLine(step: PlanStep, c: PlanChange): string {
  return `stage order: ${byLabel(step, c.before)} -> ${byLabel(step, c.after)}`
}

// A held stage order's sides, by label.
function heldOrder(step: PlanStep, h: PlanHeld): string {
  const base = Object.hasOwn(h, 'base') ? `, last agreed ${byLabel(step, h.base)}` : ''
  return `config ${byLabel(step, h.config)}, portal ${byLabel(step, h.live)}${base}`
}

// Stage IDs as their labels, quoted, the ID beside a label two of the step's stages share.
function byLabel(step: PlanStep, list: unknown): string {
  const labels = step.stageLabels ?? {}
  const ids = Array.isArray(list) ? (list as string[]) : []
  const shared = (label: string) => Object.values(labels).filter((l) => l === label).length > 1
  return ids
    .map((id) => {
      const label = own(labels, id)
      if (label === undefined) {
        return show(id)
      }
      return shared(label) ? `${show(label)} (${id})` : show(label)
    })
    .join(', ')
}

// A carried stage's metadata, as `, probability 0.2`.
function stageFields(desired: Record<string, unknown>): string {
  const fields = Object.entries(desired).filter(([field]) => field !== 'label')
  return fields.map(([field, value]) => `, ${field} ${shown(value)}`).join('')
}

// A held unit's three sides: config, the portal and, when state has one, the base they last agreed on.
function heldValues(h: PlanHeld): string {
  const base = Object.hasOwn(h, 'base') ? `, last agreed ${shown(h.base)}` : ''
  return `config ${shown(h.config)}, portal ${shown(h.live)}${base}`
}

// A create's fields: label, group and fieldType, every other field config gives, then the option labels. The person
// confirming reads them all; hasUniqueValue and dataSensitivity are marked, since HubSpot keeps them as created.
function createdLine(desired: Record<string, unknown>): string[] {
  const options = desired.options as IROption[] | undefined
  const given = (field: string) => Object.hasOwn(desired, field) && desired[field] !== undefined
  const rest = Object.keys(desired)
    .filter((field) => !(CREATED_FIRST.includes(field) || HIDDEN_CREATED.has(field)) && given(field))
    .sort(byCodeUnit)
  const fields = [
    ...[...CREATED_FIRST.filter(given), ...rest].map(
      (field) => `${field} ${shown(desired[field])}${CREATE_ONLY.has(field) ? ' (create only)' : ''}`,
    ),
    ...(options && options.length > 0 ? [`options ${options.map((o) => show(o.label)).join(', ')}`] : []),
  ]
  return fields.length > 0 ? [`  ${fields.join(', ')}`] : []
}

// A value as show prints it, with a reference to a group or object as that resource's name.
function shown(value: unknown): string {
  const ref =
    value !== null && typeof value === 'object' && Object.hasOwn(value, '$ref') ? (value as Ref).$ref : undefined
  return typeof ref === 'string' && isAddress(ref) ? sanitize(nameOf(ref), VALUE_MAX) : show(value)
}

// What state adds: owned resources HubSpot no longer has, owned entries config no longer names, and how many agreed
// units an update records in the base.
function stateLines(doc: Plan): string[] {
  const lines: string[] = []
  if (doc.missing.length > 0) {
    lines.push('Missing in HubSpot, owned in state:')
    for (const m of doc.missing) {
      const archived = m.archived === true ? `, archived${m.archivedAt ? ` ${m.archivedAt}` : ''}` : ''
      lines.push(`  ${m.address} (${m.origin}${archived}): ${m.resolve.join('; or ')}`)
    }
  }
  if (doc.orphans.length > 0) {
    lines.push('Owned in state, not in config:', ...doc.orphans.map((o) => `  ${o.address}: ${o.note}`))
  }
  const stale = doc.steps
    .filter((s) => s.action === 'update' && s.risk !== 'blocked')
    .reduce((n, s) => n + (s.baseUnits ?? []).length, 0)
  if (stale === 1) {
    lines.push('1 value already matches HubSpot, but state has not recorded it; apply records it.')
  } else if (stale > 1) {
    lines.push(`${stale} values already match HubSpot, but state has not recorded them; apply records them.`)
  }
  return lines
}

// In a project of several targets a pull writes the file every target shares, so a step that holds units config and
// this portal never agreed on also names the override that keeps the portal's values on this target alone.
function sharedLine(doc: Plan, step: PlanStep, project: PlanProject | undefined): string[] {
  const { name } = doc.target
  const holds = (step.held ?? []).some((h) => h.class === 'diverged' && h.resolve !== undefined)
  if (!holds || project === undefined || project.targets.length < 2 || Object.hasOwn(project.overrides, step.address)) {
    return []
  }
  return [
    `  shared: a pull writes the portal's values into the file every target shares; to keep them on target ${name} alone, add a definition override for ${step.address} under targets.${name}.overrides`,
  ]
}

// Both ways out of a held unit: the portal side, and config's, which a pipeline Kalup does not write cannot take. A
// property unit no pull takes has a note of its own saying why.
function exits(doc: Plan, step: PlanStep, h: PlanHeld): string {
  const noted = kindOf(step.address) === 'property' && step.notes?.some((n) => n.unit === h.unit)
  let portal = `No pull takes the portal side while a name override shadows a name the resource refers to; correct or remove that override under targets.${doc.target.name}.overrides`
  if (h.resolve) {
    portal = `Take the portal side: ${h.resolve.portal}`
  } else if (noted) {
    portal = `No pull takes the portal side (see the note on ${h.unit})`
  }
  return readOnlyOf(step.address) === undefined
    ? `${portal}; take config: ${takeCommand(doc.target.name, step.address, h.unit)}`
    : portal
}

// Every step, kind by kind, then the tombstones. A kind's creates meet the Limits Tracking readings together, before
// the next kind, so a create a limit blocks blocks what depends on it.
function decide(input: StepInput, coverage: Coverage): Decided {
  const { loaded, observation, target } = input
  const settings = loaded.config.targets[target] ?? {}
  // protected is not the steps' to know; the plan's target block records it.
  const { drift, allowDestroy, adopt } = policyOf(settings, '')
  const context: Context = {
    coverage,
    decided: new Map(),
    gone: [],
    input,
    matched: new Set(),
    missing: [],
    overrides: settings.overrides ?? {},
    pipelines: indexPipelines(observation),
    policy: { drift, allowDestroy, adopt },
    takeover: takeoverCandidates(loaded, observation, target),
  }
  const ids = typeIdsOf(coverage)
  const steps: PlanStep[] = []
  const excluded: Address[] = []
  const issues: Issue[] = []
  for (const kind of KINDS) {
    const pending: PlanStep[] = []
    for (const [address, resource] of managed(loaded, kind)) {
      const status = statusOf(observation, address)
      if (status === 'excluded' || skipped(address, resource, context.overrides)) {
        excluded.push(address)
        continue
      }
      const step = stepFor(context, address, resource, status)
      if (step) {
        pending.push(step)
      }
    }
    const creates = pending.filter((s) => s.action === 'create' && s.risk !== 'blocked').map((s) => s.address)
    const room = headroom(input.limits, creates, ids, target)
    issues.push(...room.issues)
    for (const next of pending) {
      const block = own(room.blocked, next.address)
      const step = block
        ? blocked(next.address, 'create', block.reason, 'limit reached', block.detail, block.fix)
        : next
      context.decided.set(step.address, step)
      steps.push(step)
    }
  }
  steps.push(...removals(context))
  for (const [index, step] of steps.entries()) {
    step.id = `s${index + 1}`
    step.blocked?.blocks.sort(byCodeUnit)
    carryProvenance(step, loaded)
  }
  const missing = context.missing.sort((a, b) => byCodeUnit(a.address, b.address))
  return { steps, excluded: excluded.sort(byCodeUnit), gone: context.gone, issues, matched: context.matched, missing }
}

// A create, adopt, update or delete carries its config resource's provenance, the blueprint it came from.
function carryProvenance(step: PlanStep, loaded: StepInput['loaded']): void {
  const provenance = own(loaded.ir.resources, step.address)?.provenance
  if (provenance && PROVENANCE_ACTIONS.has(step.action)) {
    step.provenance = provenance
  }
}

// The spec's rules in order, the first that matches deciding. A skip was handled before. Undefined: no step, for a
// resource that agrees with the portal and its base, or one state owns that HubSpot no longer holds.
function stepFor(context: Context, address: Address, resource: IRResource, status: Status): PlanStep | undefined {
  const override = own(context.overrides, address)
  if (override?.lookup !== undefined) {
    const detail =
      'lookup overrides apply to lookup resources such as teams and owners, which this version does not manage'
    const fix = `remove the lookup override for ${address} under targets.${context.input.target}.overrides`
    return blocked(address, actionOf(status), 'override', 'lookup overrides are not applied', detail, fix)
  }
  if (status === 'unreadable' || status === 'not-observed') {
    return unread(context, address, status)
  }
  const [parent, ...others] = blockedParents(context, address, resource)
  if (parent) {
    for (const p of [parent, ...others]) {
      p.blocked?.blocks.push(address)
    }
    const detail = `${parent.address} is blocked`
    return blocked(address, actionOf(status), 'dependency-blocked', detail, detail)
  }
  if (status === 'unsupported') {
    return unsupported(context, address)
  }
  // A stage of a pipeline this plan creates goes with that create; one of a pipeline HubSpot no longer holds goes with
  // the pipeline's missing entry.
  if (status === 'absent' && kindOf(address) === 'stage' && carried(context, address)) {
    return undefined
  }
  const owner = ownerOf(context, address)
  if (status === 'absent' && owner.entry) {
    return ownedAbsent(context, address, resource, override, owner.entry)
  }
  const group = missingGroup(context, resource)
  if (group) {
    const detail = `${group} is missing in HubSpot`
    return blocked(address, actionOf(status), 'dependency-blocked', detail, detail)
  }
  if (status === 'present') {
    return present(context, address, resource, owner)
  }
  const step = absent(context, address, resource, override)
  if (step.risk === 'blocked') {
    return step
  }
  const notes = owner.stale ? { notes: [staleNote(context, address, owner.stale)] } : {}
  return finish({ ...step, ...notes }, context.policy, undefined)
}

// Unreadable: a list of the object answered 403, or, on an object that was read, the property's group has a name no
// address can hold. Not observed: the object is not under objects, so it was not read.
function unread(context: Context, address: Address, status: Status): PlanStep {
  const key = objectOf(address)
  const object = own(context.coverage.objects, key)
  const kind = kindOf(address)
  if ((kind === 'pipeline' || kind === 'stage') && object?.status === 'read') {
    const scope = object.pipelines?.missingScope
    if (object.pipelines === undefined) {
      const detail = `the pipelines of ${key} are not in scope, so the plan did not read them`
      return blocked(address, 'unknown', 'scope', 'pipelines not read', detail, `set objects.${key}.pipelines: true`)
    }
    const detail = `the pipelines list of ${key} answered 403, so what the portal holds there is unknown`
    const fix = scope === undefined ? 'check the scopes of the key' : `add the scope ${scope} to the key`
    return blocked(address, 'unknown', 'scope', `the key cannot read the pipelines of ${key}`, detail, fix)
  }
  if (object?.status === 'read') {
    const detail =
      'the portal has it in a group whose name holds whitespace, which no address can hold, so what it holds is unknown'
    const fix = 'rename the group in HubSpot to a name without spaces'
    return blocked(address, 'unknown', 'unsupported', 'its portal group has no address', detail, fix)
  }
  if (status === 'not-observed') {
    const detail = `${key} is not under objects in kalup.config.ts, so the plan did not read it`
    return blocked(
      address,
      'unknown',
      'scope',
      `${key} was not read`,
      detail,
      `add ${key} to objects in kalup.config.ts`,
    )
  }
  const scope = object?.missingScope
  const detail = `a list the plan needs for ${key} answered 403, so what the portal holds there is unknown`
  const fix = scope === undefined ? 'check the scopes of the key' : `add the scope ${scope} to the key`
  return blocked(address, 'unknown', 'scope', `the key cannot read ${key}`, detail, fix)
}

// What a step needs to exist first and is blocked: a property's group or a stage's pipeline, then the object it is on.
function blockedParents(context: Context, address: Address, resource: IRResource): PlanStep[] {
  if (kindOf(address) === 'object') {
    return []
  }
  const group = (resource.definition?.group as Ref | undefined)?.$ref
  const pipeline = kindOf(address) === 'stage' ? pipelineOf(address) : undefined
  return [group, pipeline, `object:${objectOf(address)}`].flatMap((parent) => {
    const found = parent === undefined ? undefined : context.decided.get(parent)
    return found?.risk === 'blocked' ? [found] : []
  })
}

// A property's group that state owns and HubSpot no longer holds: nothing can go into it.
function missingGroup(context: Context, resource: IRResource): Address | undefined {
  const group = (resource.definition?.group as Ref | undefined)?.$ref
  return group !== undefined && context.missing.some((m) => m.address === group) ? group : undefined
}

function unsupported(context: Context, address: Address): PlanStep {
  const key = objectOf(address)
  const skip = skipFix(address, context.input.target)
  if (kindOf(address) === 'object') {
    const detail = `HubSpot returned the ${key} schema without a singular or plural label`
    return blocked(
      address,
      'adopt',
      'unsupported',
      'schema without labels',
      detail,
      `set both labels in HubSpot, or ${skip}`,
    )
  }
  // statusOf found the property among the unsupported ones.
  const found = own(context.coverage.objects, key)?.unsupported?.find((u) => u.name === nameOf(address))
  const detail = `the portal property ${unsupportedReason(found as UnsupportedProperty)}, which Kalup does not write`
  const fix = `make it a reference: write p.string('${nameOf(address)}') with no definition, or ${skip}`
  return blocked(address, 'adopt', 'unsupported', 'unsupported type', detail, fix)
}

function absent(context: Context, address: Address, resource: IRResource, override: Override | undefined): PlanStep {
  const { input } = context
  if (override?.name !== undefined) {
    const detail = `the portal has no ${override.name}`
    const fix = `correct or remove the name override for ${address} under targets.${input.target}.overrides`
    return blocked(address, 'create', 'override', detail, detail, fix)
  }
  const kind = kindOf(address)
  const name = nameOf(address)
  if (kind === 'object') {
    return objectCreate(context, address, resource)
  }
  if (kind === 'pipeline' || kind === 'stage') {
    return pipelineCreate(context, address, resource)
  }
  // A group create of an archived group's name makes a group with the new label (observed on 2026-09-29), so only a
  // property name is checked.
  const archived = kind === 'property' && own(input.archivedProperties, objectOf(address))?.some((p) => p.name === name)
  if (archived) {
    const [detail, fix] = archivedName(name)
    return blocked(address, 'create', 'unsupported', 'archived name', detail, fix)
  }
  // A set of field names: in code-unit order, so the order config lists them in never changes writesHash.
  const ignore = [...new Set(resource.lifecycle?.ignoreChanges)].sort(byCodeUnit)
  return {
    ...head(address, 'create', 'safe', `Create ${described(address, resource)}`),
    desired: resource.definition,
    ...(ignore.length > 0 ? { ignoreChanges: ignore } : {}),
    expect: { exists: false },
  }
}

// A custom object HubSpot does not hold. Blocked when HubSpot holds its name, ignoring case, as an archived schema (a
// create of that name purges it, observed 2026-10-05) or as another custom object, and when a display, required or
// searchable field names a property that will not exist. The create sends the name, labels, description and a primary
// HubSpot gives every custom object; apply sets the fields that name the object's own properties once they exist, the
// step's tail.
function objectCreate(context: Context, address: Address, resource: IRResource): PlanStep {
  const { input } = context
  const name = nameOf(address)
  const sameName = (held: string) => held.toLowerCase() === name.toLowerCase()
  const archived = (input.archivedSchemas ?? []).find(sameName)
  if (archived !== undefined) {
    const detail = `HubSpot holds an archived custom object named ${archived}, and a create of that name purges it, with its association labels and its records in the recycle bin (observed 2026-10-05)`
    const fix = `restore it in HubSpot and run ${bin} pull, or purge it in HubSpot if nothing in it is needed, or choose another name in config`
    return blocked(address, 'create', 'unsupported', 'archived name', detail, fix)
  }
  const others = context.coverage.otherObjects
  const other = others === 'unknown' ? undefined : others.find(sameName)
  if (other !== undefined) {
    const detail = `HubSpot holds the custom object ${other}, and it keeps custom object names unique ignoring case`
    const fix = `use the name ${other} in config to manage that object, or choose another name`
    return blocked(address, 'create', 'unsupported', 'name taken', detail, fix)
  }
  const definition = resource.definition ?? {}
  const unheld = unheldDisplay(context, address, definition)
  if (unheld) {
    return blocked(address, 'create', 'unsupported', 'display property missing', unheld.detail, unheld.fix)
  }
  const tail = Object.keys(objectTail(definition))
  const notes: PlanNote[] = [
    {
      unit: 'object',
      live: null,
      note: `HubSpot gives a new custom object its own properties (hs_object_id and others), the group ${name}_information and associations with activities; Kalup manages none of them`,
    },
    ...(tail.length > 0
      ? [
          {
            unit: 'object',
            live: null,
            note: `apply sets ${tail.join(', ')} once the object's properties exist, since HubSpot refuses a field naming a property it does not hold`,
          },
        ]
      : []),
  ]
  return {
    ...head(address, 'create', 'safe', `Create ${described(address, resource)}`),
    desired: definition,
    notes,
    expect: { exists: false },
  }
}

// Why a custom object's display, required or searchable fields cannot be written, or undefined when they can: one names
// a property that is neither one HubSpot gives every custom object, nor one the read found, nor a property config
// creates on the object. `fields` are the fields the step writes.
function unheldDisplay(
  context: Context,
  object: Address,
  fields: Record<string, unknown>,
): { detail: string; fix: string } | undefined {
  const key = nameOf(object)
  const coverage = own(context.coverage.objects, key)
  const { observation, loaded } = context.input
  const held = (property: string) => {
    const address = `property:${key}/${property}`
    return (
      OBJECT_DEFAULT_PROPERTIES.has(property) ||
      statusOf(observation, address) === 'present' ||
      coverage?.outOfScope?.includes(property) === true ||
      (own(loaded.ir.resources, address)?.managed === true && own(context.overrides, address)?.skip !== true)
    )
  }
  for (const field of OBJECT_DISPLAY_FIELDS) {
    const missing = ([fields[field] ?? []].flat() as string[]).filter((property) => !held(property))
    if (missing.length > 0) {
      return {
        detail: `${field} names ${missing.join(', ')}, which HubSpot will not hold: no custom object gets it, the portal lacks it and config does not create it, and HubSpot refuses a field naming a property it does not hold`,
        fix: `define ${missing.join(', ')} in the object file, or name another property in ${field}`,
      }
    }
  }
  return undefined
}

// A pipeline or a stage HubSpot does not hold. A pipeline create carries every config stage of the pipeline, since
// HubSpot refuses a pipeline without one. Blocked on an object whose pipelines Kalup does not write, and on an ID
// another pipeline or stage holds: pipeline IDs are unique across objects, stage IDs across one object's pipelines.
function pipelineCreate(context: Context, address: Address, resource: IRResource): PlanStep {
  const { target } = context.input
  const object = objectOf(address)
  if (!writesPipelines(object)) {
    const fix = `create it in HubSpot and run ${bin} pull, or ${skipFix(address, target)}`
    return blocked(address, 'create', 'unsupported', 'pipelines not written', noPipelineWrites(object), fix)
  }
  const stages = kindOf(address) === 'pipeline' ? carriedStages(context, address) : []
  if (kindOf(address) === 'pipeline' && stages.length === 0) {
    const detail = `every stage of ${address} is skipped on target ${target}, and HubSpot refuses a pipeline without one`
    const fix = `skip ${address} too, or keep one of its stages on target ${target}`
    return blocked(address, 'create', 'override', 'every stage skipped', detail, fix)
  }
  for (const at of [address, ...stages.map((st) => st.address)]) {
    const holder = idHolder(context, at)
    if (holder) {
      const detail = `${holder} holds the ID ${ownId(at)} in this portal, and HubSpot keeps ${kindOf(at)} IDs unique ${kindOf(at) === 'pipeline' ? 'across objects' : `across the pipelines of ${object}`}`
      return blocked(address, 'create', 'unsupported', 'ID taken', detail, `give ${at} another ID in config`)
    }
    const renamed = at !== address && own(context.overrides, at)?.name
    if (renamed) {
      const detail = `the pipeline is absent, and ${at} carries a name override, so no stage of that name can exist`
      const fix = `correct or remove the name override for ${at} under targets.${target}.overrides`
      return blocked(address, 'create', 'override', detail, detail, fix)
    }
  }
  const notes = [
    ...assignedNotes(context, address, stages),
    ...unreadClash(context, address),
    ...firstPipelineNote(context, address),
  ]
  const what = stages.length > 0 ? ` with ${plural(stages.length, 'stage')}` : ''
  return {
    ...head(address, 'create', 'safe', `Create ${described(address, resource)}${what}`),
    desired: resource.definition,
    ...(stages.length > 0 ? { stages } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    expect: { exists: false },
  }
}

/** Whether Kalup writes the pipelines of an object: deals, tickets and custom objects. */
// The config stages a pipeline create carries, in the pipeline's order: managed and not skipped on the target.
function carriedStages(context: Context, pipeline: Address): PlanStage[] {
  const { resources } = context.input.loaded.ir
  const ids = (own(resources, pipeline)?.definition?.stages as string[] | undefined) ?? []
  return ids.flatMap((id) => {
    const address = `stage:${pipeline.slice('pipeline:'.length)}/${id}`
    const stage = own(resources, address)
    return stage?.managed && own(context.overrides, address)?.skip !== true
      ? [{ address, desired: stage.definition ?? {} }]
      : []
  })
}

// Whether a stage HubSpot does not hold has no step of its own: its pipeline's create carries it, or its pipeline is
// missing too, which that pipeline's missing entry reports.
function carried(context: Context, stage: Address): boolean {
  const pipeline = pipelineOf(stage)
  const step = context.decided.get(pipeline)
  return (step?.action === 'create' && step.risk !== 'blocked') || context.missing.some((m) => m.address === pipeline)
}

// The address that holds this pipeline's or stage's ID in the portal: another object's pipeline, or a stage of another
// pipeline of the same object.
function idHolder(context: Context, address: Address): Address | undefined {
  const id = ownId(address)
  const object = objectOf(address)
  const { pipelines, stages } = context.pipelines
  if (kindOf(address) === 'pipeline') {
    const others = [...pipelines].flatMap(([key, held]) => (key === object ? [] : held))
    return others.find((a) => ownId(a) === id)
  }
  const pipeline = pipelineOf(address)
  return (stages.get(object) ?? []).find((a) => pipelineOf(a) !== pipeline && ownId(a) === id)
}

// HubSpot keeps pipeline IDs unique across deals and tickets (observed 2026-10-05): a deal or ticket pipeline create
// notes the other object's pipelines when the plan did not read them, since a clash there is HubSpot's refusal.
function unreadClash(context: Context, address: Address): PlanNote[] {
  const object = objectOf(address)
  const other = { deals: 'tickets', tickets: 'deals' }[object]
  if (kindOf(address) !== 'pipeline' || other === undefined) {
    return []
  }
  if (own(context.coverage.objects, other)?.pipelines?.status === 'read') {
    return []
  }
  const one = other === 'tickets' ? 'a ticket pipeline' : 'a deal pipeline'
  const note = `HubSpot keeps pipeline IDs unique across deals and tickets, and this plan did not read the pipelines of ${other}: HubSpot refuses the create if ${one} holds ${ownId(address)}`
  return [{ unit: 'id', live: null, note }]
}

// A create whose pipeline or stage ID is all digits copies an ID HubSpot assigned in another portal. The note names the
// name override, and the portal's pipeline with the same label when the read finds exactly one. derive rates such a
// create risky.
function assignedNotes(context: Context, address: Address, stages: PlanStage[]): PlanNote[] {
  const ids = [address, ...stages.map((st) => st.address)].filter((a) => ASSIGNED.test(ownId(a)))
  if (ids.length === 0) {
    return []
  }
  const { observation, target } = context.input
  const pipeline = kindOf(address) === 'stage' ? pipelineOf(address) : address
  const label = String(
    own(observation.resources, pipeline)?.definition?.label ??
      own(context.input.loaded.ir.resources, pipeline)?.definition?.label,
  )
  const matching = (context.pipelines.pipelines.get(objectOf(address)) ?? []).filter(
    (a) => String(own(observation.resources, a)?.definition?.label).toLowerCase() === label.toLowerCase(),
  )
  const [only] = matching
  const match = matching.length === 1 && only ? `; the portal holds a pipeline "${label}" as ${ownId(only)}` : ''
  const note = `HubSpot assigned the ID ${ids.map(ownId).join(', ')} in another portal${match}. If this portal holds the same pipeline under other IDs, add a name override for the pipeline and each stage under targets.${target}.overrides instead of creating a copy`
  return [{ unit: 'id', live: null, note: sanitize(note, TEXT_MAX) }]
}

// HubSpot adds two HubSpot-defined properties to a custom object with its first pipeline, for good (observed
// 2026-10-05).
function firstPipelineNote(context: Context, address: Address): PlanNote[] {
  const object = objectOf(address)
  const first =
    kindOf(address) === 'pipeline' && !STANDARD_OBJECTS.has(object) && !context.pipelines.pipelines.has(object)
  const note = `the first pipeline on ${object}: HubSpot adds its own properties hs_pipeline and hs_pipeline_stage to the object, and keeps them after the pipeline is gone`
  return first ? [{ unit: 'object', live: null, note }] : []
}

// State owns it and a complete read did not find it. No step, a missing entry with the ways out; a take recreates a
// property HubSpot does not hold archived, and a group: HubSpot documents no archived flag for groups, and a create of
// an archived group's name makes a group with the new label (observed on 2026-09-29).
function ownedAbsent(
  context: Context,
  address: Address,
  resource: IRResource,
  override: Override | undefined,
  entry: Owned,
): PlanStep | undefined {
  const { input } = context
  const kind = kindOf(address)
  const taken = selectsAddress(context, address)
  context.gone.push({ address, taken })
  const found =
    kind === 'property' ? archivedOf(input.archivedProperties, objectOf(address), portalName(context, address)) : null
  const archived = found === null ? null : found !== undefined
  // A group, a pipeline and a stage leave no archived copy a create would restore. A custom object may: its create is
  // blocked on an archived schema's name (objectCreate).
  const recreatable = kind !== 'property' || archived === false
  if (!taken) {
    const flag = targetFlag(input.target)
    context.missing.push({
      address,
      origin: entry.origin,
      archived,
      ...(found?.archivedAt === undefined ? {} : { archivedAt: found.archivedAt }),
      resolve: [
        ...(archived === true ? [`restore it in HubSpot, then run ${bin} plan ${flag}`] : []),
        `${bin} rm ${shellWord(address)} --release`,
        ...(recreatable ? [`${bin} plan ${flag} --take config ${shellWord(address)}`] : []),
      ],
    })
    return undefined
  }
  const group = missingGroup(context, resource)
  if (group) {
    const detail = `${group} is missing in HubSpot`
    return blocked(address, 'create', 'dependency-blocked', detail, detail)
  }
  if (!recreatable) {
    const [detail, fix] = archivedName(portalName(context, address))
    return blocked(address, 'create', 'unsupported', 'cannot recreate', detail, fix)
  }
  const step = absent(context, address, resource, override)
  if (step.risk === 'blocked') {
    return step
  }
  const title = sanitize(`Recreate ${described(address, resource)}`, TITLE_MAX)
  return finish({ ...step, title }, context.policy, entry)
}

// The block on a create of a property name HubSpot holds archived: the detail and the fix.
function archivedName(name: string): [string, string] {
  return [
    `HubSpot holds an archived property named ${name}; creating one restores that archived property rather than making a new one (observed on 2026-09-29)`,
    `restore it in HubSpot and run ${bin} pull, or choose another name in config`,
  ]
}

function present(context: Context, address: Address, resource: IRResource, owner: Owner): PlanStep | undefined {
  const { observation } = context.input
  const observed = observation.resources[address] as IRResource
  if (!observed.managed) {
    return referenced(context, address)
  }
  const { entry } = owner
  // Another builder does not state what p.owner implies, so no unit would show that it cannot manage a user property.
  if (observed.definition?.referencedObjectType === 'OWNER' && resource.definition?.referencedObjectType !== 'OWNER') {
    const detail = `the portal property is a HubSpot user property, which p.${resource.binding?.codec} does not manage`
    const action = entry ? 'update' : 'adopt'
    return blocked(address, action, 'unsupported', 'HubSpot user property', detail, 'change the builder to p.owner')
  }
  const kind = kindOf(address)
  const owned = ownedFields(resource)
  const { removedOptions } = resource.lifecycle ?? DEFAULTS.lifecycle
  const { options } = optionsOf(context.input.loaded, context.input.target, address, resource)
  // An adopt classifies against the base a pull recorded; a base another normalizer version wrote counts as absent.
  const found = entry ?? own(context.input.state?.resources ?? {}, address)
  const base = found && baseFor(found, address, portalName(context, address))
  const units = classify(base, specOf(owned), capturedSpec(observed), { options, removedOptions })
  const action = entry ? 'update' : 'adopt'
  return settle(context, { action, address, base, kind, observed, owned, owner, resource, units })
}

// Config manages a property the portal holds as HubSpot-defined, calculated, or named under a prefix HubSpot
// reserves. pull makes it a reference: the file defines it, so it is in the pull scope.
function referenced(context: Context, address: Address): PlanStep {
  const { target } = context.input
  const short = 'HubSpot-defined or calculated'
  const detail = `${short} in this portal, or named with a prefix HubSpot reserves; run ${bin} pull to make it a reference`
  return blocked(address, 'adopt', 'unsupported', short, detail, `run ${pullCommand(target, address)}`)
}

// A present resource's step: each unit written, held, noted or recorded in the base, as derive decides. An update with
// nothing to write, hold, note or record is no step.
function settle(context: Context, r: Present): PlanStep | undefined {
  const { action, address, kind, observed, owner, units } = r
  const bins: Bins = { baseUnits: [], changes: [], held: [], notes: [], refused: false }
  for (const u of units) {
    place(context, r, u, bins)
  }
  const { baseUnits, changes, held, notes } = bins
  if (bins.refused) {
    const detail = `${readOnlyOf(address)}, so --take config cannot write its units`
    return blocked(address, action, 'unsupported', 'pipelines not written', detail, 'leave it out of --take')
  }
  const unheld =
    kind === 'object'
      ? unheldDisplay(context, address, Object.fromEntries(changes.map((c) => [c.unit, c.after])))
      : undefined
  if (unheld) {
    return blocked(address, action, 'unsupported', 'display property missing', unheld.detail, unheld.fix)
  }
  const meta = context.input.observation.meta?.[address]
  reorder(r, changes, meta)
  if (kind === 'pipeline') {
    reorderStages(context, r, changes)
  }
  const block = writeBlock(
    kind,
    units,
    changes.map((c) => c.unit),
    meta,
  )
  if (block) {
    return blocked(address, action, 'unsupported', block.short, block.detail, block.fix)
  }
  const takeover = takeoverUnits(context, r, changes)
  const refused = takeover.size > 0 ? takeoverBlock(context, address, action, [...takeover]) : undefined
  if (refused) {
    return refused
  }
  baseUnits.push(...dropped(r))
  baseUnits.sort(byCodeUnit)
  if (owner.stale) {
    notes.push(staleNote(context, address, owner.stale))
  }
  if (takeover.size > 0) {
    notes.push(optionsNote(context, address, [...takeover]))
  }
  if (action === 'update' && changes.length + baseUnits.length + held.length + notes.length === 0) {
    return undefined
  }
  const step: PlanStep = {
    ...head(address, action, 'safe', titleOf(r, changes, baseUnits)),
    desired: r.owned,
    ...(changes.length > 0 ? { changes } : {}),
    ...(held.length > 0 ? { held } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(baseUnits.length > 0 ? { baseUnits } : {}),
    ...stageLabelsOf(context, address, changes, held),
    expect: expectOf(kind, changes, observed),
  }
  return finish(step, context.policy, owner.entry, { takeoverUnits: takeover })
}

// The label of each stage a pipeline step's stage order names, config's else the portal's: the plan text shows them.
function stageLabelsOf(
  context: Context,
  address: Address,
  changes: PlanChange[],
  held: PlanHeld[],
): Pick<PlanStep, 'stageLabels'> {
  const lists = [
    ...changes.filter((c) => c.unit === 'stages').flatMap((c) => [c.before, c.after]),
    ...held.filter((h) => h.unit === 'stages').flatMap((h) => [h.config, h.live, h.base]),
  ]
  const ids = [...new Set(lists.flatMap((list) => (Array.isArray(list) ? (list as string[]) : [])))].sort(byCodeUnit)
  if (ids.length === 0) {
    return {}
  }
  const prefix = `${address.replace('pipeline:', 'stage:')}/`
  const { loaded, observation } = context.input
  const label = (id: string) =>
    own(loaded.ir.resources, `${prefix}${id}`)?.definition?.label ??
    own(observation.resources, `${prefix}${id}`)?.definition?.label
  return { stageLabels: Object.fromEntries(ids.map((id) => [id, String(label(id) ?? id)])) }
}

/** Where settle puts each unit. refused: a take named a unit of a pipeline Kalup does not write. */
interface Bins {
  baseUnits: string[]
  changes: PlanChange[]
  held: PlanHeld[]
  notes: PlanNote[]
  refused: boolean
}

// One unit: a note when HubSpot stores what config sends differently, else what derive makes of it. A pipeline of an
// object whose pipelines Kalup does not write is compared, never written: a unit it would write is held or noted
// instead.
function place(context: Context, r: Present, u: UnitResult, bins: Bins): void {
  const { action, address, owner } = r
  const readOnly = readOnlyOf(address)
  const rewrite = owner.entry?.rewrites && own(owner.entry.rewrites, u.unit)
  if (rewrite && u.class !== 'converged' && same(u.desired, rewrite.sent) && same(u.observed, rewrite.stored)) {
    const note = `HubSpot stores ${show(rewrite.stored)} when sent ${show(rewrite.sent)}; change config to match`
    bins.notes.push({ unit: u.unit, live: u.observed, note: sanitize(note, TEXT_MAX) })
    return
  }
  const taken = REVERTING.has(u.class) && selects(context, address, u.unit)
  let { disposition } = deriveChange(u, context.policy, taken)
  const unwritten = { unit: u.unit, live: u.observed, note: `not written: ${readOnly}` }
  if (readOnly !== undefined && disposition === 'write') {
    bins.refused ||= taken
    if (REVERTING.has(u.class)) {
      // Overwrite would write it: held, and the note says why it is not.
      bins.held.push(heldOf(context, address, u, unpulledOf(context, r, u)))
      bins.notes.push(unwritten)
      return
    }
    disposition = 'note'
  }
  if (disposition === 'none') {
    // An adopt records every agreed unit; an update those whose base is missing or out of date. An order of no common
    // member agrees on nothing, so apply records none.
    const empty = (u.unit === 'options.order' || ORDERS.has(u.unit)) && (u.desired as string[]).length === 0
    if (!empty && (action === 'adopt' || !(Object.hasOwn(u, 'base') && same(u.base, u.desired, SETS.has(u.unit))))) {
      bins.baseUnits.push(u.unit)
    }
  } else if (disposition === 'write') {
    bins.changes.push(changeOf(u))
  } else if (disposition === 'hold') {
    hold(context, r, u, bins)
  } else if (readOnly === undefined) {
    bins.notes.push({ unit: u.unit, live: u.observed, note: keepNote(context, address, u, unpulledOf(context, r, u)) })
  } else {
    bins.notes.push(unwritten)
  }
}

// A held unit, and when no pull takes its portal side for a reason of the property's own, the note that says why.
function hold(context: Context, r: Present, u: UnitResult, bins: Bins): void {
  const unpulled = unpulledOf(context, r, u)
  bins.held.push(heldOf(context, r.address, u, unpulled))
  if (unpulled !== undefined && unpulled !== SHADOWED_NOTE) {
    bins.notes.push({ unit: u.unit, live: u.observed, note: sanitize(unpulled, TEXT_MAX) })
  }
}

/** Marks a resource that names a portal name a name override shadows: pull never writes it. */
const SHADOWED_NOTE = 'shadowed'

// Why no pull takes the portal side of a unit: SHADOWED_NOTE, a reason noPull gives, or undefined when one does.
function unpulledOf(context: Context, r: Present, u: UnitResult): string | undefined {
  return shadows(r.observed) ? SHADOWED_NOTE : noPull(context, r, u)
}

// Why no pull takes the portal side of a property's unit, or undefined when the printed pull does. pull keeps a file
// property whose portal type or fieldType the file's builder does not take (W_CODEC_MISMATCH), or would not validate,
// as written; and it never writes a group in removed.ts back.
function noPull(context: Context, r: Present, u: UnitResult): string | undefined {
  if (r.kind !== 'property') {
    return undefined
  }
  const { ir } = context.input.loaded
  const group = u.unit === 'group' ? (u.observed as Ref | undefined)?.$ref : undefined
  if (group !== undefined && Object.hasOwn(ir.tombstones, group)) {
    return `no pull takes the portal's group: ${group} is in removed.ts, so pull keeps the file's group`
  }
  const codec = r.resource.binding?.codec
  const { type, fieldType } = capturedSpec(r.observed).fields
  if (codec === undefined || (HUBSPOT_TYPES[codec] === type && FIELD_TYPES[codec].includes(fieldType as string))) {
    return undefined
  }
  const takes = (Object.keys(FIELD_TYPES) as (keyof typeof FIELD_TYPES)[]).find(
    (k) => HUBSPOT_TYPES[k] === type && FIELD_TYPES[k].includes(fieldType as string),
  )
  const builder = takes === undefined ? '' : `; change the builder to p.${takes} to take the portal side with pull`
  return `no pull refreshes it: p.${codec} does not take the portal's type ${show(type)} and fieldType ${show(fieldType)}, so pull keeps the file as written${builder}`
}

// The members the base holds that config and HubSpot both dropped. classify has no unit for them, so they are listed
// here: apply removes them from the base, and an option config adds back later is an add, not drift.
function dropped(r: Present): string[] {
  const members = r.base?.options as Record<string, unknown> | undefined
  const desired = r.owned.options as IROption[] | undefined
  if (members === undefined || desired === undefined) {
    return []
  }
  const held = new Set([...desired, ...(capturedSpec(r.observed).options ?? [])].map((o) => o.value))
  return Object.keys(members)
    .filter((value) => !held.has(value))
    .map((value) => `options[${value}]`)
}

// A written unit. before is the live value, after the one written: an option member added or removed, anything else
// set. An option HubSpot lost that config and the base hold is added back.
function changeOf(u: UnitResult): PlanChange {
  const unitClass = u.class as PlanChange['class']
  if (u.class === 'remove') {
    return { unit: u.unit, class: unitClass, op: 'remove', before: u.observed, after: null }
  }
  if (u.unit.endsWith(']') && u.observed === undefined) {
    return { unit: u.unit, class: unitClass, op: 'add', before: null, after: u.desired }
  }
  return { unit: u.unit, class: unitClass, op: 'set', before: u.observed ?? null, after: u.desired }
}

// A held unit, with the command that takes its portal side unless `unpulled` says why no pull does.
function heldOf(context: Context, address: Address, u: UnitResult, unpulled: string | undefined): PlanHeld {
  const { target } = context.input
  // pull keeps the file's side of a conflict, and an option HubSpot removed that config and the base hold, so --accept
  // takes those.
  const removed = u.class === 'drift' && u.unit.endsWith(']') && u.observed === undefined
  const portal =
    u.class === 'conflict' || removed ? acceptCommand(target, address, u.unit) : pullCommand(target, address)
  return {
    unit: u.unit,
    class: u.class as PlanHeld['class'],
    config: u.desired ?? null,
    live: u.observed ?? null,
    ...(Object.hasOwn(u, 'base') ? { base: u.base ?? null } : {}),
    ...(unpulled === undefined ? { resolve: { portal } } : {}),
  }
}

// An option only HubSpot holds, kept: dropped from config when the base holds it, else one pull brings into config.
function keepNote(context: Context, address: Address, u: UnitResult, unpulled: string | undefined): string {
  const { target } = context.input
  if (Object.hasOwn(u, 'base')) {
    return 'dropped from config, kept in HubSpot; add it to removedOptions to remove it'
  }
  if (unpulled === undefined) {
    return keptNote(target, address)
  }
  return sanitize(`kept; ${unpulled === SHADOWED_NOTE ? shadowedNote(target) : unpulled}`, TEXT_MAX)
}

// Apply creates a new stage after the highest live displayOrder, a free slot, so nothing renumbers. When the creates
// would not leave config order (a new stage before one HubSpot holds, or new stages that apply creates in another
// order), the pipeline's step also sets the stage order to the full config order of the stages that will exist, as
// reorder does for options; apply runs it after the pipeline's stage steps. A stage config
// adds that will not be created (its step is blocked) is left out. A held order is never reverted to make room.
function reorderStages(context: Context, r: Present, changes: PlanChange[]): void {
  const desired = (r.owned.stages as string[] | undefined) ?? []
  const live = (r.observed.definition?.stages as string[] | undefined) ?? []
  const prefix = `stage:${r.address.slice('pipeline:'.length)}/`
  const added = new Set(desired.filter((id) => !live.includes(id) && creatable(context, `${prefix}${id}`)))
  const after = desired.filter((id) => live.includes(id) || added.has(id))
  const written = changes.find((c) => c.unit === 'stages')
  if (written) {
    written.after = after
    return
  }
  const order = r.units.find((u) => u.unit === 'stages')
  if (added.size === 0 || order?.class !== 'converged') {
    return
  }
  // Apply creates the added stages in its run order: those that close first, then by address.
  const closing = (id: string) => closesStage(own(context.input.loaded.ir.resources, `${prefix}${id}`)?.definition)
  const created = [...added].sort((a, b) => Number(closing(b)) - Number(closing(a)) || byCodeUnit(a, b))
  const appended = [...after.filter((id) => !added.has(id)), ...created]
  if (!same(appended, after)) {
    changes.push({ unit: 'stages', class: 'add', op: 'set', before: order.observed, after })
    changes.sort((a, b) => byCodeUnit(a.unit, b.unit))
  }
}

// Whether a stage HubSpot does not hold gets a create of its own in this plan: a managed config stage, not skipped,
// with no name override (which blocks it), on an object whose pipelines Kalup writes, whose ID no other pipeline of the
// object holds.
function creatable(context: Context, stage: Address): boolean {
  const resource = own(context.input.loaded.ir.resources, stage)
  const override = own(context.overrides, stage)
  return (
    resource?.managed === true &&
    override?.skip !== true &&
    override?.name === undefined &&
    statusOf(context.input.observation, stage) === 'absent' &&
    writesPipelines(objectOf(stage)) &&
    idHolder(context, stage) === undefined
  )
}

// Why a resource is compared and never written, or undefined when Kalup writes it: a pipeline or stage of an object
// other than deals, tickets and a custom object.
function readOnlyOf(address: Address): string | undefined {
  const kind = kindOf(address)
  const pipelines = kind === 'pipeline' || kind === 'stage'
  return pipelines && !writesPipelines(objectOf(address)) ? noPipelineWrites(objectOf(address)) : undefined
}

// Apply gives new options displayOrder after the highest live one, in config order, unless the step changes
// options.order. When config places a new option before one HubSpot holds, the step also sets options.order to the
// full config order of the options that will exist, so one write leaves the options in config order. HubSpot shows a
// negative or missing displayOrder after every other, new options included, so an option config keeps that has one
// needs the order set too. A held order is never reverted to make room.
function reorder(r: Present, changes: PlanChange[], meta: PropertyMeta | undefined): void {
  const desired = r.owned.options as IROption[] | undefined
  if (desired === undefined) {
    return
  }
  const live = (r.observed.definition?.options as IROption[] | undefined) ?? []
  const held = new Set(live.map((o) => o.value))
  const added = new Set(changes.filter((c) => c.op === 'add').map((c) => (c.after as IROption).value))
  const after = desired.filter((o) => held.has(o.value) || added.has(o.value)).map((o) => o.value)
  const written = changes.find((c) => c.unit === 'options.order')
  if (written) {
    written.after = after
    return
  }
  const order = r.units.find((u) => u.unit === 'options.order')
  if (added.size === 0 || order?.class !== 'converged') {
    return
  }
  const wanted = new Set(desired.map((o) => o.value))
  const kept = live.filter((o) => wanted.has(o.value))
  const raw = new Map((meta?.options ?? []).map((o) => [o.value, o.displayOrder ?? -1]))
  const ranked = kept.every((o) => (raw.get(o.value) ?? -1) >= 0)
  const appended = [...kept.map((o) => o.value), ...desired.filter((o) => added.has(o.value)).map((o) => o.value)]
  if (!(ranked && same(appended, after))) {
    changes.push({ unit: 'options.order', class: 'add', op: 'set', before: order.observed, after })
    changes.sort((a, b) => byCodeUnit(a.unit, b.unit))
  }
}

// What a write replaces, checked again right before it: the live value of each field it sets, the full live options
// when any option unit changes (HubSpot replaces the list), the order of the stages config and the portal share when
// the stage order changes (a stage this run creates does not move them), and for a property the live type and
// fieldType, which the PATCH carries.
function expectOf(kind: Kind, changes: PlanChange[], observed: IRResource): PlanStep['expect'] {
  if (changes.length === 0) {
    return { exists: true }
  }
  const live = capturedSpec(observed).fields
  const values: Record<string, unknown> = {}
  for (const change of changes) {
    const field = fieldOf(change.unit)
    if (field === 'options') {
      values.options = observed.definition?.options ?? []
    } else {
      values[field] = ORDERS.has(field) ? change.before : live[field]
    }
  }
  if (kind === 'property') {
    values.type = live.type
    values.fieldType = live.fieldType
  }
  return { exists: true, values }
}

function titleOf(r: Present, changes: PlanChange[], baseUnits: string[]): string {
  const what = described(r.address, r.resource)
  if (r.action === 'adopt') {
    return `Adopt ${what}${writesTitle(changes)}`
  }
  if (changes.length > 0) {
    return `Update ${what}${writesTitle(changes)}`
  }
  return baseUnits.length > 0 ? `Record the agreed values of ${what}` : `No change to ${what}`
}

function writesTitle(changes: PlanChange[]): string {
  return writesTail(changes, (c) => `"${((c.op === 'add' ? c.after : c.before) as IROption).label}"`, fieldWords)
}

// The tombstones' steps, releases first, then the deletes, the tombstones' and then takeover's, properties before
// groups, so a group delete knows which of its properties the same plan deletes first.
function removals(context: Context): PlanStep[] {
  const { tombstones } = context.input.loaded.ir
  const entries = Object.entries(tombstones).sort(([a], [b]) => byCodeUnit(a, b))
  const releases: PlanStep[] = []
  const deletes: PlanStep[] = []
  const deleted = new Map<string, Set<string>>()
  for (const kind of ['property', 'group', 'stage', 'pipeline', 'object'] as const) {
    for (const [address, tombstone] of entries.filter(([a]) => kindOf(a) === kind)) {
      const step = tombstoneStep(context, address, tombstone, deleted)
      if (step?.action === 'release') {
        releases.push(step)
      } else if (step) {
        deletes.push(step)
      }
      countDeleted(context, step, deleted)
    }
    for (const address of takeoverOf(context, kind)) {
      const step = takeoverDelete(context, address, deleted)
      deletes.push(step)
      countDeleted(context, step, deleted)
    }
  }
  return [...releases, ...deletes]
}

// One tombstone's step. A custom object's own tombstone covers everything on it, and a pipeline's its stages: deleting
// or releasing it takes them along, so a covered tombstone that asks the same has no step, and one that asks otherwise
// is blocked.
function tombstoneStep(
  context: Context,
  address: Address,
  tombstone: IRTombstone,
  deleted: Map<string, Set<string>>,
): PlanStep | undefined {
  const { tombstones } = context.input.loaded.ir
  const cover = coverOf(tombstones, address)
  const covering = cover === undefined ? undefined : own(tombstones, cover)
  if (cover === undefined || covering === undefined) {
    return removal(context, address, tombstone, deleted)
  }
  return covering.action === tombstone.action ? undefined : uncovered(address, tombstone, cover)
}

/**
 * The tombstone address that covers `address`, if removed.ts holds one: its custom object's for anything on a custom
 * object, else its pipeline's for a stage. Deleting or releasing that resource takes `address` along.
 */
export function coverOf(tombstones: Record<Address, IRTombstone>, address: Address): Address | undefined {
  const kind = kindOf(address)
  if (kind === 'object') {
    return undefined
  }
  const object = `object:${objectOf(address)}`
  if (Object.hasOwn(tombstones, object)) {
    return object
  }
  return kind === 'stage' && Object.hasOwn(tombstones, pipelineOf(address)) ? pipelineOf(address) : undefined
}

// A tombstone that asks other than the one covering it: the cover's takes everything under it along, so this one is
// blocked with the reason, never dropped.
function uncovered(address: Address, tombstone: IRTombstone, cover: Address): PlanStep {
  const what = kindOf(cover) === 'object' ? 'the custom object with everything on it' : 'the pipeline with its stages'
  if (tombstone.action === 'destroy') {
    const detail = `the tombstone of ${cover} releases ${what}, so Kalup no longer owns this ${kindOf(address)} to delete it`
    const fix = `set the action of ${cover} to destroy to delete it with what it holds, or this one's to release`
    return blocked(address, 'delete', 'not-owned', `${kindOf(cover)} released`, detail, fix)
  }
  const detail = `the tombstone of ${cover} deletes ${what}, so this ${kindOf(address)} cannot be kept`
  const fix = `set the action of ${cover} to release to keep it with what it holds, or this one's to destroy`
  return blocked(address, 'release', 'unsupported', `${kindOf(cover)} deleted`, detail, fix)
}

// What takeover archives of one kind: properties and groups only. Takeover never archives a pipeline or a stage.
function takeoverOf(context: Context, kind: Kind): Address[] {
  if (kind === 'property') {
    return context.takeover.properties
  }
  return kind === 'group' ? context.takeover.groups : []
}

// A delete only the policy blocks counts: with allowDestroy it runs first, and without it the policy blocks the group's
// delete too, so the group reports that and not its members.
function countDeleted(context: Context, step: PlanStep | undefined, deleted: Map<string, Set<string>>): void {
  if (step?.action === 'delete' && (step.risk !== 'blocked' || step.blocked?.reason === 'policy')) {
    // A stage counts under its pipeline's address, for the stage deletes that follow it there.
    const key = kindOf(step.address) === 'stage' ? pipelineOf(step.address) : objectOf(step.address)
    deleted.set(key, new Set([...(deleted.get(key) ?? []), portalName(context, step.address)]))
  }
}

// Takeover archives a custom property or group in the pull scope that config lacks. Like a tombstone's delete it is
// destructive and needs allowDestroy, and HubSpot must let it go; a read that was not complete blocks every one. The
// note says which mode statement asked for it.
function takeoverDelete(context: Context, address: Address, deleted: Map<string, Set<string>>): PlanStep {
  const { input, policy } = context
  const { observation, target } = input
  const observed = observation.resources[address] as IRResource
  const key = objectOf(address)
  const name = nameOf(address)
  const notes = { notes: [modeNote(context, key, `HubSpot holds it in the pull scope of ${key}, and config does not`)] }
  const noted = (refused: PlanStep): PlanStep => ({ ...refused, ...notes })
  if (!context.coverage.complete) {
    const detail = `takeover would archive ${name}, and the read of target ${target} was incomplete, so takeover removes nothing there`
    return noted(blocked(address, 'delete', 'scope', 'read incomplete', detail, INCOMPLETE_FIX))
  }
  const members: Members | undefined =
    kindOf(address) === 'group'
      ? { active: own(observation.members?.[key] ?? {}, name) ?? [], deleted: deleted.get(key) ?? new Set() }
      : undefined
  const block = deleteBlock(observation.meta?.[address], members)
  if (block) {
    return noted(blocked(address, 'delete', 'unsupported', block.short, block.detail, block.fix))
  }
  if (!policy.allowDestroy) {
    const detail = `takeover archives ${name}, and target ${target} does not allow deletes`
    const fix = `keep it in config: run ${pullCommand(target, address)}; or leave it unmanaged: add '${name}' to objects.${key}.exclude; or archive it: set allowDestroy: true under targets.${target} in kalup.config.ts`
    return noted(blocked(address, 'delete', 'policy', 'deletes not allowed', detail, fix))
  }
  const live = capturedSpec(observed)
  const values = live.options === undefined ? live.fields : { ...live.fields, options: live.options }
  const step: PlanStep = {
    ...head(address, 'delete', 'destructive', `Archive ${described(address, observed)}`),
    ...notes,
    expect: { exists: true, values },
  }
  return finish(step, policy, ownerOf(context, address).entry, { takeover: true })
}

// The note on a step takeover asks for: which mode statement asked for it, and why.
function modeNote(context: Context, key: string, why: string): PlanNote {
  const { from } = modeOf(context.input.loaded.config, context.input.target, key)
  const note = `takeover (${from === 'mode' ? 'the top-level mode' : from}): ${why}`
  return { unit: 'mode', live: 'takeover', note: sanitize(note, TEXT_MAX) }
}

// The option units a step removes only because takeover made the options lifecycle 'exact': every removal but one of
// removedOptions, which config asks for itself.
function takeoverUnits(context: Context, r: Present, changes: PlanChange[]): Set<string> {
  const { loaded, target } = context.input
  if (!optionsOf(loaded, target, r.address, r.resource).derived) {
    return new Set()
  }
  const asked = new Set((r.resource.lifecycle?.removedOptions ?? []).map((value) => `options[${value}]`))
  return new Set(changes.filter((c) => c.op === 'remove' && !asked.has(c.unit)).map((c) => c.unit))
}

// The note on option removals takeover asks for.
function optionsNote(context: Context, address: Address, units: string[]): PlanNote {
  return modeNote(context, objectOf(address), `only the portal holds ${optionList(units)}, and config does not`)
}

// `the option "east"` or `the options "east", "west"`, from option units.
function optionList(units: string[]): string {
  const values = units.map((unit) => JSON.stringify(unit.slice('options['.length, -1)))
  return `the option${values.length === 1 ? '' : 's'} ${values.join(', ')}`
}

// Why takeover may not remove these options: the read was incomplete, or the target does not allow deletes. The block
// carries the mode note.
function takeoverBlock(
  context: Context,
  address: Address,
  action: PlanStep['action'],
  units: string[],
): PlanStep | undefined {
  const { target } = context.input
  const notes = { notes: [optionsNote(context, address, units)] }
  if (!context.coverage.complete) {
    const detail = `takeover would remove ${optionList(units)}, and the read of target ${target} was incomplete, so takeover removes nothing there`
    return { ...blocked(address, action, 'scope', 'read incomplete', detail, INCOMPLETE_FIX), ...notes }
  }
  if (!context.policy.allowDestroy) {
    const detail = `takeover removes ${optionList(units)}, which only the portal holds, and target ${target} does not allow deletes`
    const fix = `keep them in config: run ${pullCommand(target, address)}; or keep them unmanaged: set lifecycle: { options: 'additive' } on ${nameOf(address)}; or remove them: set allowDestroy: true under targets.${target} in kalup.config.ts`
    return { ...blocked(address, action, 'policy', 'option removals not allowed', detail, fix), ...notes }
  }
  return undefined
}

// One tombstone. A release drops the entry at the address, see releaseOf. A destroy deletes an owned resource that is
// present, and is blocked on one it does not own. A tombstone on an address with no entry has nothing else to do.
function removal(
  context: Context,
  address: Address,
  tombstone: IRTombstone,
  deleted: Map<string, Set<string>>,
): PlanStep | undefined {
  const { observation } = context.input
  const owner = ownerOf(context, address)
  const { entry } = owner
  const status = statusOf(observation, address)
  const released = releaseOf(address, tombstone, owner, status)
  if (released || status === 'excluded' || tombstone.action === 'release') {
    return released
  }
  if (owner.stale) {
    return notOwned(context, address, owner.stale)
  }
  if (status === 'absent') {
    return undefined
  }
  if (status === 'unreadable' || status === 'not-observed') {
    return entry ? unread(context, address, status) : undefined
  }
  if (!entry) {
    return notOwned(context, address, undefined)
  }
  if (status === 'unsupported') {
    const detail = 'Kalup does not write this kind of property, so its values cannot be checked before the delete'
    return blocked(
      address,
      'delete',
      'unsupported',
      'unsupported type',
      detail,
      'delete it in HubSpot, then release it',
    )
  }
  return destroy(context, address, entry, deleted)
}

// A release sends nothing, so a release tombstone drops the entry at the address whatever the portal holds: an owning
// one, or one that names another portal name. A destroy releases an owned resource a complete read shows absent, and
// expects it still absent, which apply checks again.
function releaseOf(address: Address, tombstone: IRTombstone, owner: Owner, status: Status): PlanStep | undefined {
  const plain = `${nounOf(address)} ${shownName(address)}${placeOf(address)}`
  if (owner.entry && tombstone.action === 'release') {
    let where = ''
    if (status === 'present') {
      where = '; it stays in HubSpot'
    } else if (status === 'absent') {
      where = '; HubSpot no longer has it'
    }
    return release(address, `Stop managing ${plain}${where}`, {})
  }
  if (owner.entry && status === 'absent') {
    return release(address, `Stop managing ${plain}; HubSpot no longer has it`, { exists: false })
  }
  if (owner.stale && tombstone.action === 'release') {
    const id = owner.stale.id ?? 'no name'
    return release(address, `Drop the state entry for ${plain}, which records ${id}; nothing changes in HubSpot`, {})
  }
  return undefined
}

// A destroy on an address no entry owns: none at all, or one that names another portal name, which only a release
// drops.
function notOwned(context: Context, address: Address, stale: Owned | undefined): PlanStep {
  if (stale === undefined) {
    const detail = 'state has no entry that owns it on this target, so Kalup did not create or adopt it here'
    const fix = 'Kalup deletes only what it created or adopted on this target: remove the tombstone from removed.ts'
    return blocked(address, 'delete', 'not-owned', 'not owned here', detail, fix)
  }
  const id = stale.id ?? 'no name'
  const detail = `state records ${id} for this address, not ${portalName(context, address)}, so the entry owns nothing this tombstone can delete`
  const fix = `run ${bin} rm ${shellWord(address)} --release to drop the entry; ${id} stays in HubSpot as it is`
  return blocked(address, 'delete', 'not-owned', 'not owned here', detail, fix)
}

function destroy(context: Context, address: Address, entry: Owned, deleted: Map<string, Set<string>>): PlanStep {
  const { input, policy } = context
  const observed = input.observation.resources[address] as IRResource
  const key = objectOf(address)
  if (!observed.managed) {
    const detail = 'HubSpot-defined or calculated in this portal, so Kalup does not delete it'
    return blocked(address, 'delete', 'unsupported', 'HubSpot-defined or calculated', detail)
  }
  const readOnly = readOnlyOf(address)
  if (readOnly !== undefined) {
    const fix = "change the tombstone's action to release, which stops managing it and leaves it in HubSpot"
    return blocked(address, 'delete', 'unsupported', 'not written in this release', readOnly, fix)
  }
  const name = portalName(context, address)
  const members: Members | undefined =
    kindOf(address) === 'group'
      ? { active: own(input.observation.members?.[key] ?? {}, name) ?? [], deleted: deleted.get(key) ?? new Set() }
      : undefined
  const block = deleteBlock(input.observation.meta?.[address], members) ?? stageDeleteBlock(context, address, deleted)
  if (block) {
    return blocked(address, 'delete', 'unsupported', block.short, block.detail, block.fix)
  }
  if (!policy.allowDestroy) {
    const detail = `target ${input.target} does not allow deletes`
    const fix = `set allowDestroy: true under targets.${input.target} in kalup.config.ts, or change the tombstone's action to release`
    return blocked(address, 'delete', 'policy', 'deletes not allowed', detail, fix)
  }
  const values = baseValues(entry, observed)
  // A pipeline delete purges every stage it holds, so it expects the full live list: a stage added since stops it.
  if (kindOf(address) === 'pipeline') {
    values.stages = observed.definition?.stages ?? []
  }
  const purged = kindOf(address) === 'pipeline' || kindOf(address) === 'stage'
  const verb = purged ? 'Delete' : 'Archive'
  const step: PlanStep = {
    ...head(address, 'delete', 'destructive', `${verb} ${described(address, observed)}${purged ? PURGED : ''}`),
    expect: Object.keys(values).length > 0 ? { exists: true, values } : { exists: true },
  }
  return finish(step, context.policy, entry)
}

// Why a stage cannot be deleted: derive's rule, over the plan's observation as its config steps leave it, and the
// stages the plan deletes before it.
function stageDeleteBlock(context: Context, address: Address, deleted: Map<string, Set<string>>): Block | undefined {
  if (kindOf(address) !== 'stage') {
    return undefined
  }
  const gone = deleted.get(pipelineOf(address)) ?? new Set()
  // Every config step runs before a delete: the stages they create and the closed states they set count.
  const before = [...context.decided.values()].filter(hasEffect)
  return stageDeleteRule(afterSteps(context.input.observation.resources, before), address, gone, bin)
}

// The live value of every unit the base holds, the options as the full live list: what the delete expects to find.
function baseValues(entry: Owned, observed: IRResource): Record<string, unknown> {
  const live = capturedSpec(observed).fields
  const values: Record<string, unknown> = {}
  for (const unit of Object.keys(entry.base ?? {})) {
    if (unit === 'options' || unit === 'optionsOrder') {
      values.options = observed.definition?.options ?? []
    } else if (Object.hasOwn(live, unit)) {
      values[unit] = live[unit]
    }
  }
  return values
}

// expect: {} for a release tombstone, which drops the entry whatever HubSpot holds; { exists: false } for a destroy
// that a complete read showed absent.
function release(address: Address, title: string, expect: PlanStep['expect']): PlanStep {
  return {
    id: '',
    address,
    action: 'release',
    risk: 'safe',
    transport: TRANSPORT,
    title: sanitize(title, TITLE_MAX),
    expect,
  }
}

// Created or adopted state entries at an address config no longer names and no tombstone removes. One that names
// another portal name owns nothing there, so only a release applies to it. One takeover archives has its step.
function orphansOf(input: StepInput, steps: PlanStep[]): PlanOrphan[] {
  const { loaded, state, target } = input
  const overrides = loaded.config.targets[target]?.overrides ?? {}
  return Object.entries(state?.resources ?? {})
    .filter(
      ([address, entry]) =>
        (entry.origin === 'created' || entry.origin === 'adopted') &&
        !Object.hasOwn(loaded.ir.resources, address) &&
        !Object.hasOwn(loaded.ir.tombstones, address) &&
        coverOf(loaded.ir.tombstones, address) === undefined &&
        !steps.some((s) => s.address === address),
    )
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([address, entry]) => {
      const name = resolvedName(overrides, address)
      const rm = `${bin} rm ${shellWord(address)}`
      let note = `no longer in config: run ${rm} to delete it in HubSpot, or ${rm} --release to stop managing it`
      if (entry.id !== name) {
        const id = entry.id ?? 'no name'
        note = `no longer in config, and state records ${id} for it, not ${name}: run ${rm} --release to drop the entry; ${id} stays in HubSpot as it is`
      }
      return { address, note: sanitize(note, TEXT_MAX) }
    })
}

// The state entry that owns an address: created or adopted, and naming the portal name the address resolves to. One
// naming another portal name owns nothing here.
function ownerOf(context: Context, address: Address): Owner {
  const entry = own(context.input.state?.resources ?? {}, address)
  // A reference or pulled entry owns nothing.
  if (entry === undefined || !(entry.origin === 'created' || entry.origin === 'adopted')) {
    return {}
  }
  return entry.id === portalName(context, address) ? { entry: entry as Owned } : { stale: entry as Owned }
}

// The note on the create or adopt of a config address whose entry names another portal name. Apply sets the entry's
// id when it verifies the step, so the step replaces the entry.
function staleNote(context: Context, address: Address, stale: Owned): PlanNote {
  const name = portalName(context, address)
  const note = `state records ${stale.id ?? 'no name'} for this address, not ${name}, so it owns nothing here; applying this step replaces the entry`
  return { unit: 'name', live: name, note: sanitize(note, TEXT_MAX) }
}

function portalName(context: Context, address: Address): string {
  return resolvedName(context.overrides, address)
}

/**
 * The portal name an address resolves to on a target: its name override, else its own name. A stage's is its stage ID;
 * its pipeline's ID is the pipeline address's.
 */
export function resolvedName(overrides: Record<string, Override>, address: Address): string {
  const override = own(overrides, address)
  const mine = kindOf(address) === 'stage' ? ownId(address) : nameOf(address)
  return (override?.skip === true ? undefined : override?.name) ?? mine
}

// An archived property of one object by portal name; null when its lists were not read.
function archivedOf(
  lists: Record<string, ArchivedProperty[]>,
  key: string,
  name: string,
): ArchivedProperty | undefined | null {
  const list = own(lists, key)
  return list === undefined ? null : list.find((p) => p.name === name)
}

// Whether a take selector names this held unit, recording each that does.
function selects(context: Context, address: Address, unit: string): boolean {
  return pick(context, address, (s) => s.unit === undefined || unit === s.unit || under(unit, s.unit))
}

// Whether a take selector names this missing resource, recording each that does. Only an address with no unit takes
// the whole resource: a unit selector, a glob's included, never recreates one.
function selectsAddress(context: Context, address: Address): boolean {
  return pick(context, address, (s) => s.unit === undefined)
}

function pick(context: Context, address: Address, unit: (s: Selector) => boolean): boolean {
  let hit = false
  for (const [index, s] of context.input.take.entries()) {
    if (addressMatcher(s.address)(address) && unit(s)) {
      context.matched.add(index)
      hit = true
    }
  }
  return hit
}

function under(unit: string, parent: string): boolean {
  return unit.startsWith(`${parent}.`) || unit.startsWith(`${parent}[`)
}

// E_TAKE_UNMATCHED for every selector that named no held unit and no missing resource.
function unmatched(input: PlanInput, decided: Decided): void {
  const issues = input.take.flatMap((s, index): Issue[] => {
    if (decided.matched.has(index)) {
      return []
    }
    const matches = addressMatcher(s.address)
    const held = decided.steps
      .filter((step) => matches(step.address))
      .flatMap((step) => (step.held ?? []).map((h) => `${step.address}#${h.unit}`))
    const there = held.length > 0 ? `held there: ${held.join(', ')}` : 'nothing is held there'
    const gone = s.unit === undefined ? [] : decided.gone.filter((g) => matches(g.address)).map((g) => g.address)
    const whole =
      gone.length > 0 ? `; missing in HubSpot: ${gone.join(', ')}, which only an address with no #unit recreates` : ''
    const selector = s.unit === undefined ? s.address : `${s.address}#${s.unit}`
    return [
      {
        code: 'E_TAKE_UNMATCHED',
        message: sanitize(
          `--take config ${selector} matches no held unit and no missing resource; ${there}${whole}`,
          TEXT_MAX,
        ),
        fix: sanitize(
          `take a held unit or a missing resource that ${bin} plan ${targetFlag(input.target)} lists, or leave the selector out`,
          TEXT_MAX,
        ),
      },
    ]
  })
  if (issues.length > 0) {
    throw new KalupError(issues)
  }
}

// A step's risk and labels, from derive.
function finish(
  step: PlanStep,
  policy: Pick<Policy, 'drift'>,
  owner: Owned | undefined,
  takeover: Pick<StepContext, 'takeover' | 'takeoverUnits'> = {},
): PlanStep {
  const derived: StepContext = {
    drift: policy.drift,
    ...(owner ? { owner: { origin: owner.origin } } : {}),
    ...takeover,
  }
  const labels = stepLabels(step, derived)
  return { ...step, risk: stepRisk(step, derived), ...(labels.length > 0 ? { labels } : {}) }
}

function head(address: Address, action: PlanStep['action'], risk: PlanStep['risk'], title: string) {
  const { family, version } = registry[kindOf(address)]
  return {
    id: '',
    address,
    action,
    risk,
    transport: TRANSPORT,
    api: { family, version },
    title: sanitize(title, TITLE_MAX),
  }
}

function blocked(
  address: Address,
  action: PlanStep['action'],
  reason: BlockedReason,
  short: string,
  detail: string,
  fix?: string,
): PlanStep {
  const title = `Cannot plan ${kindOf(address)} ${shownName(address)}${placeOf(address)}: ${short}`
  return {
    ...head(address, action, 'blocked', title),
    expect: blockedExpect(action),
    blocked: {
      reason,
      detail: sanitize(detail, TEXT_MAX),
      blocks: [],
      ...(fix === undefined ? {} : { fix: sanitize(fix, TEXT_MAX) }),
    },
  }
}

function blockedExpect(action: PlanStep['action']): PlanStep['expect'] {
  if (action === 'create') {
    return { exists: false }
  }
  return action === 'unknown' ? {} : { exists: true }
}

function actionOf(status: Status): PlanStep['action'] {
  if (status === 'absent') {
    return 'create'
  }
  return status === 'present' || status === 'unsupported' ? 'adopt' : 'unknown'
}

function described(address: Address, resource: IRResource): string {
  const d = resource.definition ?? {}
  if (kindOf(address) === 'object') {
    return `custom object "${(d.labels as { singular: string }).singular}" (${nameOf(address)})`
  }
  return `${nounOf(address)} "${String(d.label)}" (${shownName(address)})${placeOf(address)}`
}

// What a person calls a resource of this address's type.
function nounOf(address: Address): string {
  const nouns: Record<string, string> = { group: 'property group', property: 'property', pipeline: 'pipeline' }
  return nouns[kindOf(address)] ?? kindOf(address)
}

function skipFix(address: Address, target: string): string {
  return `leave it out on this target: add { '${address}': { skip: true } } under targets.${target}.overrides`
}

// A skip override on the address, on its object, or on a property's group: the read left them all out.
function skipped(address: Address, resource: IRResource, overrides: Record<string, Override>): boolean {
  const group = (resource.definition?.group as Ref | undefined)?.$ref
  return [address, `object:${objectOf(address)}`, group].some(
    (a) => a !== undefined && own(overrides, a)?.skip === true,
  )
}

// A name override resolves a present address to its portal name; an existing custom object has its type ID. A planned
// create has neither, so it keeps its logical identity: a name override on an absent address blocks its step.
function bindingsOf(open: PlanStep[], overrides: Record<string, Override>, coverage: Coverage): Plan['bindings'] {
  return bindingsFor(open, overrides, (key) => own(coverage.objects, key)?.objectTypeId)
}

/**
 * The bindings of the effect steps `open`: for each address a step, its $refs and its object name, the portal name its
 * name override gives it and, for an object, the type ID `idOf` finds for its key. apply derives them again from
 * kalup.config.ts and the schemas list, so a plan file cannot bind an address to another portal resource.
 */
export function bindingsFor(
  open: PlanStep[],
  overrides: Record<string, Override>,
  idOf: (key: string) => string | undefined,
): Plan['bindings'] {
  const found = new Map<Address, PlanBinding>()
  for (const step of open) {
    for (const address of dependencies(step)) {
      const binding = identity(address, overrides, idOf)
      if (binding) {
        found.set(address, binding)
      }
    }
  }
  return Object.fromEntries([...found].sort(([a], [b]) => byCodeUnit(a, b)))
}

/**
 * A step's own address, every $ref it carries, the pipeline a stage is under, the stages a pipeline create carries or
 * its stage order names (live and approved), the properties a custom object's display, required and searchable fields
 * name, and the object a group, property, pipeline or stage is on. A stage's name override is so a binding of each
 * pipeline step that moves or names the stage, and a property's of each schema step that names it: apply sends their
 * portal names.
 */
export function dependencies(step: PlanStep): Address[] {
  const out = [step.address]
  collectRefs([step.desired, step.changes, step.expect], out)
  if (kindOf(step.address) === 'stage') {
    out.push(pipelineOf(step.address))
  }
  out.push(...(step.stages ?? []).map((st) => st.address))
  if (kindOf(step.address) === 'pipeline') {
    out.push(...orderedStages(step))
  }
  if (kindOf(step.address) === 'object') {
    out.push(...displayed(step))
  } else {
    out.push(`object:${objectOf(step.address)}`)
  }
  return out
}

// The properties a custom object step names in its display, required and searchable fields: those it writes, and
// those the live values it expects name.
function displayed(step: PlanStep): Address[] {
  const key = nameOf(step.address)
  const sides = [step.desired ?? {}, step.expect.values ?? {}]
  const names = sides.flatMap((side) => OBJECT_DISPLAY_FIELDS.flatMap((field) => [side[field] ?? []].flat()))
  return [...new Set(names.filter((n): n is string => typeof n === 'string'))].map((n) => `property:${key}/${n}`)
}

// The stages a pipeline step's stage order names: the live order its expect holds and the order each change sets.
function orderedStages(step: PlanStep): Address[] {
  const lists = [
    step.expect.values?.stages,
    ...(step.changes ?? []).filter((c) => c.unit === 'stages').map((c) => c.after),
  ]
  const prefix = `${step.address.replace('pipeline:', 'stage:')}/`
  const ids = lists.flatMap((list) => (Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []))
  return [...new Set(ids)].map((id) => `${prefix}${id}`)
}

function collectRefs(value: unknown, out: Address[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, out)
    }
    return
  }
  if (value === null || typeof value !== 'object') {
    return
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && typeof item === 'string') {
      out.push(item)
    } else {
      collectRefs(item, out)
    }
  }
}

function identity(
  address: Address,
  overrides: Record<string, Override>,
  idOf: (key: string) => string | undefined,
): PlanBinding | undefined {
  const override = own(overrides, address)
  const name = override?.skip === true ? undefined : override?.name
  const { type, path } = parseAddress(address)
  const id = type === 'object' ? idOf(path) : undefined
  if (name === undefined && id === undefined) {
    return undefined
  }
  return { ...(name === undefined ? {} : { name }), ...(id === undefined ? {} : { id }) }
}

// A step writes to the portal when it creates, deletes, or adopts or updates with a change.
function writes(step: PlanStep): boolean {
  return step.action === 'create' || step.action === 'delete' || (step.changes ?? []).length > 0
}

// What apply would send: three calls per write (the read before it, the write, the read-back), and the observation it
// makes under the lock: four lists per object with an effect, three archived lists per object with a create, a delete
// or a missing entry, the schemas list for a custom object binding, and account-info. Nothing when nothing has an
// effect: apply then sends no request.
function callsOf(steps: PlanStep[], missing: PlanMissing[], bindings: Plan['bindings']): number {
  const effects = steps.filter(hasEffect)
  if (effects.length === 0) {
    return 0
  }
  const objects = new Set(effects.map((s) => objectOf(s.address)))
  const archived = new Set([
    ...effects.filter((s) => s.action === 'create' || s.action === 'delete').map((s) => objectOf(s.address)),
    ...missing.map((m) => objectOf(m.address)),
  ])
  const schemas = Object.values(bindings).some((b) => b.id !== undefined) ? 1 : 0
  // A stage order write moves each stage with its own request and reads the pipeline between moves.
  const moves = effects.flatMap((s) => s.changes ?? []).filter((c) => c.unit === 'stages')
  const reorders = moves.reduce((sum, c) => sum + 2 * ((c.after as string[] | undefined)?.length ?? 0), 0)
  // A custom object create's tail is a write of its own: a read, the PATCH and the read-back.
  const tails = effects.filter(
    (s) =>
      kindOf(s.address) === 'object' && s.action === 'create' && Object.keys(objectTail(s.desired ?? {})).length > 0,
  ).length
  const pipelines = new Set(
    effects
      .filter((s) => kindOf(s.address) === 'pipeline' || kindOf(s.address) === 'stage')
      .map((s) => objectOf(s.address)),
  )
  return (
    3 * (effects.filter(writes).length + tails) +
    4 * objects.size +
    3 * archived.size +
    schemas +
    1 +
    reorders +
    pipelines.size
  )
}

function countsOf(steps: PlanStep[]): Plan['counts'] {
  const counts = { safe: 0, risky: 0, destructive: 0, blocked: 0, manual: 0, held: 0 }
  for (const step of steps) {
    counts[step.risk] += 1
    counts.held += (step.held ?? []).length
  }
  return counts
}

// An object key config does not list under objects was never read, so it is unreadable here too, with no scope. A
// step whose action is unknown was not read either, so the plan is incomplete.
function planCoverage(
  coverage: Coverage,
  steps: PlanStep[],
  excluded: Address[],
  unobserved: string[],
): Plan['coverage'] {
  const objects = Object.entries(coverage.objects).sort(([a], [b]) => byCodeUnit(a, b))
  // An object whose pipelines list answered 403 is listed too: its properties were read, its pipelines were not.
  const scopeOf = (o: ObjectCoverage) => (o.status === 'unreadable' ? o.missingScope : o.pipelines?.missingScope)
  return {
    complete: coverage.complete && !steps.some((s) => s.action === 'unknown'),
    unreadable: [
      ...objects
        .filter(([, o]) => o.status === 'unreadable' || o.pipelines?.status === 'unreadable')
        .map(([object, o]) => (scopeOf(o) === undefined ? { object } : { object, scope: scopeOf(o) as string })),
      ...unobserved.map((object) => ({ object })),
    ].sort((a, b) => byCodeUnit(a.object, b.object)),
    unsupported: objects
      .flatMap(([key, o]) => [
        ...(o.unsupported ?? []).map((u) => `property:${key}/${u.name}`),
        ...(o.unsupportedSchema ? [`object:${key}`] : []),
      ])
      .sort(byCodeUnit),
    excluded,
  }
}

// W_INCOMPLETE names what the plan's own coverage could not read, sorted there. An unlisted key is one config does not
// list under objects: no scope helps it.
function warnings(input: PlanInput, { unreadable }: Plan['coverage'], unlisted: string[]): Issue[] {
  const out: Issue[] = []
  if (unreadable.length > 0) {
    const listed = unreadable.filter((u) => !unlisted.includes(u.object))
    const scopes = [...new Set(listed.flatMap((u) => u.scope ?? []))].sort(byCodeUnit)
    const adds: string[] = []
    if (scopes.length > 0) {
      adds.push(`add the scope${scopes.length > 1 ? 's' : ''} ${scopes.join(', ')} to the key`)
    } else if (listed.length > 0) {
      adds.push('check the scopes of the key')
    }
    if (unlisted.length > 0) {
      adds.push(`add ${unlisted.join(', ')} to objects in kalup.config.ts`)
    }
    const add = adds.join(' and ')
    const keys = unreadable.map((u) => u.object).join(', ')
    out.push({
      code: 'W_INCOMPLETE',
      message: sanitize(`the plan could not read ${keys}, so every step there is blocked`, TEXT_MAX),
      fix: sanitize(`${add}, then run npx ${bin} plan ${targetFlag(input.target)}`, TEXT_MAX),
    })
  }
  if (input.dailyRemaining === null) {
    out.push({
      code: 'W_RATE_HEADERS',
      message: 'HubSpot sent no daily rate-limit header, so the plan cannot weigh its calls against the daily limit',
    })
  }
  return out
}

// `skipped` counts the config resources a skip override leaves out (coverage.excluded); what exclude leaves out of the
// pull scope is never read, so it is not counted.
function coverageText(coverage: Plan['coverage']): string {
  const names = coverage.unreadable.map((u) => (u.scope === undefined ? u.object : `${u.object} (${u.scope})`))
  const which = names.length > 0 ? `, not read: ${names.join(', ')}` : ''
  const state = coverage.complete ? 'complete' : `incomplete${which}`
  return `Coverage: ${state}; ${coverage.unsupported.length} unsupported, ${coverage.excluded.length} skipped.`
}

// A value as one line of JSON with every control escaped, so a person sees what is there.
function show(value: unknown): string {
  return sanitize(escapeJson(JSON.stringify(value) ?? 'null'), VALUE_MAX)
}

function same(a: unknown, b: unknown, set = false): boolean {
  const norm = (value: unknown) =>
    set && Array.isArray(value) ? [...new Set(value as string[])].sort(byCodeUnit) : value
  return stableStringify(norm(a)) === stableStringify(norm(b))
}

// A target observation always carries coverage; the config side is never planned.
function coverageOf(observation: Observation): Coverage {
  return observation.coverage as Coverage
}

// The type ID of every object that was read, by config key: a custom object's observed ID, else a standard object's
// documented one. Limits Tracking keys its per-object custom property entries by these, standard objects included.
function typeIdsOf(coverage: Coverage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, object] of Object.entries(coverage.objects)) {
    const id = object.status === 'read' ? (object.objectTypeId ?? own(STANDARD_OBJECT_TYPE_IDS, key)) : undefined
    if (id !== undefined) {
      out[key] = id
    }
  }
  return out
}

// The input with the target's definition overrides applied to config: every step plans from the effective
// resources, so a step's desired values, which the approval digest covers, are the target's own. irHash stays the
// shared IR's.
function effective<T extends Pick<PlanInput, 'loaded' | 'target'>>(input: T): T {
  const { loaded, target } = input
  return { ...input, loaded: { ...loaded, ir: { ...loaded.ir, resources: effectiveResources(loaded.ir, target) } } }
}

function managed(loaded: Pick<Loaded, 'ir'>, kind: Kind): [Address, IRResource][] {
  return Object.entries(loaded.ir.resources)
    .filter(([, r]) => r.managed && r.type === kind)
    .sort(([a], [b]) => byCodeUnit(a, b))
}

function kindOf(address: Address): Kind {
  return parseAddress(address).type as Kind
}

// An own key only: a key such as 'constructor' must not find Object.prototype.
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
