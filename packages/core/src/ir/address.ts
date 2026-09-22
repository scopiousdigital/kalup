import type { Address } from './types.js'

const ADDRESS = /^[a-z]+:\S+$/

export function address(type: string, path: string): Address {
  const out = `${type}:${path}`
  if (!ADDRESS.test(out)) {
    throw new Error(`not an address: "${out}"`)
  }
  return out
}

export function parseAddress(value: Address): { type: string; path: string } {
  if (!ADDRESS.test(value)) {
    throw new Error(`not an address: "${value}"`)
  }
  const at = value.indexOf(':')
  return { type: value.slice(0, at), path: value.slice(at + 1) }
}
