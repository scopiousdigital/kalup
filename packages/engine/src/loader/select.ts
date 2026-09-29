// The one rule for the target a command runs against: the requested name, else defaultTarget, else the only
// target. Pure: a host with a terminal may ask the person when the rule finds several targets and no selection.
import type { ConfigFile } from '../grammar/types.js'

/** A declared target as a selector lists it. */
export interface TargetChoice {
  name: string
  portalId?: number
}

export type TargetSelection =
  | { status: 'selected'; name: string; via: 'flag' | 'default' | 'only' }
  | { status: 'unknown'; requested: string; choices: TargetChoice[] }
  | { status: 'invalid-default'; defaultTarget: string; choices: TargetChoice[] }
  | { status: 'ambiguous'; choices: TargetChoice[] }
  | { status: 'none' }

/**
 * The target for `requested`, the name a command was given, or the reason there is none. An unknown requested name
 * never falls back to the default, and the first of several targets is never chosen. Choices are in declaration order.
 */
export function selectTarget(
  config: Pick<ConfigFile, 'defaultTarget' | 'targets'>,
  requested?: string,
): TargetSelection {
  const { targets, defaultTarget } = config
  // Own keys only: a name such as 'toString' must not find Object.prototype.
  const choices = (): TargetChoice[] =>
    Object.keys(targets).map((name) => {
      const portalId = targets[name]?.portalId
      return portalId === undefined ? { name } : { name, portalId }
    })
  if (requested !== undefined) {
    return Object.hasOwn(targets, requested)
      ? { status: 'selected', name: requested, via: 'flag' }
      : { status: 'unknown', requested, choices: choices() }
  }
  if (defaultTarget !== undefined) {
    return Object.hasOwn(targets, defaultTarget)
      ? { status: 'selected', name: defaultTarget, via: 'default' }
      : { status: 'invalid-default', defaultTarget, choices: choices() }
  }
  const names = Object.keys(targets)
  if (names.length === 1) {
    return { status: 'selected', name: names[0] as string, via: 'only' }
  }
  return names.length === 0 ? { status: 'none' } : { status: 'ambiguous', choices: choices() }
}
