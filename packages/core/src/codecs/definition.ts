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

/** How HubSpot shows a number. `formatted` is HubSpot's default. */
export type NumberDisplayHint = 'currency' | 'duration' | 'formatted' | 'percentage' | 'probability' | 'unformatted'

/** How HubSpot shows and checks a text value. HubSpot takes no value that removes a hint once set. */
export type TextDisplayHint =
  | 'domain_name'
  | 'email'
  | 'ip_address'
  | 'multi_line'
  | 'phone_number'
  | 'physical_address'
  | 'postal_code'
  | 'unformatted_single_line'

/** HubSpot's data sensitivity. `non_sensitive` is the default; the other two need Enterprise and a sensitive scope. */
export type DataSensitivity = 'non_sensitive' | 'sensitive' | 'highly_sensitive'

/**
 * A managed property. `label`, `group` and `fieldType` come together; the rest is owned only when present. A field left
 * out belongs to the portal: Kalup never stores, compares or writes it.
 */
export interface PropertyDefinition<O extends readonly EnumOption[] = readonly EnumOption[]> {
  /**
   * The formula of a calculation property, with `fieldType: 'calculation_equation'`, in HubSpot's formula syntax.
   * HubSpot stores its own spelling of a formula (`a+1` becomes `a + 1`), which pull writes back.
   * @default undefined, so the portal's
   */
  calculationFormula?: string
  /**
   * Sensitive data, set when HubSpot creates the property: HubSpot ignores a change afterwards, so a difference blocks
   * the plan. A target override may not change it.
   * @default undefined, so the portal's
   */
  dataSensitivity?: DataSensitivity
  /**
   * The description HubSpot shows. An empty string owns an empty description.
   * @default undefined, so the portal's
   */
  description?: string
  /**
   * The property's place in its group: the lowest positive number first, `-1` after every positive one.
   * @default undefined, so the portal's (HubSpot creates a property at -1)
   */
  displayOrder?: number
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
  /**
   * Whether HubSpot hides the property: it is not shown and cannot be used in HubSpot.
   * @default undefined, so the portal's
   */
  hidden?: boolean
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

/** The display fields of a `p.number` property. */
export interface NumberDisplay {
  /**
   * The property HubSpot reads the currency code from, such as `deal_currency_code`. HubSpot takes it only while
   * `showCurrencySymbol` is true, and refuses to turn the symbol off once it is set.
   * @default undefined, so the portal's
   */
  currencyPropertyName?: string
  /**
   * How HubSpot shows the number.
   * @default undefined, so the portal's (`formatted` when HubSpot holds none)
   */
  numberDisplayHint?: NumberDisplayHint
  /**
   * Whether HubSpot shows the account's currency symbol with the number.
   * @default undefined, so the portal's
   */
  showCurrencySymbol?: boolean
}

/** The display field of a text property: `p.string`, `p.stringArray`, `p.json` and `p.phoneNumber`. */
export interface TextDisplay {
  /**
   * How HubSpot shows and checks the text.
   * @default undefined, so the portal's
   */
  textDisplayHint?: TextDisplayHint
}

/**
 * A `p.owner` property: HubSpot fills its options with the account's users, so it takes none, and Kalup sends
 * `externalOptions: true` and `referencedObjectType: 'OWNER'` on create.
 */
export type OwnerDefinition = Omit<PropertyDefinition, 'options' | 'calculationFormula'> & {
  calculationFormula?: never
  options?: never
}

/** The one reference form with data: an enum whose options exist only for typing. Nothing owns them. */
export interface EnumReference<O extends readonly EnumOption[] = readonly EnumOption[]> {
  calculationFormula?: never
  dataSensitivity?: never
  description?: never
  displayOrder?: never
  fieldType?: never
  formField?: never
  group?: never
  hasUniqueValue?: never
  hidden?: never
  label?: never
  lifecycle?: never
  options: O
}

/** A property group of one object. */
export interface GroupDefinition {
  /** The label HubSpot shows. */
  label: string
}
