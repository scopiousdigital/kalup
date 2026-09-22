// Property and group definitions as the config files carry them, in HubSpot terms.

export interface EnumOption {
  /** App-side alias. The TypeScript type is the union of `as ?? value`. Never sent to HubSpot. */
  as?: string
  description?: string
  hidden?: boolean
  label: string
  value: string
}

export interface PropertyLifecycle {
  ignoreChanges?: string[]
  options?: 'additive' | 'exact'
  preventDestroy?: boolean
  removedOptions?: string[]
}

/** A managed property. `label`, `group` and `fieldType` come together; the rest is owned only when present. */
export interface PropertyDefinition<O extends readonly EnumOption[] = readonly EnumOption[]> {
  description?: string
  fieldType: string
  formField?: boolean
  group: string
  hasUniqueValue?: boolean
  label: string
  lifecycle?: PropertyLifecycle
  options?: O
}

/** The one reference form with data: an enum whose options exist only for typing. Nothing owns them. */
export interface EnumReference<O extends readonly EnumOption[] = readonly EnumOption[]> {
  description?: never
  fieldType?: never
  formField?: never
  group?: never
  hasUniqueValue?: never
  label?: never
  lifecycle?: never
  options: O
}

export interface GroupDefinition {
  label: string
}
