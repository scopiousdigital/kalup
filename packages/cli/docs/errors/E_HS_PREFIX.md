# E_HS_PREFIX

A managed property's internal name starts with `hs_`. Exit 3.

## When

HubSpot uses `hs_` for its own properties. Kalup never claims that prefix for a property it would own. Whether HubSpot refuses such a create is not confirmed. A reference (no definition) may carry the prefix.

## Fix

Give the property another internal name, or drop `label`, `group` and `fieldType` so it refers to HubSpot's property.

## Example

```ts
plotCount: p.number('hs_plot_count', { label: 'Plot count', group: 'orchard', fieldType: 'number' }),
```

```
hubspot/objects/companies.ts:9: E_HS_PREFIX: 'hs_plot_count' starts with hs_, the prefix HubSpot uses for its own properties (fix: rename the property, or drop label, group and fieldType to reference it) (docs: errors/E_HS_PREFIX.md)
```
