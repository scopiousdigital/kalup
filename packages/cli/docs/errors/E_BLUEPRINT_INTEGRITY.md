# E_BLUEPRINT_INTEGRITY

A blueprint version now has other bytes than the ones Kalup recorded. Exit 1. Nothing was written.

## When

`sources` in `kalup/blueprints.lock.json` remembers the hash of every source and version ever added or upgraded to. When the same source serves the same version with a different hash, someone changed a published version in place, by mistake or on purpose. Kalup refuses to use it, and names both hashes. `kalup blueprint upgrade` refuses the same version with another hash than the lock holds, from any source.

## Fix

The same version must hold the same bytes. Ask the author why it changed, and use a new version number for new content. Do not edit the lock to make the hashes match.

## Example

```
E_BLUEPRINT_INTEGRITY: blueprints/renewals-1.0.0.json version 1.0.0 was recorded with sha256:3f1c…, and the source now serves sha256:9a0e…. Nothing was written. (fix: the same version must hold the same bytes: ask the author why it changed, and use a new version number for new content) (docs: errors/E_BLUEPRINT_INTEGRITY.md)
```
