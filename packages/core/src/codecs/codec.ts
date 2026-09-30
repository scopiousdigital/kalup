import type { EnumReference, PropertyDefinition } from './definition.js'

/**
 * Reads one property out of a HubSpot properties bag. `Codec` adds `set` and `clear`. `N` is the internal name, a
 * string literal when the builder was given one.
 */
export interface ReadonlyCodec<T, N extends string = string> {
  /** Phantom. Carries the value type for `InferProperties` and never exists at run time. */
  readonly '~type': T
  readonly definition: PropertyDefinition | EnumReference | undefined
  get: (properties: Record<string, string | null>) => T
  /** A full definition is present and the chain did not say `.managed(false)`. */
  readonly managed: boolean
  readonly property: N
}

export interface Codec<T, N extends string = string> extends ReadonlyCodec<T, N> {
  /**
   * Writes `''`, which is how HubSpot clears a property on a create or update. Refused (`never`) on a `.required()`
   * codec, whose value is never empty.
   */
  clear: null extends T ? (properties: Record<string, string>) => void : never
  /** `null` and `undefined` leave the bag untouched, so an unset field is never sent. `clear` empties a value. */
  set: (properties: Record<string, string>, value: T | null | undefined) => void
}

/** What `defineObject` reads from a builder chain. */
export interface PropertyEntry<C> {
  readonly codec: C
}

export interface ReadonlyPropertyBuilder<C> extends PropertyEntry<C> {
  managed: (flag: false) => PropertyEntry<C>
}

export interface RequiredPropertyBuilder<T, X = unknown, N extends string = string>
  extends PropertyEntry<Codec<T, N> & X> {
  managed: (flag: false) => PropertyEntry<Codec<T, N> & X>
  readonly: () => ReadonlyPropertyBuilder<ReadonlyCodec<T, N> & X>
}

/**
 * The chain a `p.*` builder returns: `.required()`, `.readonly()`, `.managed(false)`, in that order. `N` is the
 * property's internal name.
 */
export interface PropertyBuilder<T, X = unknown, N extends string = string> extends RequiredPropertyBuilder<T, X, N> {
  required: () => RequiredPropertyBuilder<NonNullable<T>, X, N>
}

/**
 * The chain `p.enum` and `p.multiEnum` return. `.strict()` comes first and swaps `T`, which admits unlisted values, for
 * `S`, the listed aliases alone.
 */
export interface EnumPropertyBuilder<T, S, X = unknown, N extends string = string> extends PropertyBuilder<T, X, N> {
  strict: () => PropertyBuilder<S, X, N>
}

/** Wire conversion for one builder. Never sees a missing or blank value. */
export interface Kind<V> {
  decode: (wire: string, property: string) => V
  encode: (value: V) => string
}

// Not declared as implementing Codec: `clear` is conditional on the value type, which stays generic here.
class CodecImpl<V> implements ReadonlyCodec<V | null> {
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

  clear(properties: Record<string, string>): void {
    properties[this.property] = ''
  }
}

interface Chain<V, X> {
  readonly codec: CodecImpl<V> & X
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
export function builder<V, X extends object, N extends string>(
  property: N,
  definition: PropertyDefinition | EnumReference | undefined,
  kind: Kind<V>,
  extra: X,
  strict?: Kind<V>,
): PropertyBuilder<V | null, X, N> {
  const managed = definition?.label !== undefined
  return chain({ property, definition, kind, extra, strict }, false, managed) as PropertyBuilder<V | null, X, N>
}
