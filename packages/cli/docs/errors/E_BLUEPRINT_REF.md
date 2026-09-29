# E_BLUEPRINT_REF

A blueprint property is in a group that neither the blueprint nor config holds. Exit 1. Nothing was written.

## When

A blueprint may put its properties in a group the project provides instead of one of its own. `kalup add` and `kalup blueprint upgrade` check that each such group is a group of the same object in config, so the written property does not name a missing group.

## Fix

Add the group to the object in config, for example `contract: { label: 'Contract' }` under `groups`, or pull it from a portal that has it, then run the command again.

## Example

```
E_BLUEPRINT_REF: property:deals/renewal_date is in group group:deals/contract, which is neither in the blueprint nor in config. Nothing was written. (fix: add contract: { label: '...' } to the groups of deals in config, then run the command again) (docs: errors/E_BLUEPRINT_REF.md)
```
