// Owned by the grammar module. Add exports here, not in src/index.ts.
export { builderKinds, type ReadResult, read } from './read.js'
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
} from './types.js'
export { IssueError } from './types.js'
export { write } from './write.js'
