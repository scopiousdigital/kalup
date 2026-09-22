# E_UNKNOWN_BUILDER

`p.<kind>` is not a builder. Exit 3.

## When

The builders are `p.string`, `p.number`, `p.boolean`, `p.date`, `p.datetime`, `p.enum`, `p.multiEnum`, `p.stringArray` and `p.json`. HubSpot field types such as `text` are not builders.

## Fix

Pick the builder for the HubSpot type and put the field type in `fieldType`.

## Example

```ts
plotCount: p.text('plot_count'),
```

```
kalup/objects/companies.ts:5: E_UNKNOWN_BUILDER: p.text is not a builder (fix: use one of p.string, p.number, p.boolean, p.date, p.datetime, p.enum, p.multiEnum, p.stringArray, p.json) (docs: errors/E_UNKNOWN_BUILDER.md)
```
