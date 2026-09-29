import type { StandardSchema } from '@kalup/core'

export interface ParcelMeta {
  depot: string
  pieces: number
}

/** A hand-rolled Standard Schema, so the fixture needs no validation library. */
export const parcelMeta: StandardSchema<ParcelMeta> = {
  '~standard': {
    version: 1,
    vendor: 'kalup-test',
    validate(value) {
      const meta = value as Partial<ParcelMeta> | null
      if (typeof meta?.depot === 'string' && typeof meta.pieces === 'number') return { value: meta as ParcelMeta }
      return { issues: [{ message: 'expected { depot: string, pieces: number }' }] }
    },
  },
}
