// The prefix, ADR 0011: a rename map over the fragment's own addresses. Pure.
import type { Address } from '../ir/types.js'
import type { Blueprint } from './types.js'

/**
 * The fragment with every group and property name (the last path segment of its address) renamed to
 * `<prefix><name>`, in the addresses and in every `$ref` inside a definition that names one of them. A `$ref` to an
 * address outside the fragment, which the project provides, is left as it is. Labels, option values, descriptions,
 * binding keys, object keys and `requires` stay. An empty prefix is the identity.
 */
export function applyPrefix(fragment: Blueprint, prefix: string): Blueprint {
  if (prefix === '') {
    return fragment
  }
  const renamed = new Map<Address, Address>(
    Object.keys(fragment.resources).map((address) => [address, prefixed(address, prefix)]),
  )
  const resources = Object.fromEntries(
    Object.entries(fragment.resources).map(([address, resource]) => [
      renamed.get(address) as Address,
      { ...resource, definition: refs(resource.definition, renamed) as Record<string, unknown> },
    ]),
  )
  return { ...fragment, resources }
}

/** `<type>:<object>/<prefix><name>`. */
function prefixed(address: Address, prefix: string): Address {
  const cut = address.lastIndexOf('/')
  return `${address.slice(0, cut + 1)}${prefix}${address.slice(cut + 1)}`
}

// Every `{ $ref }` renamed through the map. fromEntries defines own keys, so a key such as '__proto__' stays a key.
function refs(value: unknown, renamed: Map<Address, Address>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => refs(item, renamed))
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length === 1 && keys[0] === '$ref' && typeof record.$ref === 'string') {
    return { $ref: renamed.get(record.$ref) ?? record.$ref }
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, refs(item, renamed)]))
}
