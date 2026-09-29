// Pull with a base: each resource the target's state owns with a base, config (the file) and the portal
// classified against that base exactly as plan classifies them, so pull and plan agree on which side moved. Pure.
import {
  type Address,
  classify,
  DEFAULTS,
  effectiveResources,
  type IRResource,
  type Loaded,
  parseAddress,
  type TargetState,
  type UnitResult,
} from '@kalup/core'
import { NORM_VERSIONS } from '../lib/registry.js'
import type { Observation } from './observe.js'
import { resolvedName } from './plan.js'
import { capturedSpec, ownedFields, specOf } from './units.js'

export interface BaseInput {
  loaded: Pick<Loaded, 'config' | 'ir'>
  /** The target's observation, from the same read pull merges. */
  observation: Pick<Observation, 'resources'>
  /** The verified portal's state, read and never written; null when it has none. */
  state: TargetState | null
  target: string
}

/**
 * The classified units of every address config manages and the portal holds whose state entry owns it (created or
 * adopted, naming the portal name the address resolves to) with a base this version's normalizer wrote. An address
 * with no such entry is left out: pull merges it by today's rules. Config is the target's effective config, so a field
 * the target overrides compares the override's value with this portal's base.
 */
export function baseUnits(input: BaseInput): Map<Address, UnitResult[]> {
  const { loaded, observation, state, target } = input
  const overrides = loaded.config.targets[target]?.overrides ?? {}
  const resources = effectiveResources(loaded.ir, target)
  const out = new Map<Address, UnitResult[]>()
  for (const [address, entry] of Object.entries(state?.resources ?? {})) {
    const owned = entry.origin === 'created' || entry.origin === 'adopted'
    if (!owned || entry.base === undefined || entry.id !== resolvedName(overrides, address)) {
      continue
    }
    const kind = parseAddress(address).type as keyof typeof NORM_VERSIONS
    if (!Object.hasOwn(NORM_VERSIONS, kind) || (entry.normVersion ?? NORM_VERSIONS[kind]) !== NORM_VERSIONS[kind]) {
      continue
    }
    const resource = own(resources, address)
    const observed = own(observation.resources, address)
    if (!(resource?.managed && observed?.managed)) {
      continue
    }
    const { options, removedOptions } = resource.lifecycle ?? DEFAULTS.lifecycle
    const config = specOf(ownedFields(resource))
    out.set(address, classify(entry.base, config, capturedSpec(observed), { options, removedOptions }))
  }
  return out
}

function own(record: Record<string, IRResource>, key: string): IRResource | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
