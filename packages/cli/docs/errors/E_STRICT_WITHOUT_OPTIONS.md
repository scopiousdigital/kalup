# E_STRICT_WITHOUT_OPTIONS

`.strict()` is on a `p.enum` or `p.multiEnum` that lists no options. Exit 3.

## When

A strict enum's codec throws on any value its options do not list. With no options, it would throw on every value HubSpot stores. A bare reference such as `p.enum('lifecyclestage').strict()`, or a definition without `options`, is this error.

## Fix

List the options the app handles, as an options-only reference (`p.enum(name, { options: [...] })`) or in the full definition, or drop `.strict()`: without it the codec reads an unlisted value as `Unlisted`.

## Example

```ts
stage: p.enum('lifecyclestage').strict(),
```

```
kalup/objects/companies.ts:9: E_STRICT_WITHOUT_OPTIONS: .strict() on 'lifecyclestage', which lists no options, so its codec would throw on every value (fix: list the options, or drop .strict()) (docs: errors/E_STRICT_WITHOUT_OPTIONS.md)
```
