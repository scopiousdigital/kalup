import type { EnumReference, PropertyDefinition } from './definition.js'

/** Reads one property out of a HubSpot properties bag. `Codec` adds `set`. */
export interface ReadonlyCodec<T> {
  /** Phantom. Carries the value type for `InferProperties` and never exists at run time. */
  readonly '~type': T
  readonly definition: PropertyDefinition | EnumReference | undefined
  get: (properties: Record<string, string | null>) => T
  /** A full definition is present and the chain did not say `.managed(false)`. */
  readonly managed: boolean
  readonly property: string
}

export interface Codec<T> extends ReadonlyCodec<T> {
  /** `null` and `undefined` leave the bag untouched. */
  set: (properties: Record<string, string>, value: T | null | undefined) => void
}

/** What `defineObject` reads from a builder chain. */
export interface PropertyEntry<C> {
  readonly codec: C
}

export interface ReadonlyPropertyBuilder<C> extends PropertyEntry<C> {
  managed: (flag: false) => PropertyEntry<C>
}

export interface RequiredPropertyBuilder<T, X = unknown> extends PropertyEntry<Codec<T> & X> {
  managed: (flag: false) => PropertyEntry<Codec<T> & X>
  readonly: () => ReadonlyPropertyBuilder<ReadonlyCodec<T> & X>
}

/** The chain a `p.*` builder returns: `.required()`, `.readonly()`, `.managed(false)`, in that order. */
export interface PropertyBuilder<T, X = unknown> extends RequiredPropertyBuilder<T, X> {
  required: () => RequiredPropertyBuilder<NonNullable<T>, X>
}

/**
 * The chain `p.enum` and `p.multiEnum` return. `.strict()` comes first and swaps `T`, which admits unlisted values, for
 * `S`, the listed aliases alone.
 */
export interface EnumPropertyBuilder<T, S, X = unknown> extends PropertyBuilder<T, X> {
  strict: () => PropertyBuilder<S, X>
}

/** Wire conversion for one builder. Never sees a missing or blank value. */
export interface Kind<V> {
  decode: (wire: string, property: string) => V
  encode: (value: V) => string
}

class CodecImpl<V> implements Codec<V | null> {
  declare readonly '~type': V | null
  readonly property: string
  readonly definition: PropertyDefinition | EnumReference | undefined
  readonly managed: boolean
  private readonly kind: Kind<V>
  private readonly required: boolean

  constructor(
    property: string,
    definition: PropertyDefinition | EnumReference | undefined,
    managed: boolean,
    kind: Kind<V>,
    required: boolean,
  ) {
    this.property = property
    this.definition = definition
    this.managed = managed
    this.kind = kind
    this.required = required
  }

  get(properties: Record<string, string | null>): V | null {
    const wire = properties[this.property]
    if (wire === undefined || wire === null || wire.trim() === '') {
      if (this.required) {
        throw new Error(`Property '${this.property}' is required but has no value`)
      }
      return null
    }
    return this.kind.decode(wire, this.property)
  }

  set(properties: Record<string, string>, value: V | null | undefined): void {
    if (value === null || value === undefined) {
      return
    }
    properties[this.property] = this.kind.encode(value)
  }
}

interface Chain<V, X> {
  readonly codec: Codec<V | null> & X
  managed: (flag: false) => Chain<V, X>
  readonly: () => Chain<V, X>
  required: () => Chain<V, X>
  strict?: () => Chain<V, X>
}

/** One builder's fixed parts. `strict` is the kind `.strict()` swaps in, for the enum builders only. */
interface Parts<V, X> {
  definition: PropertyDefinition | EnumReference | undefined
  extra: X
  kind: Kind<V>
  property: string
  strict?: Kind<V>
}

function chain<V, X extends object>(parts: Parts<V, X>, required: boolean, managed: boolean): Chain<V, X> {
  const { property, definition, kind, extra, strict } = parts
  const self: Chain<V, X> = {
    codec: Object.assign(new CodecImpl(property, definition, managed, kind, required), extra),
    required: () => chain(parts, true, managed),
    readonly: () => self,
    managed: () => chain(parts, required, false),
  }
  if (strict) {
    self.strict = () => chain({ ...parts, kind: strict, strict: undefined }, required, managed)
  }
  return self
}

/** Starts a builder chain. `extra` lands on the codec, for `enumValues`; `strict` is the kind `.strict()` swaps in. */
export function builder<V, X extends object>(
  property: string,
  definition: PropertyDefinition | EnumReference | undefined,
  kind: Kind<V>,
  extra: X,
  strict?: Kind<V>,
): PropertyBuilder<V | null, X> {
  const managed = definition?.label !== undefined
  return chain({ property, definition, kind, extra, strict }, false, managed) as PropertyBuilder<V | null, X>
}
