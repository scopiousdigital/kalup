# W_PREFIX

A warning from validate: a managed property's internal name lacks the project `prefix`. Exit stays 0.

## When

`prefix` in `kalup.config.ts` is set, and a property Kalup would own does not start with it. References are not checked.

## Fix

Rename the property to carry the prefix, or clear `prefix`. A property already in HubSpot keeps its internal name; renaming means a new property.

## Example

```
hubspot/objects/companies.ts:14: W_PREFIX: 'soil_type' does not carry the project prefix 'orch_' (fix: rename it to orch_soil_type, or clear prefix in kalup.config.ts) (docs: errors/W_PREFIX.md)
```
