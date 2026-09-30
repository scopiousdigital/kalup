// Pull with a base: each resource the target's state holds a base for, config (the file) and the portal classified
// against that base exactly as plan classifies them, so pull and plan agree on which side moved. After a pull, the
// entries it records: the base of every unit config and the portal now agree on. Pure.

import { parseAddress } from '../ir/address.js'
import { DEFAULTS } from '../ir/defaults.js'
import type { ResourceState, TargetState } from '../ir/state.js'
import type { Address, IRResource } from '../ir/types.js'
import { NORM_VERSIONS } from '../lib/registry.js'
import { effectiveResources } from '../loader/effective.js'
import { byCodeUnit, type Loaded } from '../loader/load.js'
import { advanceBase, classify, type UnitResult } from '../plan/classify.js'
import { type Observation, statusOf } from './observe.js'
import { resolvedName } from './plan.js'
import { baseFor, capturedSpec, ownedFields, specOf } from './units.js'

export interface BaseInput {
  loaded: Pick<Loaded, 'config' | 'ir'>
  /** The target's observation, from the same read pull merges. */
  observation: Pick<Observation, 'resources'>
  /** The verified portal's state; null when it has none. */
  state: TargetState | null
  target: string
}

/**
 * The classified units of every address config manages and the portal holds whose state entry has a base this
 * version's normalizer wrote for the portal name the address resolves to: an owning entry (created or adopted), or one
 * an earlier pull recorded (pulled). An address with no such entry is left out: pull merges it by today's rules. Config
 * is the target's effective config, so a field the target overrides compares the override's value with this portal's
 * base.
 */
export function baseUnits(input: BaseInput): Map<Address, UnitResult[]> {
  const { loaded, observation, state, target } = input
  const overrides = loaded.config.targets[target]?.overrides ?? {}
  const resources = effectiveResources(loaded.ir, target)
  const out = new Map<Address, UnitResult[]>()
  for (const [address, entry] of Object.entries(state?.resources ?? {})) {
    const base = baseFor(entry, address, resolvedName(overrides, address))
    const resource = own(resources, address)
    const observed = own(observation.resources, address)
    if (base === undefined || !(resource?.managed && observed?.managed)) {
      continue
    }
    const { options, removedOptions } = resource.lifecycle ?? DEFAULTS.lifecycle
    const config = specOf(ownedFields(resource))
    out.set(address, classify(base, config, capturedSpec(observed), { options, removedOptions }))
  }
  return out
}

export interface RecordInput extends BaseInput {
  observation: Observation
  /** The addresses the pull merged: its --only filter. */
  only: (address: string) => boolean
}

/**
 * The state entries a pull leaves, from config as the pull wrote it and the observation it merged. For each resource
 * config manages that a complete read found, that the filter selects and that no tombstone removes, the base advances
 * over every unit config and the portal agree on, as advanceBase does after an apply: an owning entry keeps its origin;
 * an address no entry owns gets a `pulled` entry, which owns nothing. An entry that names another portal name, or a
 * `reference` one, is left as it is. A `pulled` entry whose address config no longer manages is dropped.
 */
export function recordPulled(input: RecordInput): Record<Address, ResourceState> {
  const { loaded, observation, state, target, only } = input
  const overrides = loaded.config.targets[target]?.overrides ?? {}
  const resources = effectiveResources(loaded.ir, target)
  const next: Record<Address, ResourceState> = {}
  for (const [address, entry] of Object.entries(state?.resources ?? {})) {
    if (entry.origin !== 'pulled' || own(resources, address)?.managed) {
      next[address] = entry
    }
  }
  const managed = Object.entries(resources)
    .filter(([address, r]) => r.managed && only(address) && !Object.hasOwn(loaded.ir.tombstones, address))
    .sort(([a], [b]) => byCodeUnit(a, b))
  for (const [address, resource] of managed) {
    const observed = own(observation.resources, address)
    if (statusOf(observation, address) !== 'present' || !observed?.managed) {
      continue
    }
    const entry = recorded(own(next, address), address, resolvedName(overrides, address), resource, observed)
    if (entry) {
      next[address] = entry
    }
  }
  return next
}

// The entry after a pull for one resource the portal holds, or undefined to leave the address as it is: an owning
// entry with its base advanced, a new or refreshed pulled entry, nothing where no unit agrees or the entry is not
// pull's to touch.
function recorded(
  entry: ResourceState | undefined,
  address: Address,
  id: string,
  resource: IRResource,
  observed: IRResource,
): ResourceState | undefined {
  const owned = entry !== undefined && (entry.origin === 'created' || entry.origin === 'adopted') && entry.id === id
  if (entry !== undefined && !owned && entry.origin !== 'pulled') {
    return undefined
  }
  const previous = entry === undefined ? undefined : baseFor(entry, address, id)
  const base = advanceBase(previous, specOf(ownedFields(resource)), capturedSpec(observed))
  if (base === undefined) {
    return undefined
  }
  const normVersion = NORM_VERSIONS[parseAddress(address).type as keyof typeof NORM_VERSIONS]
  return owned ? { ...entry, normVersion, base } : { origin: 'pulled', id, normVersion, base }
}

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
