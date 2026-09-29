# E_PLAN_STALE

The portal changed after the plan was made. Exit 1 when nothing was written, 5 when earlier steps of the run wrote.

## When

Each step records what it expects to find: whether the resource exists, and the live value of every field it writes. `kalup apply` checks every step against a fresh read before the first write, and each step again right before its own write. A change made in HubSpot since the plan, such as a label edited in the UI or a property created by someone else, stops the run there. The message lists what moved.

## Fix

Run `kalup plan --target <name> --out <file>` again. The new plan compares with what the portal holds now, so an edit made in HubSpot is held instead of overwritten. Review it and apply that file.

## Example

```
E_PLAN_STALE: the portal changed since plan pl_7f3a1c07b2e4 was made: property:companies/soil_ph label. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it) (docs: errors/E_PLAN_STALE.md)
```
