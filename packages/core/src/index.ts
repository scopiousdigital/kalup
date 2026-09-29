// @kalup/core: zero runtime dependencies, no HTTP. What user project files and apps import: the codecs and builders,
// and the config authoring surface. Every export is listed here, from the file that defines it; test/package.test.ts
// holds the list, and nothing engine-facing belongs in it.
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
export type {
  Definition,
  KalupConfig,
  KalupRemoved,
  ObjectScope,
  Override,
  Target,
  Tombstone,
} from './config.js'
export { defineConfig, defineRemoved } from './config.js'
