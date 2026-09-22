import { builder, type Kind, type PropertyBuilder } from './codec.js'
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
    if (Number.isNaN(value)) throw new Error(`Property '${property}' is not a number: '${wire}'`)
    return value
  },
  encode: (value) => String(value),
}

const flag: Kind<boolean> = {
  decode(wire, property) {
    if (wire === 'true') return true
    if (wire === 'false') return false
    throw new Error(`Property '${property}' is not a boolean: '${wire}'`)
  },
  encode: (value) => String(value),
}

const list: Kind<string[]> = {
  decode: (wire) => splitList(wire, /[,;]/),
  encode: (value) => value.join(','),
}

function splitList(wire: string, separator: string | RegExp): string[] {
  return wire
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function enumKinds(options: readonly EnumOption[]): {
  enumValues: Record<string, string>
  one: Kind<string>
  many: Kind<string[]>
} {
  const enumValues: Record<string, string> = {}
  const values: Record<string, string> = {}
  for (const option of options) {
    const alias = option.as ?? option.value
    enumValues[option.value] = alias
    values[alias] = option.value
  }
  const one: Kind<string> = {
    decode(wire, property) {
      const alias = enumValues[wire]
      if (alias === undefined) throw new Error(`Property '${property}' has unknown value '${wire}'`)
      return alias
    },
    encode(alias) {
      const value = values[alias]
      if (value === undefined) throw new Error(`Unknown enum alias '${alias}'`)
      return value
    },
  }
  const many: Kind<string[]> = {
    decode: (wire, property) => splitList(wire, ';').map((item) => one.decode(item, property)),
    encode: (aliases) => aliases.map(one.encode).join(';'),
  }
  return { enumValues, one, many }
}

function jsonKind<S extends StandardSchema>(schema: S): Kind<StandardOutput<S>> {
  return {
    decode(wire, property) {
      const result = schema['~standard'].validate(JSON.parse(wire))
      if (result instanceof Promise) throw new Error(`Property '${property}': the schema must validate synchronously`)
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
  enum<const O extends readonly EnumOption[] = []>(
    name: string,
    definition?: PropertyDefinition<O> | EnumReference<O>,
  ): PropertyBuilder<EnumAlias<O[number]> | null, EnumValues> {
    const { enumValues, one } = enumKinds(definition?.options ?? [])
    return builder(name, definition, one as Kind<EnumAlias<O[number]>>, { enumValues })
  },
  /** `;`-separated on the wire. */
  multiEnum<const O extends readonly EnumOption[] = []>(
    name: string,
    definition?: PropertyDefinition<O> | EnumReference<O>,
  ): PropertyBuilder<EnumAlias<O[number]>[] | null, EnumValues> {
    const { enumValues, many } = enumKinds(definition?.options ?? [])
    return builder(name, definition, many as Kind<EnumAlias<O[number]>[]>, { enumValues })
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
