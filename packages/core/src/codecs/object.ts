import type { PropertyEntry, ReadonlyCodec } from './codec.js'
import type { GroupDefinition } from './definition.js'

type Entries = Record<string, PropertyEntry<ReadonlyCodec<unknown>>>

/** The codecs of an object: each builder chain unwrapped. */
export type Codecs<P extends Entries> = { [K in keyof P]: P[K]['codec'] }

/** The typed property bag. Linear in the number of properties: it reads the phantom type each codec carries. */
export type InferProperties<P extends Record<string, ReadonlyCodec<unknown>>> = { [K in keyof P]: P[K]['~type'] }

export interface DefinedObject<P extends Entries> {
  readonly name: string
  readonly groups: Record<string, GroupDefinition>
  readonly properties: Codecs<P>
}

export interface DefinedCustomObject<P extends Entries> {
  readonly name: string
  readonly labels: { singular: string; plural: string }
  readonly primaryDisplayProperty: string
  readonly requiredProperties?: string[]
  readonly searchableProperties?: string[]
  readonly secondaryDisplayProperties?: string[]
  readonly groups: Record<string, GroupDefinition>
  readonly properties: Codecs<P>
}

export function defineObject<P extends Entries>(
  name: string,
  spec: { groups?: Record<string, GroupDefinition>; properties: P },
): DefinedObject<P> {
  return { name, groups: spec.groups ?? {}, properties: codecsOf(spec.properties) }
}

export function defineCustomObject<P extends Entries>(
  name: string,
  spec: {
    labels: { singular: string; plural: string }
    primaryDisplayProperty: string
    requiredProperties?: string[]
    searchableProperties?: string[]
    secondaryDisplayProperties?: string[]
    groups?: Record<string, GroupDefinition>
    properties: P
  },
): DefinedCustomObject<P> {
  return {
    name,
    labels: spec.labels,
    primaryDisplayProperty: spec.primaryDisplayProperty,
    requiredProperties: spec.requiredProperties,
    searchableProperties: spec.searchableProperties,
    secondaryDisplayProperties: spec.secondaryDisplayProperties,
    groups: spec.groups ?? {},
    properties: codecsOf(spec.properties),
  }
}

function codecsOf<P extends Entries>(entries: P): Codecs<P> {
  const codecs: Record<string, ReadonlyCodec<unknown>> = {}
  for (const [key, entry] of Object.entries(entries)) codecs[key] = entry.codec
  return codecs as Codecs<P>
}

/** The internal names to pass as `properties` on a CRM read. */
export function propertyNames(object: { properties: Record<string, { property: string }> }): string[] {
  return Object.values(object.properties).map((codec) => codec.property)
}
