# E_PREVENT_DESTROY

`kalup rm` was asked to write a destroy tombstone for a resource that sets `lifecycle.preventDestroy`. Exit 3. Nothing was written.

## When

`preventDestroy: true` in a property's `lifecycle` says the property must never be deleted through Kalup. `kalup rm <address>` writes a `destroy` tombstone, which a later plan turns into a delete, so rm refuses it before it changes any file. A custom object's archive takes every group, property and pipeline on it along, so `kalup rm object:<name>` refuses while any of them sets `preventDestroy`, and names them.

## Fix

To delete it after all, remove `preventDestroy` from its lifecycle first, then run `kalup rm` again. To stop managing it and leave it in HubSpot, run `kalup rm <address> --release`, which preventDestroy allows.

## Example

```
hubspot/objects/companies.ts:14: E_PREVENT_DESTROY: property:companies/soil_ph sets lifecycle.preventDestroy, so rm does not write a destroy tombstone for it. Nothing was written. (fix: remove preventDestroy from its lifecycle first, or run kalup rm property:companies/soil_ph --release to stop managing it and leave it in HubSpot) (docs: errors/E_PREVENT_DESTROY.md)
```
