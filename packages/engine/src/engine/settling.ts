// Reads that settle after a write. For some minutes after a write HubSpot may serve an older copy: a custom object
// schema reverts to fields from before a PATCH, a new custom object is missing from the schemas list, a new label's
// name is missing from the schema read for about 5 minutes (live runs 2026-10-05, docs/hubspot.md). A read that
// disagrees with what apply wrote and verified, on a unit it wrote, or does not show a resource it wrote, is not
// evidence of anything inside that window: the resource is settling, unknown to every command until the window ends. A
// disagreement on any other unit is drift as ever, and the base never moves on a settling read. Pure.
import type { Override } from '@kalup/core'
import { pairOf, parseAddress } from '../ir/address.js'
import type { ResourceState, TargetState } from '../ir/state.js'
import type { Address, IRResource, Settling } from '../ir/types.js'
import { byCodeUnit } from '../loader/load.js'
import { classify, specOfBase } from '../plan/classify.js'
import { baseFor, capturedSpec, objectOf, resolvedName } from './units.js'

/** How long after a verified write a read that disagrees with it is not trusted: longer than every lag observed. */
export const SETTLE_MS = 5 * 60_000

export interface SettlingInput {
  now: Date
  /** The target's name overrides: the portal name an entry must hold to own its address. */
  overrides: Record<string, Override>
  /** What the read captured, by address. */
  resources: Record<Address, IRResource>
  state: TargetState | null
  /** The read's verdict on an address before settling: present, absent, or another status settling leaves alone. */
  status: (address: Address) => string
}

/** The addresses the read cannot be trusted on yet, each with why and until when. Sorted. */
export function settlingOf(input: SettlingInput): Record<Address, Settling> {
  const entries = Object.entries(input.state?.resources ?? {})
  const out = new Map<Address, Settling>()
  for (const [address, entry] of entries) {
    const settling = settlingFor(input, address, entry)
    if (settling !== undefined) {
      out.set(address, settling)
    }
  }
  // What lies under a custom object the read does not list yet, or on a pair with it, was not read either: a plain
  // association apply created with it records no unit, so its own entry cannot tell (run 73dfce0a, 2026-10-06).
  const unlisted = new Map(
    [...out]
      .filter(([a, s]) => s.reason === 'missing' && parseAddress(a).type === 'object')
      .map(([a, s]) => [objectOf(a), s]),
  )
  for (const [address, entry] of entries) {
    const [parent] = objectsOf(address).flatMap((key) => unlisted.get(key) ?? [])
    const unseen = UNSEEN.has(input.status(address))
    if (parent !== undefined && !out.has(address) && unseen && owns(input, address, entry)) {
      out.set(address, { reason: 'missing', until: parent.until })
    }
  }
  return Object.fromEntries([...out].sort(([a], [b]) => byCodeUnit(a, b)))
}

/**
 * The units an entry records apply wrote, each with when: `units` at `now`, and those of an earlier write whose window
 * is still open, since a read may still serve the copy from before them. Undefined when none is open.
 */
export function writtenAfter(entry: ResourceState | undefined, units: string[], now: Date): ResourceState['written'] {
  const at = now.toISOString()
  const kept = Object.entries(entry?.written ?? {}).filter(([, when]) => settlesUntil(when, now) !== undefined)
  const written = new Map([...kept, ...units.map((unit): [string, string] => [unit, at])])
  return written.size === 0 ? undefined : Object.fromEntries([...written].sort(([a], [b]) => byCodeUnit(a, b)))
}

// Missing: apply wrote the resource within the window and the read does not show it, whatever its origin and whatever
// removed.ts asks, since an absence then proves nothing. Stale: the read shows another value than the base on a unit
// written within the window. Only an entry that owns its address counts.
function settlingFor(input: SettlingInput, address: Address, entry: ResourceState): Settling | undefined {
  if (!owns(input, address, entry)) {
    return undefined
  }
  const status = input.status(address)
  if (status === 'absent') {
    const until = entry.writtenAt === undefined ? undefined : settlesUntil(entry.writtenAt, input.now)
    return until === undefined ? undefined : { reason: 'missing', until }
  }
  const open = Object.entries(entry.written ?? {}).flatMap(([unit, at]): [string, string][] => {
    const until = settlesUntil(at, input.now)
    return until === undefined ? [] : [[unit, until]]
  })
  if (open.length === 0) {
    return undefined
  }
  const observed = Object.hasOwn(input.resources, address) ? input.resources[address] : undefined
  const base = observed && baseFor(entry, address, entry.id as string)
  if (status !== 'present' || !observed?.managed || base === undefined) {
    return undefined
  }
  const until = new Map(open)
  const moved = classify(base, specOfBase(base), capturedSpec(observed), { options: 'additive' }).flatMap((u) => {
    const end = u.class === 'converged' ? undefined : until.get(u.unit)
    return end === undefined ? [] : [end]
  })
  return moved.length === 0 ? undefined : { reason: 'stale', until: latest(moved) }
}

// The statuses a read gives what lies under an object it does not list.
const UNSEEN = new Set(['absent', 'not-observed', 'unreadable'])

// Whether the entry owns its address: it created or adopted the resource under the portal name config gives it.
function owns(input: SettlingInput, address: Address, entry: ResourceState): boolean {
  const owner = entry.origin === 'created' || entry.origin === 'adopted'
  return owner && entry.id === resolvedName(input.overrides, address)
}

// The objects an address lies under: an association's two, nothing for an object itself.
function objectsOf(address: Address): string[] {
  const { type } = parseAddress(address)
  if (type === 'object') {
    return []
  }
  return type === 'association' ? pairOf(address) : [objectOf(address)]
}

// When the window after a write at `at` ends, or undefined when it has ended. A time ahead of this clock counts as now,
// so the window ends at most SETTLE_MS from now; one more than SETTLE_MS ahead is a wrong clock, not a write minutes
// ago, and settles nothing: either way a clock running fast elsewhere cannot hold a resource settling for its skew.
function settlesUntil(at: string, now: Date): string | undefined {
  const written = Date.parse(at)
  if (!Number.isFinite(written) || written > now.getTime() + SETTLE_MS) {
    return undefined
  }
  const end = Math.min(written, now.getTime()) + SETTLE_MS
  return now.getTime() < end ? new Date(end).toISOString() : undefined
}

function latest(times: string[]): string {
  return [...times].sort(byCodeUnit).at(-1) as string
}
