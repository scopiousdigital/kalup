import { builder, type EnumPropertyBuilder, type Kind, type PropertyBuilder } from './codec.js'
import type { EnumOption, EnumReference, PropertyDefinition } from './definition.js'

/** The Standard Schema interface (standard-schema.dev). Any conforming validator fits, so zod is not a dependency. */
export interface StandardSchema<Output = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>
    readonly types?: { readonly output: Output } | undefined
  }
}

export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> }

export type StandardOutput<S extends StandardSchema> = NonNullable<S['~standard']['types']>['output']

/** The app-side name of one option: `as` when set, else `value`. */
export type EnumAlias<O extends EnumOption> = O extends { as: infer A extends string } ? A : O['value']

/**
 * A stored enum value config does not list, as `get` returns it: the raw value, branded so that it never passes for a
 * listed alias. `set` writes it back unchanged.
 */
export type Unlisted = string & { readonly '~unlisted': true }

export interface EnumValues {
  /** Stored value to alias. */
  readonly enumValues: Readonly<Record<string, string>>
}

const text: Kind<string> = {
  decode: (wire) => wire,
  encode: (value) => value,
}

const numeric: Kind<number> = {
  decode(wire, property) {
    const value = Number(wire)
    if (Number.isNaN(value)) {
      throw new Error(`Property '${property}' is not a number: '${wire}'`)
    }
    return value
  },
  encode: (value) => String(value),
}

const flag: Kind<boolean> = {
  decode(wire, property) {
    if (wire === 'true') {
      return true
    }
    if (wire === 'false') {
      return false
    }
    throw new Error(`Property '${property}' is not a boolean: '${wire}'`)
  },
  encode: (value) => String(value),
}

const LIST_SEPARATOR = /[,;]/

const list: Kind<string[]> = {
  decode: (wire) => splitList(wire, LIST_SEPARATOR),
  encode: (value) => value.join(','),
}

function splitList(wire: string, separator: string | RegExp): string[] {
  return wire
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

// Maps, not records: a wire value or alias such as 'constructor' must not find an Object.prototype member. The lenient
// kinds return a value config does not list as it is stored, and write any value that is not an alias as it is; the
// strict ones throw on both.
function enumKinds(
  name: string,
  options: readonly EnumOption[],
): {
  enumValues: Record<string, string>
  lenient: { one: Kind<string>; many: Kind<string[]> }
  strict: { one: Kind<string>; many: Kind<string[]> }
} {
  const aliases = new Map<string, string>()
  const values = new Map<string, string>()
  for (const option of options) {
    const alias = option.as ?? option.value
    if (aliases.has(option.value)) {
      throw new Error(`Property '${name}': option value '${option.value}' is listed twice`)
    }
    const other = values.get(alias)
    if (other !== undefined) {
      throw new Error(`Property '${name}': options '${other}' and '${option.value}' share the alias '${alias}'`)
    }
    aliases.set(option.value, alias)
    values.set(alias, option.value)
  }
  const strict: Kind<string> = {
    decode(wire, property) {
      const alias = aliases.get(wire)
      if (alias === undefined) {
        throw new Error(`Property '${property}' has unknown value '${wire}'`)
      }
      return alias
    },
    encode(alias) {
      const value = values.get(alias)
      if (value === undefined) {
        throw new Error(`Unknown enum alias '${alias}'`)
      }
      return value
    },
  }
  const lenient: Kind<string> = {
    decode(wire, property) {
      const alias = aliases.get(wire)
      if (alias !== undefined) {
        return alias
      }
      // Returned as it is, it would read as that option's alias, and set would write the option's value.
      const option = values.get(wire)
      if (option !== undefined) {
        throw new Error(`Property '${property}' has unlisted value '${wire}', which is the alias of option '${option}'`)
      }
      return wire
    },
    encode: (value) => values.get(value) ?? value,
  }
  const many = (one: Kind<string>): Kind<string[]> => ({
    decode: (wire, property) => splitList(wire, ';').map((item) => one.decode(item, property)),
    encode: (items) => items.map(one.encode).join(';'),
  })
  // Null prototype, so enumValues[wire] is an own entry or undefined, '__proto__' included.
  const enumValues: Record<string, string> = Object.assign(Object.create(null), Object.fromEntries(aliases))
  return {
    enumValues,
    lenient: { one: lenient, many: many(lenient) },
    strict: { one: strict, many: many(strict) },
  }
}

function jsonKind<S extends StandardSchema>(schema: S): Kind<StandardOutput<S>> {
  return {
    decode(wire, property) {
      const result = schema['~standard'].validate(JSON.parse(wire))
      if (result instanceof Promise) {
        throw new Error(`Property '${property}': the schema must validate synchronously`)
      }
      if (result.issues) {
        throw new Error(`Property '${property}' failed validation: ${result.issues.map((i) => i.message).join('; ')}`)
      }
      return result.value as StandardOutput<S>
    },
    encode: (value) => JSON.stringify(value),
  }
}

export const p = {
  string(name: string, definition?: PropertyDefinition): PropertyBuilder<string | null> {
    return builder(name, definition, text, {})
  },
  number(name: string, definition?: PropertyDefinition): PropertyBuilder<number | null> {
    return builder(name, definition, numeric, {})
  },
  boolean(name: string, definition?: PropertyDefinition): PropertyBuilder<boolean | null> {
    return builder(name, definition, flag, {})
  },
  /** ISO `YYYY-MM-DD`, passed through. */
  date(name: string, definition?: PropertyDefinition): PropertyBuilder<string | null> {
    return builder(name, definition, text, {})
  },
  /** ISO 8601 UTC, passed through. */
  datetime(name: string, definition?: PropertyDefinition): PropertyBuilder<string | null> {
    return builder(name, definition, text, {})
  },
  /**
   * A stored value the options do not list reads as `Unlisted`, and `set` takes it back. `.strict()` makes both throw
   * instead, and narrows the type to the listed aliases.
   */
  enum<const O extends readonly EnumOption[] = []>(
    name: string,
    definition?: PropertyDefinition<O> | EnumReference<O>,
  ): EnumPropertyBuilder<EnumAlias<O[number]> | Unlisted | null, EnumAlias<O[number]> | null, EnumValues> {
    const { enumValues, lenient, strict } = enumKinds(name, definition?.options ?? [])
    return builder(name, definition, lenient.one, { enumValues }, strict.one) as never
  },
  /** `;`-separated on the wire. Each member is read and written as `p.enum` reads and writes one value. */
  multiEnum<const O extends readonly EnumOption[] = []>(
    name: string,
    definition?: PropertyDefinition<O> | EnumReference<O>,
  ): EnumPropertyBuilder<(EnumAlias<O[number]> | Unlisted)[] | null, EnumAlias<O[number]>[] | null, EnumValues> {
    const { enumValues, lenient, strict } = enumKinds(name, definition?.options ?? [])
    return builder(name, definition, lenient.many, { enumValues }, strict.many) as never
  },
  /** Reads split on `,` or `;`, trimmed, empties dropped. Writes `,`-joined. */
  stringArray(name: string, definition?: PropertyDefinition): PropertyBuilder<string[] | null> {
    return builder(name, definition, list, {})
  },
  /** `JSON.parse`, then the schema validates. The schema must validate synchronously. */
  json<S extends StandardSchema>(
    name: string,
    schema: S,
    definition?: PropertyDefinition,
  ): PropertyBuilder<StandardOutput<S> | null> {
    return builder(name, definition, jsonKind(schema), {})
  },
}
