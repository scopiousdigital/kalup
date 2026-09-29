// @kalup/core: zero runtime dependencies, no HTTP. The public API: every export is listed here, from the file that
// defines it.
export { LOCK_FILE, originalPath, parseLock, validateLock } from './blueprint/lock.js'
export { applyPrefix } from './blueprint/prefix.js'
export type { Blueprint, BlueprintLock, BlueprintResource, LockEntry, LockHeld } from './blueprint/types.js'
export { defaultCodec, validateBlueprint } from './blueprint/validate.js'
export type { EnumAlias, EnumValues, StandardOutput, StandardResult, StandardSchema } from './codecs/builders.js'
export { p } from './codecs/builders.js'
export type {
  Codec,
  PropertyBuilder,
  PropertyEntry,
  ReadonlyCodec,
  ReadonlyPropertyBuilder,
  RequiredPropertyBuilder,
} from './codecs/codec.js'
export type {
  EnumOption,
  EnumReference,
  GroupDefinition,
  PropertyDefinition,
  PropertyLifecycle,
} from './codecs/definition.js'
export type { Codecs, DefinedCustomObject, DefinedObject, InferProperties } from './codecs/object.js'
export { defineCustomObject, defineObject, propertyNames } from './codecs/object.js'
export { builderKinds, type ReadResult, read } from './grammar/read.js'
export type {
  BarrelEntry,
  BuilderKind,
  ConfigFile,
  Definition,
  Group,
  LifecycleFields,
  ObjectExport,
  ObjectFile,
  ObjectScope,
  Option,
  Override,
  Property,
  RemovedFile,
  Target,
  Tombstone,
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
  type ResourceState,
  type StateStore,
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
export { effectiveResources, OVERRIDABLE } from './loader/effective.js'
export {
  byCodeUnit,
  definitionToIR,
  type Loaded,
  type LoadOptions,
  loadFiles,
  type Source,
} from './loader/load.js'
export { selectTarget, type TargetChoice, type TargetSelection } from './loader/select.js'
export { FIELD_TYPES, HUBSPOT_TYPES } from './loader/tables.js'
export { type ValidateOptions, type Validation, validate } from './loader/validate.js'
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
