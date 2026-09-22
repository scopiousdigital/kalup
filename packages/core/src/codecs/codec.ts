import type { EnumReference, PropertyDefinition } from './definition.js'

/** Reads one property out of a HubSpot properties bag. `Codec` adds `set`. */
export interface ReadonlyCodec<T> {
  readonly property: string
  readonly definition: PropertyDefinition | EnumReference | undefined
  /** A full definition is present and the chain did not say `.managed(false)`. */
  readonly managed: boolean
  /** Phantom. Carries the value type for `InferProperties` and never exists at run time. */
  readonly '~type': T
  get(properties: Record<string, string | null>): T
}

export interface Codec<T> extends ReadonlyCodec<T> {
  /** `null` and `undefined` leave the bag untouched. */
  set(properties: Record<string, string>, value: T | null | undefined): void
}

/** What `defineObject` reads from a builder chain. */
export interface PropertyEntry<C> {
  readonly codec: C
}

export interface ReadonlyPropertyBuilder<C> extends PropertyEntry<C> {
  managed(flag: false): PropertyEntry<C>
}

export interface RequiredPropertyBuilder<T, X = unknown> extends PropertyEntry<Codec<T> & X> {
  readonly(): ReadonlyPropertyBuilder<ReadonlyCodec<T> & X>
  managed(flag: false): PropertyEntry<Codec<T> & X>
}

/** The chain a `p.*` builder returns: `.required()`, `.readonly()`, `.managed(false)`, in that order. */
export interface PropertyBuilder<T, X = unknown> extends RequiredPropertyBuilder<T, X> {
  required(): RequiredPropertyBuilder<NonNullable<T>, X>
}

/** Wire conversion for one builder. Never sees a missing or blank value. */
export interface Kind<V> {
  decode(wire: string, property: string): V
  encode(value: V): string
}

class CodecImpl<V> implements Codec<V | null> {
  declare readonly '~type': V | null

  constructor(
    readonly property: string,
    readonly definition: PropertyDefinition | EnumReference | undefined,
    readonly managed: boolean,
    private readonly kind: Kind<V>,
    private readonly required: boolean,
  ) {}

  get(properties: Record<string, string | null>): V | null {
    const wire = properties[this.property]
    if (wire === undefined || wire === null || wire.trim() === '') {
      if (this.required) throw new Error(`Property '${this.property}' is required but has no value`)
      return null
    }
    return this.kind.decode(wire, this.property)
  }

  set(properties: Record<string, string>, value: V | null | undefined): void {
    if (value === null || value === undefined) return
    properties[this.property] = this.kind.encode(value)
  }
}

interface Chain<V, X> {
  readonly codec: Codec<V | null> & X
  required(): Chain<V, X>
  readonly(): Chain<V, X>
  managed(flag: false): Chain<V, X>
}

function chain<V, X extends object>(
  property: string,
  definition: PropertyDefinition | EnumReference | undefined,
  kind: Kind<V>,
  extra: X,
  required: boolean,
  managed: boolean,
): Chain<V, X> {
  const self: Chain<V, X> = {
    codec: Object.assign(new CodecImpl(property, definition, managed, kind, required), extra),
    required: () => chain(property, definition, kind, extra, true, managed),
    readonly: () => self,
    managed: () => chain(property, definition, kind, extra, required, false),
  }
  return self
}

/** Starts a builder chain. `extra` lands on the codec, for `enumValues`. */
export function builder<V, X extends object>(
  property: string,
  definition: PropertyDefinition | EnumReference | undefined,
  kind: Kind<V>,
  extra: X,
): PropertyBuilder<V | null, X> {
  const managed = definition?.label !== undefined
  return chain(property, definition, kind, extra, false, managed) as PropertyBuilder<V | null, X>
}
