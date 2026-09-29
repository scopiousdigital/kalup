// The library entry of the kalup package: `import { defineConfig } from 'kalup'` in kalup.config.ts, and
// `import { defineRemoved } from 'kalup'` in kalup/removed.ts. The tool parses those files and never runs them, and the
// app never imports them, so this exists for editor types only. It must not import index.ts, which starts the CLI on
// import.
import type { ConfigFile, Target, Tombstone } from '@kalup/core'

/**
 * What defineConfig takes: the reader's ConfigFile without the header and imports the reader owns. `objects` and
 * `targets` are optional because the writer drops an empty one. `portalId` is required: the reader tolerates a missing
 * one only so validate can report it.
 */
export interface KalupConfig extends Omit<ConfigFile, 'header' | 'imports' | 'objects' | 'targets'> {
  objects?: ConfigFile['objects']
  targets?: Record<string, Omit<Target, 'portalId'> & { portalId: number }>
}

// Not generic on purpose: a type parameter inferred from the literal would switch off excess property checks, and a
// misspelled field would type-check while the reader rejects it.
export function defineConfig(config: KalupConfig): KalupConfig {
  return config
}

/** What defineRemoved takes: a tombstone per property or group address, written by kalup rm. */
export type KalupRemoved = Record<`property:${string}/${string}` | `group:${string}/${string}`, Tombstone>

export function defineRemoved(removed: KalupRemoved): KalupRemoved {
  return removed
}
