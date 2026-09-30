# E_DUPLICATE_ALIAS

Two options of one enum read as the same alias in the app. Exit 3.

## When

Every option has an alias: its `as`, or its `value` when it has no `as`. Two options with the same alias would make `get` return one name for two stored values, and `set` could only write one of them. An `as` equal to another option's value counts, when that option has no `as` of its own. The app throws the same error when the builder runs.

## Fix

Give one of the two options a different `as`. Swapping names is fine: `a` read as `b` and `b` read as `a` is still one alias per value.

## Example

```ts
options: [
  { value: 'CLAY', label: 'Clay', as: 'clay' },
  { value: 'clay', label: 'Clay (old)' },
],
```

```
hubspot/objects/companies.ts:14: E_DUPLICATE_ALIAS: options 'CLAY' and 'clay' share the alias 'clay' (fix: give one of them another as; an option without as uses its value as the alias) (docs: errors/E_DUPLICATE_ALIAS.md)
```
