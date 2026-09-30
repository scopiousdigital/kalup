# E_RM_DEPENDENTS

`kalup rm` was asked to take out a resource that other config still uses. Exit 3. Nothing was written.

## When

A property group cannot leave config while properties in config name it as their `group`. A property cannot leave config while a custom object schema in config names it as its `primaryDisplayProperty` or in `secondaryDisplayProperties`, `requiredProperties` or `searchableProperties`. The message lists what uses it. The check is the same for `--release`.

## Fix

Move those properties to another group, or remove them first (with `kalup rm` for each), or change the schema. Then run `kalup rm` again.

## Example

```
hubspot/objects/companies.ts:6: E_RM_DEPENDENTS: group:companies/orchard cannot leave config while properties in config use it: property:companies/soil_ph. Nothing was written. (fix: remove or change those first, then run rm again) (docs: errors/E_RM_DEPENDENTS.md)
```
