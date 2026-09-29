// kalup state rebuild's engine, ADR 0021 "Recovery": which config resources the target's portal holds, which state
// entries are stale, and the new lineage a rebuild writes: an adopted entry, with a base where config and the portal
// agree, for every config resource the portal holds. Tombstoned addresses are never adopted. Pure.
import {
  type Address,
  advanceBase,
  byCodeUnit,
  classify,
  DEFAULTS,
  effectiveResources,
  type IRResource,
  type Loaded,
  parseAddress,
  type ResourceState,
  stableStringify,
  type TargetState,
} from '@kalup/core'
import { NORM_VERSIONS } from '../lib/registry.js'
import { type Observation, type Status, statusOf } from './observe.js'
import { resolvedName } from './plan.js'
import { capturedSpec, ownedFields, specOf } from './units.js'

export interface RebuildInput {
  loaded: Pick<Loaded, 'config' | 'ir'>
  observation: Observation
  /** The portal's current state, or null when it has none. */
  state: TargetState | null
  target: string
}

/** A config resource the portal holds, adopted by name. */
export interface Found {
  address: Address
  /** The units config and the portal agree on, which the new base records. */
  agreed: number
  /** The portal name the entry records. */
  id: string
  /** The units config owns that the portal holds. */
  units: number
}

/** A current entry the rebuild would not keep as it is. */
export interface Stale {
  address: Address
  id: string | null
  /** `renamed`: it records another portal name; `absent`: the portal no longer holds it; `not-in-config`. */
  reason: 'renamed' | 'absent' | 'not-in-config'
}

/** A config address or tombstone the rebuild does not adopt. */
export interface Excluded {
  address: Address
  reason: 'tombstone' | 'skipped' | 'unread' | 'unsupported' | 'hubspot-defined'
}

/** What the current state file holds that a rebuild loses. */
export interface Losses {
  /** Entries whose base the rebuild changes or drops. */
  bases: Address[]
  /** Entries with origin `created`, which the rebuild records as `adopted`. */
  created: Address[]
  /** Entries the rebuild does not write. */
  dropped: Address[]
}

export interface Rebuild {
  excluded: Excluded[]
  found: Found[]
  /** The rebuild's loss against the current file; absent when there is none. */
  loses?: Losses
  /** Config resources a complete read shows absent. */
  missing: Address[]
  /** The entries a rebuild writes. */
  resources: Record<Address, ResourceState>
  stale: Stale[]
}

/** The rebuild report and the entries it would write. */
export function rebuild(input: RebuildInput): Rebuild {
  const { loaded, observation, target } = input
  const overrides = loaded.config.targets[target]?.overrides ?? {}
  const found: Found[] = []
  const missing: Address[] = []
  const excluded: Excluded[] = Object.keys(loaded.ir.tombstones).map((address) => ({ address, reason: 'tombstone' }))
  const resources: Record<Address, ResourceState> = {}
  // The target's effective config: a base records what its definition overrides and the portal agree on.
  const managed = Object.entries(effectiveResources(loaded.ir, target))
    .filter(([, r]) => r.managed)
    .sort(([a], [b]) => byCodeUnit(a, b))
  for (const [address, resource] of managed) {
    const status = statusOf(observation, address)
    const observed = Object.hasOwn(observation.resources, address) ? observation.resources[address] : undefined
    const skipped = Object.hasOwn(overrides, address) && overrides[address]?.skip === true
    const reason = skipped ? 'skipped' : notAdopted(status, observed)
    if (reason === 'absent') {
      missing.push(address)
    } else if (reason) {
      excluded.push({ address, reason })
    } else {
      const adopted = adopt(address, resource, observed as IRResource, resolvedName(overrides, address))
      resources[address] = adopted.entry
      found.push(adopted.found)
    }
  }
  excluded.sort((a, b) => byCodeUnit(a.address, b.address))
  const loses = input.state ? lossesOf(input.state, resources) : undefined
  return {
    found,
    missing,
    stale: staleOf(input),
    excluded,
    resources,
    ...(loses ? { loses } : {}),
  }
}

// Why a config resource is not adopted, or undefined when the portal holds it and Kalup can manage it.
function notAdopted(status: Status, observed: IRResource | undefined): Excluded['reason'] | 'absent' | undefined {
  if (status === 'excluded') {
    return 'skipped'
  }
  if (status === 'absent') {
    return 'absent'
  }
  if (status === 'unreadable' || status === 'not-observed') {
    return 'unread'
  }
  if (status === 'unsupported') {
    return 'unsupported'
  }
  return observed?.managed ? undefined : 'hubspot-defined'
}

// The adopted entry for a resource the portal holds: its portal name, and a base of the units config and the portal
// agree on, as apply records an adoption.
function adopt(
  address: Address,
  resource: IRResource,
  observed: IRResource,
  id: string,
): { entry: ResourceState; found: Found } {
  const owned = specOf(ownedFields(resource))
  const live = capturedSpec(observed)
  const { options, removedOptions } = resource.lifecycle ?? DEFAULTS.lifecycle
  const units = classify(undefined, owned, live, { options, removedOptions })
  const kind = parseAddress(address).type as keyof typeof NORM_VERSIONS
  const base = advanceBase(undefined, owned, live)
  return {
    entry: { origin: 'adopted', id, normVersion: NORM_VERSIONS[kind], ...(base === undefined ? {} : { base }) },
    found: { address, id, units: units.length, agreed: units.filter((u) => u.class === 'converged').length },
  }
}

/** The new lineage's state: serial 1, as the first save of a new file has. */
export function rebuiltState(
  portalId: number,
  lineage: string,
  resources: Record<Address, ResourceState>,
): TargetState {
  return { format: 'kalup.state/1', lineage, serial: 1, portalId, resources }
}

// The owned entries of the current file that name another portal name, that the portal no longer holds, or whose
// address config no longer names.
function staleOf(input: RebuildInput): Stale[] {
  const { loaded, observation, state, target } = input
  const overrides = loaded.config.targets[target]?.overrides ?? {}
  const out: Stale[] = []
  for (const [address, entry] of Object.entries(state?.resources ?? {}).sort(([a], [b]) => byCodeUnit(a, b))) {
    if (!(entry.origin === 'created' || entry.origin === 'adopted')) {
      continue
    }
    if (!Object.hasOwn(loaded.ir.resources, address)) {
      out.push({ address, id: entry.id, reason: 'not-in-config' })
    } else if (entry.id !== resolvedName(overrides, address)) {
      out.push({ address, id: entry.id, reason: 'renamed' })
    } else if (statusOf(observation, address) === 'absent') {
      out.push({ address, id: entry.id, reason: 'absent' })
    }
  }
  return out
}

function lossesOf(state: TargetState, next: Record<Address, ResourceState>): Losses | undefined {
  const entries = Object.entries(state.resources).sort(([a], [b]) => byCodeUnit(a, b))
  const created = entries.filter(([, e]) => e.origin === 'created').map(([a]) => a)
  const dropped = entries.filter(([a]) => !Object.hasOwn(next, a)).map(([a]) => a)
  const bases = entries
    .filter(([a, e]) => Object.hasOwn(next, a) && e.base !== undefined && !sameBase(e.base, next[a]?.base))
    .map(([a]) => a)
  return created.length + dropped.length + bases.length > 0 ? { created, dropped, bases } : undefined
}

function sameBase(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}
