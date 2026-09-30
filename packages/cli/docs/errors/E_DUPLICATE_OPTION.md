# E_DUPLICATE_OPTION

An enum lists the same option value twice. Exit 3.

## When

Two entries in `options` of a `p.enum` or `p.multiEnum` have the same `value`, in a full definition or in an options-only reference. HubSpot stores one value per option, and the app could not tell the two apart. The app throws the same error when the builder runs.

## Fix

Remove one of the two options. To show one stored value under another name in the app, give it an `as`.

## Example

```ts
options: [
  { value: 'clay', label: 'Clay' },
  { value: 'loam', label: 'Loam' },
  { value: 'clay', label: 'Heavy clay' },
],
```

```
hubspot/objects/companies.ts:14: E_DUPLICATE_OPTION: option value 'clay' is listed twice (fix: remove one of the two options) (docs: errors/E_DUPLICATE_OPTION.md)
```
