# E_HS_PREFIX

A managed property's internal name starts with `hs_` or `a<digits>_`. Exit 3.

## When

HubSpot reserves `hs_` for its own properties and `a<appId>_` for an integration's, and refuses a create with either (400, live runs 2026-10-01). Kalup never claims those prefixes for a property it would own; `pull` writes such a property as a reference. A reference (no definition) may carry the prefix.

## Fix

Give the property another internal name, or drop `label`, `group` and `fieldType` so it refers to HubSpot's property.

## Example

```ts
plotCount: p.number('hs_plot_count', { label: 'Plot count', group: 'orchard', fieldType: 'number' }),
```

```
hubspot/objects/companies.ts:9: E_HS_PREFIX: 'hs_plot_count' starts with hs_, a prefix HubSpot reserves (hs_ for its own properties, a<digits>_ for an integration's) (fix: rename the property, or drop label, group and fieldType to reference it) (docs: errors/E_HS_PREFIX.md)
```
