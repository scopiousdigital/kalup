# E_IR_SCHEMA

The IR that `kalup ir` derived does not match the `ir/1` JSON Schema. Exit 3.

## When

`kalup ir` and `kalup ir --check` check the IR against the schema. `configPath` is a path in the IR, such as `targets.sandbox.portalId`, not a place in a file. From config files it comes with a validate issue that explains it.

## Fix

Fix the other issues first; this one goes with them. If it is the only issue left, it is a bug in Kalup: report it with the issue text.

## Example

```
kalup.config.ts:9: E_PORTAL_ID: portalId 0 is not a positive integer (fix: set portalId to the portal ID shown in HubSpot, a positive integer) (docs: errors/E_PORTAL_ID.md)
E_IR_SCHEMA: expected at least 1 (docs: errors/E_IR_SCHEMA.md)
```
