import { parseAddress } from './address.js'
import type { Address, IRResource, Ref } from './types.js'

/**
 * The exact create body for a managed property (POST /crm/properties/{version}/{objectType}) or group. Enum aliases
 * live in the binding, so they never reach HubSpot. An unmanaged resource is never created, so it throws. Object
 * schemas wait for milestone 4.
 */
export function toCreatePayload(address: Address, resource: IRResource): Record<string, unknown> {
  const { type, path } = parseAddress(address)
  const name = lastSegment(path)
  if (!resource.managed) {
    throw new Error(`${address} is not managed and is never created`)
  }
  const { definition } = resource
  if (!definition) {
    throw new Error(`${address} has no definition to create from`)
  }
  if (type === 'group') {
    return { name, label: definition.label }
  }
  if (type === 'object') {
    throw new Error(`${address}: the create payload for an object waits for milestone 4`)
  }
  if (type !== 'property') {
    throw new Error(`${address}: no create payload for type "${type}"`)
  }
  const group = definition.group as Ref | undefined
  if (!group?.$ref) {
    throw new Error(`${address}: definition.group is not a $ref`)
  }
  const payload: Record<string, unknown> = {
    name,
    label: definition.label,
    type: definition.type,
    fieldType: definition.fieldType,
    groupName: lastSegment(parseAddress(group.$ref).path),
  }
  if ('description' in definition) {
    payload.description = definition.description
  }
  if (Array.isArray(definition.options)) {
    payload.options = definition.options.map((option: Record<string, unknown>, index) => ({
      ...option,
      displayOrder: index,
    }))
  }
  if ('hasUniqueValue' in definition) {
    payload.hasUniqueValue = definition.hasUniqueValue
  }
  if ('formField' in definition) {
    payload.formField = definition.formField
  }
  return payload
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
