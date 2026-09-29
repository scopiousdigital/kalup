# E_BLUEPRINT_UNKNOWN

`kalup blueprint upgrade` was given a name the lock does not hold. Exit 1. Nothing was written.

## When

Upgrade merges against the stored original of a blueprint the project added. The name must be one `kalup/blueprints.lock.json` lists; the message names them.

## Fix

Use a name the lock lists, or add the blueprint first with `kalup add <source>`.

## Example

```
E_BLUEPRINT_UNKNOWN: acme/billing is not in kalup/blueprints.lock.json, which lists acme/renewals (fix: add it first with kalup add <source>, or name a blueprint the lock lists) (docs: errors/E_BLUEPRINT_UNKNOWN.md)
```
