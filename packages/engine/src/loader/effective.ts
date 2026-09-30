// Per-target definition overrides: the IR's resources as one target sees them. Each field an override
// states replaces the shared field whole, options as a list in the override's order; lifecycle is replaced field by
// field. Plan, compare, pull and validate use this one effective configuration. Pure.
import type { Definition, LifecycleFields } from '../grammar/types.js'
import { parseAddress } from '../ir/address.js'
import { PROPERTY_FIELDS } from '../ir/defaults.js'
import type { Address, IR, IRResource } from '../ir/types.js'
import { definitionToIR } from './load.js'

/** The definition fields a target may override, by resource type. */
export const OVERRIDABLE: Record<'property' | 'group', readonly (keyof Definition)[]> = {
  property: [
    'label',
    'description',
    'group',
    'fieldType',
    'formField',
    'options',
    'hidden',
    'displayOrder',
    'numberDisplayHint',
    'showCurrencySymbol',
    'currencyPropertyName',
    'textDisplayHint',
    'calculationFormula',
  ],
  group: ['label'],
}

/** The lifecycle fields a target may override on a property, each on its own. */
export const OVERRIDABLE_LIFECYCLE: readonly (keyof LifecycleFields)[] = ['options', 'removedOptions', 'ignoreChanges']

// The order definitionToIR writes, so an effective definition reads like a shared one.
const ORDER: readonly string[] = PROPERTY_FIELDS

/**
 * The IR's resources with target `target`'s definition overrides applied, in IR form: a group as a $ref, options as
 * HubSpot sees them. Skip and name overrides are the read's to apply; a skip wins, so a skipped address keeps its
 * shared definition. An override on anything that cannot take one (validate reports it) changes nothing.
 */
export function effectiveResources(ir: IR, target: string): Record<Address, IRResource> {
  const overrides = own(ir.targets, target)?.overrides ?? {}
  const out: Record<Address, IRResource> = { ...ir.resources }
  for (const [address, override] of Object.entries(overrides)) {
    const resource = own(ir.resources, address)
    if (override.skip === true || override.definition === undefined || !resource) {
      continue
    }
    out[address] = withDefinition(address, resource, override.definition as Definition)
  }
  return out
}

/**
 * One resource with one override's definition applied, whatever else the override says. A resource that cannot take
 * a definition override, a reference or a custom object schema, comes back as it is.
 */
export function withDefinition(address: Address, resource: IRResource, override: Definition): IRResource {
  const { type, path } = parseAddress(address)
  if (!(resource.managed && (type === 'property' || type === 'group'))) {
    return resource
  }
  const stated = pick(override, OVERRIDABLE[type])
  const object = path.slice(0, path.indexOf('/'))
  const merged = { ...resource.definition, ...definitionToIR(object, resource.binding?.codec ?? 'string', stated) }
  const definition = Object.fromEntries(
    [
      ...ORDER.filter((field) => Object.hasOwn(merged, field)),
      ...Object.keys(merged).filter((f) => !ORDER.includes(f)),
    ].map((field) => [field, merged[field]]),
  )
  const lifecycle =
    type === 'property' && override.lifecycle && resource.lifecycle
      ? { ...resource.lifecycle, ...pick(override.lifecycle, OVERRIDABLE_LIFECYCLE) }
      : resource.lifecycle
  return { ...resource, definition, ...(lifecycle ? { lifecycle } : {}) }
}

function pick<T extends object>(value: T, fields: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const field of fields) {
    if (value[field] !== undefined) {
      out[field] = value[field]
    }
  }
  return out
}

// An own key only: a target or address such as 'constructor' must not find Object.prototype.
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
