# E_BLUEPRINT_ADDED

`kalup add` was given a blueprint the project already has. Exit 1. Nothing was written.

## When

`kalup/blueprints.lock.json` lists each blueprint once, by name. Adding it again would lose its merge base and the conflicts the lock holds, so `add` refuses and points at `kalup blueprint upgrade`, which merges the new version with what the client changed.

## Fix

Run the command in the fix, `kalup blueprint upgrade <name> <source>`, to move to the version you gave.

## Example

```
E_BLUEPRINT_ADDED: acme/renewals is already in kalup/blueprints.lock.json, at version 1.0.0. Nothing was written. (fix: to move to this version, run kalup blueprint upgrade acme/renewals blueprints/renewals-2.0.0.json) (docs: errors/E_BLUEPRINT_ADDED.md)
```
