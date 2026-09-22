// Owned by pull. Reading a target, the type mapping, the merge, and the app-side name rules.
export { camelCase, exportName } from './keys.js'
export { type Change, type Counts, type Merged, type MergeInput, mergeObject } from './merge.js'
export {
  type LiveCustom,
  type LiveObject,
  type LiveProperty,
  normalizeGroups,
  normalizeProperties,
  normalizeSchema,
  type RawGroup,
  type RawOption,
  type RawProperty,
  type RawSchema,
} from './normalize.js'
export { type Portal, type ReadOptions, readPortal } from './read.js'
export { addressMatcher, inScope, type Scope, STANDARD_OBJECTS, scopeOf } from './scope.js'
