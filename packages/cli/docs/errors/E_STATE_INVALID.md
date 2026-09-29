# E_STATE_INVALID

A state file cannot be used. Exit 1. Nothing was written.

## When

State lives in `.kalup/state/portal-<portalId>.json`, one file per portal. Kalup reads it before it plans or writes against that portal, and stops when the file cannot be read, is not JSON, names a format other than `kalup.state/1`, does not match that schema, or describes another portal than the one the key belongs to. The message says what is wrong.

## Fix

When the file cannot be read, fix its permissions. Another format means another version of Kalup wrote it: use that version or a newer one, and keep the file. Otherwise the file was edited, damaged or overwritten; never edit state by hand. The `.bak` beside it holds the state before its last save: rename it into place if it reads, knowing it lacks that save. Else move the file away and run `kalup state rebuild --target <name>`, or restore it from a CI state branch.

## Example

```
.kalup/state/portal-2222222.json: E_STATE_INVALID: .kalup/state/portal-2222222.json is not JSON. (fix: rename portal-2222222.json.bak, the state before its last save, into its place if it reads; else move the file away and run kalup state rebuild --target production) (docs: errors/E_STATE_INVALID.md)
```
