// @kalup/core: zero runtime dependencies, no HTTP. The public API: every export is listed here, from the file that
// defines it.
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
  Target,
} from './grammar/types.js'
export { IssueError } from './grammar/types.js'
export { write } from './grammar/write.js'
export { address, parseAddress } from './ir/address.js'
export { DEFAULTS } from './ir/defaults.js'
export { toCreatePayload } from './ir/payload.js'
export { stableStringify } from './ir/serialize.js'
export type { Origin, ResourceState, StateStore, TargetState } from './ir/state.js'
export type {
  Address,
  Binding,
  IR,
  IROverride,
  IRResource,
  IRTarget,
  IRTombstone,
  Issue,
  Lifecycle,
  Provenance,
  Ref,
} from './ir/types.js'
export { validateIR } from './ir/validate.js'
export { type Loaded, type LoadOptions, loadFiles, type Source } from './loader/load.js'
export { FIELD_TYPES, HUBSPOT_TYPES } from './loader/tables.js'
export { type ValidateOptions, type Validation, validate } from './loader/validate.js'
