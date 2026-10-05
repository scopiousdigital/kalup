// @kalup/engine: the host-agnostic engine, private and bundled into the kalup CLI. No process, terminal, oclif or file
// system: hosts inject those. Every export is listed here, from the file that defines it. The types users write, such
// as Target and Override, come from @kalup/core.
export { originalPath, parseLock, validateLock } from './blueprint/lock.js'
export { applyPrefix } from './blueprint/prefix.js'
export type { Blueprint, BlueprintLock, BlueprintResource, LockEntry, LockHeld } from './blueprint/types.js'
export { defaultCodec, validateBlueprint } from './blueprint/validate.js'
export { bin, disclaimer } from './brand.js'
export {
  type Applied,
  type ApplyData,
  type ApplyDeps,
  type ApplyRequest,
  executePlan,
  type Journal,
  type JournalEntry,
  type JournalRun,
  nothingToApply,
  type StateStore,
} from './engine/apply.js'
export {
  checkDeletes,
  checkNames,
  checkPolicy,
  checkVersions,
  destinationOf,
  parsePlan,
  stepTitle,
  type TakeoverRules,
} from './engine/apply-check.js'
export { namesOf, observeForApply } from './engine/apply-observe.js'
export { createBody, optionsPatch } from './engine/apply-payload.js'
export { type ApprovalMode, decideApproval, destructiveSteps } from './engine/approval.js'
export { type Comparison, compare, compareOutcome, compareText, resolveSide } from './engine/compare.js'
export { dictionary } from './engine/dictionary.js'
export { approvalContext, hasEffect, sha256, writesHash } from './engine/digest.js'
export { configObservation, type Observation, observePortal, observeTarget, type Side } from './engine/observe.js'
export { type Planned, type PlanProject, plan, planPending, planReads, planText, type Selector } from './engine/plan.js'
export { policyOf } from './engine/policy.js'
export { preflight } from './engine/preflight.js'
export { baseUnits, recordPulled } from './engine/pull-base.js'
export {
  type Excluded,
  type Found,
  type Losses,
  type Rebuild,
  rebuild,
  rebuiltState,
  type Stale,
} from './engine/rebuild.js'
export { derivedExact, modeOf, takeoverObjects } from './engine/settings.js'
export {
  fromSnapshot,
  incompleteIssues,
  parseSnapshot,
  planPath,
  type Snapshot,
  snapshotPath,
  snapshotText,
  toSnapshot,
} from './engine/snapshot.js'
export { takeoverCandidates } from './engine/takeover.js'
export { acceptCommand, intoScope, nameOf, objectOf, shellWord, targetFlag } from './engine/units.js'
export { builderKinds, type ReadResult, read } from './grammar/read.js'
export type {
  BarrelEntry,
  BuilderKind,
  ConfigFile,
  Group,
  LifecycleFields,
  ObjectExport,
  ObjectFile,
  Option,
  PipelineExport,
  PipelineFile,
  Property,
  RemovedFile,
  Stage,
} from './grammar/types.js'
export { IssueError } from './grammar/types.js'
export { write } from './grammar/write.js'
export { address, isAddress, parseAddress } from './ir/address.js'
export { DEFAULTS } from './ir/defaults.js'
export { toCreatePayload } from './ir/payload.js'
export { escapeJson, stableStringify } from './ir/serialize.js'
export {
  type Base,
  type Origin,
  parseState,
  type ResourceState,
  type TargetState,
  validateState,
} from './ir/state.js'
export type {
  Address,
  Binding,
  Coverage,
  IR,
  IRObservation,
  IROption,
  IROverride,
  IRResource,
  IRTarget,
  IRTombstone,
  Issue,
  Lifecycle,
  ObjectCoverage,
  Provenance,
  Ref,
  UnsupportedProperty,
  UnsupportedSchema,
} from './ir/types.js'
export { validateIR } from './ir/validate.js'
export type { IssueCode } from './issues.js'
export {
  checkIntegrity,
  compareVersions,
  integrityError,
  lockOf,
  lockText,
  originalError,
  type Prepared,
  parseBlueprint,
  parseOriginal,
  prefixFor,
  prepare,
} from './lib/blueprint/fragment.js'
export { type Merged, mergeResource, toIR, unitsOf } from './lib/blueprint/merge.js'
export { objectsOf, place, refIssues, requiresIssues } from './lib/blueprint/project.js'
export { type ExitCode, exitCodes, KalupError } from './lib/errors.js'
export { type GuardTarget, guardPortal, type PortalInfo } from './lib/guard.js'
export {
  createBucket,
  createHttp,
  createWriteHttp,
  type Fetch,
  type HttpClient,
  type HttpRequest,
  HubSpotApiError,
  MILESTONE_3_WRITES,
  type SendOutcome,
  type WriteHttpClient,
  type WriteRequest,
} from './lib/http.js'
export { pinWarnings } from './lib/pins.js'
export { plural } from './lib/plural.js'
export { camelCase, exportName } from './lib/pull/keys.js'
export { type Change, type Counts, type MergeInput, mergeObject } from './lib/pull/merge.js'
export {
  type LiveObject,
  type LivePipeline,
  type LiveProperty,
  type LiveStage,
  normalizeProperties,
  type RawProperty,
} from './lib/pull/normalize.js'
export { asTarget, fromTarget, pipelineAsTarget, pipelineFromTarget, targetOnly } from './lib/pull/overrides.js'
export {
  mergePipelines,
  type PipelineMergeInput,
  type PipelinesMerged,
  pipelineExportName,
  stageKey,
} from './lib/pull/pipelines.js'
export {
  type ArchivedProperty,
  archivedProperties,
  archivedSchemaNames,
  type Gap,
  type Portal,
  readPortal,
} from './lib/pull/read.js'
export { addressMatcher, definedOn, inScope, pipelinesInScope, STANDARD_OBJECTS, scopeOf } from './lib/pull/scope.js'
export { limitScope, readScope, registry, writeScope } from './lib/registry.js'
export { sanitize } from './lib/sanitize.js'
export { holdsScope, readTokenInfo, type TokenInfo } from './lib/token-info.js'
export { effectiveResources, OVERRIDABLE } from './loader/effective.js'
export {
  barrelPath,
  DEFAULT_DIR,
  inDir,
  type Layout,
  LEGACY_DIR,
  layout,
  normalDir,
  objectPath,
  pipelinePath,
} from './loader/layout.js'
export {
  byCodeUnit,
  definitionToIR,
  inPipelines,
  type Loaded,
  type LoadOptions,
  loadFiles,
  type Source,
} from './loader/load.js'
export { selectTarget, type TargetChoice, type TargetSelection } from './loader/select.js'
export { displayNames, FIELD_TYPES, HUBSPOT_TYPES } from './loader/tables.js'
export {
  objectRemoval,
  onObject,
  REMOVABLE,
  type ValidateOptions,
  type Validation,
  validate,
} from './loader/validate.js'
export {
  advanceBase,
  classify,
  type Rules,
  type Spec,
  specOfBase,
  type UnitClass,
  type UnitResult,
} from './plan/classify.js'
export type {
  BlockedReason,
  LimitReading,
  ManualStep,
  Plan,
  PlanAction,
  PlanBinding,
  PlanChange,
  PlanCoverage,
  PlanExpect,
  PlanHeld,
  PlanLabel,
  PlanMissing,
  PlanNote,
  PlanOrphan,
  PlanStep,
  PlanTarget,
  Risk,
} from './plan/types.js'
export { validatePlan } from './plan/validate.js'
