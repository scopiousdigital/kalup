# E_BLUEPRINT_ORIGINAL

The stored original of a blueprint is missing or was changed. Exit 1. Nothing was written.

## When

`kalup blueprint upgrade` merges three ways, with the version the project last added or upgraded to as the base. Kalup keeps that version's bytes under `kalup/.blueprints/` and checks them against the hash in `kalup/blueprints.lock.json`. A deleted file, an edit, a reformat by another tool, a bad merge or git converting line endings (`core.autocrlf`) breaks the base, and a merge against it would misreport what the client changed.

## Fix

Restore the file from git, for example `git checkout -- kalup/.blueprints/acme--renewals@1.0.0.json`, then run the upgrade again. Another blueprint version needs the Kalup that wrote it, or newer. Keep `kalup/.blueprints/` out of formatters and commit it with the lock. `kalup add` writes `kalup/.blueprints/** -text` to `.gitattributes` so git keeps the bytes; if that line is missing, add it back, commit, and check the file out again.

## Example

```
E_BLUEPRINT_ORIGINAL: the stored original of acme/renewals 1.0.0, kalup/.blueprints/acme--renewals@1.0.0.json, does not match the hash in kalup/blueprints.lock.json; upgrade merges against it. Nothing was written. (fix: restore it from git, for example git checkout -- kalup/.blueprints/acme--renewals@1.0.0.json, then run kalup blueprint upgrade again) (docs: errors/E_BLUEPRINT_ORIGINAL.md)
```
