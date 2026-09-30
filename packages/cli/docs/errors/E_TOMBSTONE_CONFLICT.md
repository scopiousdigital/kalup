# E_TOMBSTONE_CONFLICT

An address is in `hubspot/removed.ts` and still defined in config. Exit 3.

## When

A tombstone takes a resource out of config: `destroy` deletes it in the portal, `release` stops managing it and leaves it there. Config may not define the same address at the same time, not even as a reference without `label`, `group` and `fieldType`. This usually means the entry was added to `hubspot/removed.ts` by hand and the property or group was left in its object file.

## Fix

Remove the property or group from its object file. `kalup rm <address>` does both steps: it removes it from config and writes the tombstone. To keep managing the resource, remove the tombstone instead.

## Example

```
hubspot/removed.ts:4: E_TOMBSTONE_CONFLICT: property:companies/legacy_score is in hubspot/removed.ts and in config (fix: remove it from config, or run kalup rm, which does both) (docs: errors/E_TOMBSTONE_CONFLICT.md)
```
