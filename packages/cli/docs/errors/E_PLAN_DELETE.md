# E_PLAN_DELETE

A saved plan deletes something config does not ask to delete. Exit 1. Nothing was written.

## When

A delete needs a `destroy` tombstone that `kalup rm` wrote, and an address gone from config. Before approval, `kalup apply` reads `kalup/removed.ts` and the object files as data, never running them, and refuses a delete step whose address has no `destroy` tombstone, is still in config, or sets `lifecycle.preventDestroy`. It also refuses a delete of a portal resource that another address in config names through a name override on the target. The tombstone was removed after planning, the resource came back into config, or the plan file was edited.

## Fix

To delete a resource, run `kalup rm <address>`, then plan again and review the plan. A resource that sets `preventDestroy` is never deleted through Kalup.

## Example

```
E_PLAN_DELETE: plan pl_7f3a1c07b2e4 deletes what config does not ask to delete: property:companies/soil_ph is in config and sets lifecycle.preventDestroy. Nothing was written. (fix: to delete a resource, run kalup rm <address>, then kalup plan --target sandbox --out <file> and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_DELETE.md)
```
