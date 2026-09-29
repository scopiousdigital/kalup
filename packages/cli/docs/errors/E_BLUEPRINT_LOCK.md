# E_BLUEPRINT_LOCK

`kalup/blueprints.lock.json` is not a valid lock. Exit 3.

## When

The loader reads the lock to add provenance to the resources each blueprint provides, so every command that loads the project checks it: a `lockVersion` of 1 (another one was written by another version of Kalup), JSON that matches `blueprints-lock-1.schema.json`, each stored original at the path its name and version fix, each source and version listed under `sources` with the same hash, one blueprint per local address, and each held conflict on an address the blueprint lists. `kalup add` and `kalup blueprint upgrade` write the lock; a hand edit or a bad merge breaks it.

## Fix

For another lock version, use the version of Kalup that wrote it, or a newer one. Otherwise restore the file from git, for example `git checkout -- kalup/blueprints.lock.json`. After a merge conflict, take one side whole and run `kalup blueprint upgrade` again rather than editing the JSON.

## Example

```
kalup/blueprints.lock.json: E_BLUEPRINT_LOCK: sources does not record blueprints/renewals-1.0.0.json@1.0.0 with the hash of acme/renewals (fix: restore kalup/blueprints.lock.json from git: kalup add and kalup blueprint upgrade write it, never a person) (docs: errors/E_BLUEPRINT_LOCK.md)
```
