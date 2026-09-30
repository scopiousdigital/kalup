# E_DUPLICATE_KEY

A name is used twice where it must be unique. Exit 3.

## When

The same key twice in one object literal, the same export name twice in one file, or one internal name under two keys of one export.

## Fix

Remove one of the two entries, or rename it.

## Example

```ts
properties: {
  plotCount: p.number('plot_count'),
  plotTotal: p.number('plot_count'),
},
```

```
hubspot/objects/companies.ts:9: E_DUPLICATE_KEY: internal name 'plot_count' is used by two keys of Company: 'plotCount' and 'plotTotal' (fix: remove or rename one of the two entries) (docs: errors/E_DUPLICATE_KEY.md)
```
