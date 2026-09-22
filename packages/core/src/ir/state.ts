// kalup.state/1: .kalup/state/<target>.json. Types and the store interface only; nothing writes state before milestone 4.
import type { Address } from './types.js'

/** created and adopted entries are owned. */
export type Origin = 'created' | 'adopted' | 'reference'

export interface ResourceState {
  origin: Origin
  id: string | null
  via?: string
  normVersion?: number
  base?: Record<string, unknown>
  baseHash?: string
  attested?: { by: string; at: string }
}

export interface TargetState {
  format: 'kalup.state/1'
  lineage: string
  serial: number
  target: { name: string; portalId: number }
  lastApply?: { planId: string; commit?: string; actor: string; at: string }
  resources: Record<Address, ResourceState>
}

export interface StateStore {
  read(target: string): Promise<TargetState | null>
  /** Throws a StateConflict (milestone 4, beside FileStateStore) when the stored serial is not expectSerial. */
  write(target: string, next: TargetState, expectSerial: number | null): Promise<void>
  lock(target: string, who: string): Promise<{ release(): Promise<void> }>
}
