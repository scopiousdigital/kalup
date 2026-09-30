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
  } else if (definition.type === 'bool' && definition.fieldType === 'booleancheckbox') {
    // Observed (docs/hubspot.md): HubSpot refuses a boolean without exactly the options true and false.
    payload.options = BOOLEAN_OPTIONS.map((option) => ({ ...option }))
  }
  for (const field of CREATE_FIELDS) {
    if (field in definition) {
      payload[field] = definition[field]
    }
  }
  return payload
}

/** The fields a create sends as the definition states them, after name, label, type, fieldType, group and options. */
const CREATE_FIELDS = [
  'hasUniqueValue',
  'formField',
  'hidden',
  'displayOrder',
  'numberDisplayHint',
  'showCurrencySymbol',
  'currencyPropertyName',
  'textDisplayHint',
  'calculationFormula',
  'dataSensitivity',
  'externalOptions',
  'referencedObjectType',
] as const

/** The two options HubSpot requires on a `bool` property, labelled as HubSpot's UI labels them. */
const BOOLEAN_OPTIONS = [
  { label: 'Yes', value: 'true', displayOrder: 0, hidden: false },
  { label: 'No', value: 'false', displayOrder: 1, hidden: false },
]

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
