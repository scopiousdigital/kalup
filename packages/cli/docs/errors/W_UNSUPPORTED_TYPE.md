# W_UNSUPPORTED_TYPE

A warning from `pull`: a portal property no builder can carry was skipped. Exit stays 0.

## When

Its HubSpot `type` has no builder (`object_coordinates`, `json`, or a type Kalup does not know), or it is a managed property whose `fieldType` its builder does not allow. A property already in the file is then kept and printed `missing in portal`.

## Fix

Nothing to fix in config. If the app needs the value, read it outside Kalup.

## Example

```
W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which no builder carries; skipped (docs: errors/W_UNSUPPORTED_TYPE.md)
```
