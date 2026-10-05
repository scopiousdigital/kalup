import type { PropertyEntry, ReadonlyCodec } from './codec.js'
import type { GroupDefinition } from './definition.js'

type Entries = Record<string, PropertyEntry<ReadonlyCodec<unknown>>>

/** The codecs of an object: each builder chain unwrapped. */
export type Codecs<P extends Entries> = { [K in keyof P]: P[K]['codec'] }

/** The typed property bag. Linear in the number of properties: it reads the phantom type each codec carries. */
export type InferProperties<P extends Record<string, ReadonlyCodec<unknown>>> = { [K in keyof P]: P[K]['~type'] }

export interface DefinedObject<P extends Entries> {
  readonly groups: Record<string, GroupDefinition>
  readonly name: string
  readonly properties: Codecs<P>
}

export interface DefinedCustomObject<P extends Entries> {
  /** The description HubSpot shows for the object. */
  readonly description?: string
  readonly groups: Record<string, GroupDefinition>
  readonly labels: { singular: string; plural: string }
  readonly name: string
  readonly primaryDisplayProperty: string
  readonly properties: Codecs<P>
  readonly requiredProperties?: string[]
  readonly searchableProperties?: string[]
  readonly secondaryDisplayProperties?: string[]
}

/** No properties: what an export without a `properties` block holds, as the canonical writer leaves an empty one. */
type NoEntries = Record<never, never>

export function defineObject<P extends Entries = NoEntries>(
  name: string,
  spec: { groups?: Record<string, GroupDefinition>; properties?: P },
): DefinedObject<P> {
  return { name, groups: spec.groups ?? {}, properties: codecsOf(spec.properties) }
}

export function defineCustomObject<P extends Entries = NoEntries>(
  name: string,
  spec: {
    /** The description HubSpot shows for the object. */
    description?: string
    labels: { singular: string; plural: string }
    primaryDisplayProperty: string
    requiredProperties?: string[]
    searchableProperties?: string[]
    secondaryDisplayProperties?: string[]
    groups?: Record<string, GroupDefinition>
    properties?: P
  },
): DefinedCustomObject<P> {
  return {
    name,
    description: spec.description,
    labels: spec.labels,
    primaryDisplayProperty: spec.primaryDisplayProperty,
    requiredProperties: spec.requiredProperties,
    searchableProperties: spec.searchableProperties,
    secondaryDisplayProperties: spec.secondaryDisplayProperties,
    groups: spec.groups ?? {},
    properties: codecsOf(spec.properties),
  }
}

function codecsOf<P extends Entries>(entries: P | undefined): Codecs<P> {
  const codecs: Record<string, ReadonlyCodec<unknown>> = {}
  for (const [key, entry] of Object.entries(entries ?? {})) {
    codecs[key] = entry.codec
  }
  return codecs as Codecs<P>
}

interface Named {
  readonly properties: Record<string, { readonly property: string }>
}

/**
 * The internal names of an object's properties as a union, `PropertyName<typeof Company>`: the keys of the raw bag a
 * CRM read returns, for example `Partial<Record<PropertyName<typeof Company>, string | null>>`.
 */
export type PropertyName<O extends Named> = O['properties'][keyof O['properties']]['property']

/** The internal names to pass as `properties` on a CRM read. */
export function propertyNames<O extends Named>(object: O): PropertyName<O>[] {
  return Object.values(object.properties).map((codec) => codec.property as PropertyName<O>)
}
