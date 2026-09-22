# E_REFERENCE_DEFINITION

A property is neither managed nor a valid reference. Exit 3.

## When

A property is one of three things: a full definition with `label`, `group` and `fieldType`; `p.enum` or `p.multiEnum` with `options` only; or no definition. A definition missing one of the three fields, options only on another builder, or `.managed(false)` on a property with no full definition is this error.

## Fix

Add the missing fields, or drop the definition to reference the portal's property.

## Example

```ts
plotTotal: p.number('plot_total', { label: 'Plot total' }),
```

```
kalup/objects/companies.ts:23: E_REFERENCE_DEFINITION: a definition needs label, group and fieldType (fix: add the missing fields, or drop the definition) (docs: errors/E_REFERENCE_DEFINITION.md)
```
