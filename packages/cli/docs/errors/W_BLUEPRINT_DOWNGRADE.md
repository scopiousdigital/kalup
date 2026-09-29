# W_BLUEPRINT_DOWNGRADE

A warning from `kalup blueprint upgrade`: the new version is lower than the one the lock holds. Exit stays 0.

## When

Versions compare as semantic versions, a pre-release below its release. Moving to a lower version is allowed, for example to back out a release, and merges like any other: config's own changes stay, and resources the lower version lacks are detached, not deleted.

## Fix

Check that the lower version is the one you meant. If not, run the upgrade again with the version you want.

## Example

```
W_BLUEPRINT_DOWNGRADE: acme/renewals goes from 2.0.0 down to 1.0.0 (fix: check that the lower version is the one you meant; the merge treats it like any other version) (docs: errors/W_BLUEPRINT_DOWNGRADE.md)
```
