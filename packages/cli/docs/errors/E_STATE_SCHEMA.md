# E_STATE_SCHEMA

A state file does not match the `kalup.state/1` JSON Schema. Exit 1.

## When

Kalup checks a state document against `state-1.schema.json` and returns this issue for each mismatch. `configPath` is a path in the state file, such as `resources.property:companies/billing_status.origin`, not a place in a config file. `kalup plan` reads it and reports a mismatch as `E_STATE_INVALID`.

## Fix

Kalup writes state that matches, so a mismatch means the file was edited by hand or damaged. Do not edit state by hand. Restore the file from where you keep it, such as the state branch of your CI setup.

## Example

```
E_STATE_SCHEMA: missing required field "portalId" (docs: errors/E_STATE_SCHEMA.md)
```
