// Owned by the ir module. Add exports here, not in src/index.ts.
export { address, parseAddress } from './address.js'
export { DEFAULTS } from './defaults.js'
export { toCreatePayload } from './payload.js'
export { stableStringify } from './serialize.js'
export type { Origin, ResourceState, StateStore, TargetState } from './state.js'
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
} from './types.js'
export { validateIR } from './validate.js'
