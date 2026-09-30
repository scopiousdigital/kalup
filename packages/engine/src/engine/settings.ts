// The mode a target gives an object, and the option lifecycle it derives. One rule resolves mode: a target's statement
// beats a shared one and a narrower resource beats a wider one, so targets.<t>.objects.<o>, then targets.<t>, then
// objects.<o>, then the top level, then 'addon'. Under takeover, lifecycle.options defaults to 'exact'; one stated on
// the property or in the target's override wins. Pure.
import type { Mode } from '@kalup/core'
import type { ConfigFile } from '../grammar/types.js'
import { parseAddress } from '../ir/address.js'
import { DEFAULTS } from '../ir/defaults.js'
import type { Address, IRResource } from '../ir/types.js'
import { byCodeUnit, type Loaded } from '../loader/load.js'

/** A resolved setting and the config path that gave it, or 'default'. */
export interface Resolved<T> {
  from: string
  value: T
}

type Settings = Pick<ConfigFile, 'mode' | 'objects' | 'targets'>

/** The mode of `object` on `target`, and where it came from. */
export function modeOf(config: Settings, target: string, object: string): Resolved<Mode> {
  const t = own(config.targets, target)
  const scope = own(config.objects, object)
  const stated: [string, Mode | undefined][] = [
    [`targets.${target}.objects.${object}.mode`, own(t?.objects ?? {}, object)?.mode],
    [`targets.${target}.mode`, t?.mode],
    [`objects.${object}.mode`, scope?.mode],
    ['mode', config.mode],
  ]
  const found = stated.find(([, value]) => value !== undefined)
  return found ? { from: found[0], value: found[1] as Mode } : { from: 'default', value: 'addon' }
}

/** The objects under `objects` whose mode on `target` is takeover, sorted. */
export function takeoverObjects(config: Settings, target: string): string[] {
  return Object.keys(config.objects)
    .filter((object) => modeOf(config, target, object).value === 'takeover')
    .sort(byCodeUnit)
}

/**
 * The options lifecycle of a property on `target`: the stated one, from the target's override or the shared
 * definition, else 'exact' under takeover and 'additive' otherwise. `derived` is true when takeover gave 'exact'.
 */
export function optionsOf(
  loaded: Pick<Loaded, 'config' | 'optionsStated'>,
  target: string,
  address: Address,
  resource: IRResource,
): { derived: boolean; options: 'additive' | 'exact' } {
  const override = own(own(loaded.config.targets, target)?.overrides ?? {}, address)
  const stated =
    override?.definition?.lifecycle?.options !== undefined || (loaded.optionsStated ?? []).includes(address)
  const { options } = resource.lifecycle ?? DEFAULTS.lifecycle
  if (stated || modeOf(loaded.config, target, objectOf(address)).value !== 'takeover') {
    return { derived: false, options }
  }
  return { derived: true, options: 'exact' }
}

/**
 * Per managed property whose options lifecycle takeover made 'exact' on `target`, its removedOptions: removing one of
 * those is config's own ask, removing any other option is takeover's. Apply derives the takeover label from it.
 */
export function derivedExact(
  loaded: Pick<Loaded, 'config' | 'ir' | 'optionsStated'>,
  target: string,
  resources: Record<Address, IRResource>,
): Record<Address, string[]> {
  const out: Record<Address, string[]> = {}
  for (const [address, resource] of Object.entries(resources).sort(([a], [b]) => byCodeUnit(a, b))) {
    if (resource.type === 'property' && resource.managed && optionsOf(loaded, target, address, resource).derived) {
      out[address] = [...(resource.lifecycle?.removedOptions ?? [])]
    }
  }
  return out
}

function objectOf(address: Address): string {
  const { path } = parseAddress(address)
  return path.slice(0, path.indexOf('/'))
}

// An own key only: a key such as 'constructor' must not find Object.prototype.
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
