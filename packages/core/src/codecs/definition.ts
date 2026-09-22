// Property and group definitions as the config files carry them, in HubSpot terms.

export interface EnumOption {
  value: string
  label: string
  /** App-side alias. The TypeScript type is the union of `as ?? value`. Never sent to HubSpot. */
  as?: string
  hidden?: boolean
  description?: string
}

export interface PropertyLifecycle {
  options?: 'additive' | 'exact'
  removedOptions?: string[]
  ignoreChanges?: string[]
  preventDestroy?: boolean
}

/** A managed property. `label`, `group` and `fieldType` come together; the rest is owned only when present. */
export interface PropertyDefinition<O extends readonly EnumOption[] = readonly EnumOption[]> {
  label: string
  group: string
  fieldType: string
  description?: string
  options?: O
  hasUniqueValue?: boolean
  formField?: boolean
  lifecycle?: PropertyLifecycle
}

/** The one reference form with data: an enum whose options exist only for typing. Nothing owns them. */
export interface EnumReference<O extends readonly EnumOption[] = readonly EnumOption[]> {
  options: O
  label?: never
  group?: never
  fieldType?: never
  description?: never
  hasUniqueValue?: never
  formField?: never
  lifecycle?: never
}

export interface GroupDefinition {
  label: string
}
