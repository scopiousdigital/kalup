# W_UNSUPPORTED_TYPE

A warning from any command that reads a portal: a property no builder can carry was skipped. Exit stays 0, except as below.

## When

Its HubSpot `type` has no builder (`object_coordinates`, `json`, or a type Kalup does not know), or it is a managed property whose `fieldType` its builder does not allow. A property already in the file is then kept as written and printed `unsupported in portal, not refreshed`, not `missing in portal`: it is there, but pull cannot compare it. When that property is in the pull scope, `pull --check --exit-code` exits 2 on it. A skipped property not in the file does not affect the exit code. `plan` blocks a managed property of such a type; `compare` compares the fields it has.

## Fix

Nothing to fix in config. If the app needs the value, read it outside Kalup. If the file holds the property, pull can never compare it: remove it from the file, which deletes nothing in the portal, or accept exit 2 from `--check --exit-code`.

## Example

```
W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which no builder carries; skipped (docs: errors/W_UNSUPPORTED_TYPE.md)
```
