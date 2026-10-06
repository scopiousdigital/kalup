// The settling window after apply's writes, for tests. A test that edits HubSpot right after an apply means an edit
// made later, when a read that disagrees with what apply wrote is drift and no longer settling.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTLE_MS, stableStringify, type TargetState } from '@kalup/engine'

/** As if the window had passed: moves each written time in every state file in `folder` back by it. */
export function settleState(folder: string): void {
  const earlier = (at: string) => new Date(Date.parse(at) - SETTLE_MS).toISOString()
  for (const [path, state] of stateFiles(folder)) {
    for (const entry of Object.values(state.resources)) {
      if (entry.written) {
        entry.written = Object.fromEntries(Object.entries(entry.written).map(([unit, at]) => [unit, earlier(at)]))
      }
      if (entry.writtenAt) {
        entry.writtenAt = earlier(entry.writtenAt)
      }
    }
    writeFileSync(path, `${stableStringify(state)}\n`)
  }
}

/** When the window after the last write a state file in `folder` records ends, in milliseconds since the epoch. */
export function settledAt(folder: string): number {
  const times = stateFiles(folder).flatMap(([, state]) =>
    Object.values(state.resources).flatMap((entry) =>
      [...Object.values(entry.written ?? {}), ...(entry.writtenAt ? [entry.writtenAt] : [])].map((at) =>
        Date.parse(at),
      ),
    ),
  )
  return Math.max(0, ...times) + SETTLE_MS
}

const STATE_FILE = /^portal-\d+\.json$/

function stateFiles(folder: string): [string, TargetState][] {
  return readdirSync(folder)
    .filter((name) => STATE_FILE.test(name))
    .map((name) => [join(folder, name), JSON.parse(readFileSync(join(folder, name), 'utf8')) as TargetState])
}
