// Property and group definitions as the config files carry them, in HubSpot terms.

/** One option of an enumeration property. */
export interface EnumOption {
  /**
   * App-side alias. The TypeScript type is the union of `as ?? value`. Never sent to HubSpot.
   * @default undefined, so the value
   */
  as?: string
  /**
   * The option's description in HubSpot.
   * @default undefined, so the portal's
   */
  description?: string
  /**
   * Whether HubSpot hides the option in forms and the UI. An option the portal hides is planned as a change to show it.
   * @default false
   */
  hidden?: boolean
  /** The label HubSpot shows. */
  label: string
  /** The stored value. */
  value: string
}

/** How a plan treats a property's definition over time. */
export interface PropertyLifecycle {
  /**
   * Definition fields set on create and then left to the portal.
   * @default []
   */
  ignoreChanges?: string[]
  /**
   * `'additive'` adds and updates options and keeps options only the portal holds; `'exact'` also removes them.
   * @default 'additive'
   */
  options?: 'additive' | 'exact'
  /**
   * Refuse `kalup rm` and any delete of this property.
   * @default false
   */
  preventDestroy?: boolean
  /**
   * Option values to remove from the portal. None may name a kept option.
   * @default []
   */
  removedOptions?: string[]
}

/**
 * A managed property. `label`, `group` and `fieldType` come together; the rest is owned only when present. A field left
 * out belongs to the portal: Kalup never stores, compares or writes it.
 */
export interface PropertyDefinition<O extends readonly EnumOption[] = readonly EnumOption[]> {
  /**
   * The description HubSpot shows. An empty string owns an empty description.
   * @default undefined, so the portal's
   */
  description?: string
  /** HubSpot's field type, such as `text` or `select`. It must be one the builder allows. */
  fieldType: string
  /**
   * Whether the property can be used in forms.
   * @default undefined, so the portal's
   */
  formField?: boolean
  /** The internal name of a group of the same object. */
  group: string
  /**
   * Whether HubSpot enforces a unique value across records. A target override may not change it.
   * @default undefined, so the portal's
   */
  hasUniqueValue?: boolean
  /** The label HubSpot shows. */
  label: string
  /**
   * How a plan treats this definition over time.
   * @default undefined, so every lifecycle default
   */
  lifecycle?: PropertyLifecycle
  /**
   * The options in display order, for `p.enum` and `p.multiEnum`. `options: []` owns an empty list.
   * @default undefined, so the portal's
   */
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

/** A property group of one object. */
export interface GroupDefinition {
  /** The label HubSpot shows. */
  label: string
}
