# E_INCOMPLETE

A command could not read all it needed. Exit 1.

## When

In `pull`, a list answered 403 (`E_SCOPE`). That object was skipped: nothing on it was compared or written.

In `compare`, a side did not read an object either side names (a 403, an older snapshot, or a key `objects` lacks), or an address is unknown (a `lookup` override, or whitespace in its group name). `data` holds the comparison, with `ok: false`.

In `apply`, the write key could not read a list (403) of an object the plan changes. In `state rebuild --write` and `target rebind`, the read missed something config names, and a rebuild would drop what it could not check. Nothing was written.

It names what was not read, and is never clean: `--exit-code` in CI fails.

## Fix

Add the scopes the fix names to the key, its object key to `objects`, or rename the portal group, then read the portal again.

## Example

```
E_INCOMPLETE: pull did not read everything in scope: the properties list of harvest. Nothing there was compared or written. (fix: add the scope crm.schemas.custom.read to the key, then run npx kalup pull --target sandbox) (docs: errors/E_INCOMPLETE.md)
```
