import type { Address } from './types.js'

const ADDRESS = /^[a-z]+:\S+$/

export function address(type: string, path: string): Address {
  const out = `${type}:${path}`
  if (!ADDRESS.test(out)) {
    throw new Error(`not an address: "${out}"`)
  }
  return out
}

/** Whether `value` is an address: a lowercase type, a colon and a path without whitespace. */
export function isAddress(value: string): boolean {
  return ADDRESS.test(value)
}

export function parseAddress(value: Address): { type: string; path: string } {
  if (!ADDRESS.test(value)) {
    throw new Error(`not an address: "${value}"`)
  }
  const at = value.indexOf(':')
  return { type: value.slice(0, at), path: value.slice(at + 1) }
}

/** The two objects of an association address, in the direction it is written: `association:<from>/<to>/<name>`. */
export function pairOf(at: Address): [string, string] {
  const [from = '', to = ''] = parseAddress(at).path.split('/')
  return [from, to]
}

/** One key for both directions of an association's pair: its objects in code-unit order, joined by a slash. */
export function pairKey(at: Address): string {
  const [from, to] = pairOf(at)
  return from < to ? `${from}/${to}` : `${to}/${from}`
}

/** An association's internal name: the rest of its path after the pair. */
export function associationName(at: Address): string {
  return parseAddress(at).path.split('/').slice(2).join('/')
}
