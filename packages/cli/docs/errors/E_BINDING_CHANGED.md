# E_BINDING_CHANGED

A plan binds an address to a portal resource that kalup.config.ts or the portal does not give it now. Exit 1. Nothing was written.

## When

A plan's `bindings` say which portal resource each address stands for: a target's name override, or a custom object's type ID. `kalup apply` never trusts the file. Before approval, every step but a release must be on an object `kalup.config.ts` declares under `objects`, each name binding must be the one the target's overrides give, and no two steps but releases may resolve to one portal resource. Under the lock, each custom object's type ID must be the one the schemas list gives now: a custom object made again has a new one.

## Fix

Run `kalup plan --target <name> --out <file>` again, review it, and apply that file. Never edit a plan file by hand.

## Example

```
E_BINDING_CHANGED: plan pl_7f3a1c07b2e4 does not name what kalup.config.ts names on target sandbox: the plan binds property:companies/soil_ph to portal name plot_notes, and the name override in kalup.config.ts gives none. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it; a plan file is never edited by hand) (docs: errors/E_BINDING_CHANGED.md)
```
