// Owned by the codecs module. Add exports here, not in src/index.ts.

export type { EnumAlias, EnumValues, StandardOutput, StandardResult, StandardSchema } from './builders.js'
export { p } from './builders.js'
export type {
  Codec,
  PropertyBuilder,
  PropertyEntry,
  ReadonlyCodec,
  ReadonlyPropertyBuilder,
  RequiredPropertyBuilder,
} from './codec.js'
export type { EnumOption, EnumReference, GroupDefinition, PropertyDefinition, PropertyLifecycle } from './definition.js'
export type { Codecs, DefinedCustomObject, DefinedObject, InferProperties } from './object.js'
export { defineCustomObject, defineObject, propertyNames } from './object.js'
