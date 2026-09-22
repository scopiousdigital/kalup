import type { StandardSchema } from '../../../src/codecs/index.js'

export interface FleetMeta {
  depot: string
  trucks: number
}

/** A hand-rolled Standard Schema, so the tests need no validation library. */
export const fleetMeta: StandardSchema<FleetMeta> = {
  '~standard': {
    version: 1,
    vendor: 'kalup-test',
    validate(value) {
      const meta = value as Partial<FleetMeta> | null
      if (typeof meta?.depot === 'string' && typeof meta.trucks === 'number') return { value: meta as FleetMeta }
      return { issues: [{ message: 'expected { depot: string, trucks: number }' }] }
    },
  },
}
