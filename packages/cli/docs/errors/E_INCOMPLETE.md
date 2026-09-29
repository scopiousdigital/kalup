# E_INCOMPLETE

A command could not read all it needed. Exit 1, whatever the flags: with or without `--check`, `--exit-code` or `--discover`.

## When

In `pull`, a properties, groups or custom object schemas list answered 403 (`E_SCOPE`). The object behind it was skipped: nothing on it was compared, reported missing or written. A refused schemas list skips every custom object. The objects read in full are still merged and, without `--check`, written.

In `compare`, a side did not read an object either side names (a 403, a snapshot taken before config named it, or a key `objects` lacks), or an address is unknown (a `lookup` override, or whitespace in its group name, `W_UNADDRESSABLE_NAME`). `data` still holds the comparison, with `complete: false` and `ok: false`.

In `apply`, the write key could not read a list (403) of an object the plan changes. Apply never writes on a partial read. In `state rebuild --write` and `target rebind`, the read missed something config names: a new state file would drop every entry there, created origins and agreed values included, so nothing was written and no prompt was shown. The read-only `state rebuild` still reports.

It comes last and names what was not read. It is never clean, so a CI job running `--exit-code` fails on it.

## Fix

Add the scopes the fix names to the key in HubSpot, its object key to `objects` in `kalup.config.ts`, or rename the portal group to a name without spaces, then read the portal again (a new snapshot, when a snapshot side missed it). To leave an object out on purpose, remove its key from `objects` and its object file.

## Example

```
E_INCOMPLETE: pull did not read everything in scope: the properties list of harvest. Nothing there was compared or written. (fix: add the scope crm.schemas.custom.read to the key, then run npx kalup pull --target sandbox) (docs: errors/E_INCOMPLETE.md)
```
