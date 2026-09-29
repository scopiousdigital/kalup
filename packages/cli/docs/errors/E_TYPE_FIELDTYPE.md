# E_TYPE_FIELDTYPE

A `fieldType` the builder does not allow. Exit 3.

## When

Each builder allows some `fieldType` values. `p.enum` takes `select`, `radio` or `booleancheckbox`, and `p.multiEnum` only `checkbox`. [config.md](../config.md#builders) has the full list.

## Fix

Use one of the values in the fix, or change the builder: a `checkbox` enumeration is `p.multiEnum`.

## Example

```ts
soil: p.enum('soil_type', { label: 'Soil type', group: 'orchard', fieldType: 'checkbox', options: [...] }),
```

```
kalup/objects/companies.ts:14: E_TYPE_FIELDTYPE: fieldType 'checkbox' is not allowed for p.enum (type enumeration) (fix: use one of 'select', 'radio', 'booleancheckbox') (docs: errors/E_TYPE_FIELDTYPE.md)
```
