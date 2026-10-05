// @kalup/core: zero runtime dependencies, no HTTP. What user project files and apps import: the codecs and builders,
// and the config authoring surface. Every export is listed here, from the file that defines it; test/package.test.ts
// holds the list, and nothing engine-facing belongs in it.
export type {
  EnumAlias,
  EnumValues,
  StandardOutput,
  StandardResult,
  StandardSchema,
  Unlisted,
} from './codecs/builders.js'
export { p } from './codecs/builders.js'
export type {
  Codec,
  EnumPropertyBuilder,
  PropertyBuilder,
  PropertyEntry,
  ReadonlyCodec,
  ReadonlyPropertyBuilder,
  RequiredPropertyBuilder,
} from './codecs/codec.js'
export type {
  DataSensitivity,
  EnumOption,
  EnumReference,
  GroupDefinition,
  NumberDisplay,
  NumberDisplayHint,
  OwnerDefinition,
  PropertyDefinition,
  PropertyLifecycle,
  TextDisplay,
  TextDisplayHint,
} from './codecs/definition.js'
export type { AssociationName, AssociationSpec, DefinedAssociations } from './codecs/association.js'
export { defineAssociations } from './codecs/association.js'
export type { Codecs, DefinedCustomObject, DefinedObject, InferProperties, PropertyName } from './codecs/object.js'
export { defineCustomObject, defineObject, propertyNames } from './codecs/object.js'
export type { DefinedPipeline, PipelineSpec, StageId, StageSpec, StageState } from './codecs/pipeline.js'
export { definePipeline } from './codecs/pipeline.js'
export type {
  Definition,
  KalupConfig,
  KalupRemoved,
  Mode,
  ObjectScope,
  Override,
  Target,
  TargetObject,
  Tombstone,
} from './config.js'
export { defineConfig, defineRemoved } from './config.js'
