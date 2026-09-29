# W_INCOMPLETE

A warning: a read of a target left something unread, so what it holds is unknown. Exit stays 0.

## When

A properties, groups or custom object schemas list answered 403 (`E_SCOPE`), so the object behind it was not read. Or a config property's portal group name holds whitespace (`W_UNADDRESSABLE_NAME`), so the read could not capture it: the snapshot lists it as `unaddressable`, with `complete: false`, and `plan` blocks its step with `W_UNADDRESSABLE_NAME` instead. `snapshot` still writes the file; its coverage marks what was not read. `docs` gives it for such a snapshot, listing it under Coverage. `plan` gives it when it could not read an object, or config has resources on a key not under `objects`, and blocks every resource there with reason `scope`: it never creates one. `compare` stops with `E_INCOMPLETE` instead.

A resource missing from an object that was not read may still exist in the portal.

## Fix

A person adds the scopes the fix names to the target's read key in HubSpot, or renames the group it names to a name without spaces, then takes a new snapshot or plans again. For an object key the fix names, add it to `objects` in `kalup.config.ts`.

## Example

```
W_INCOMPLETE: the snapshot of target sandbox is incomplete: harvest was not read, so what it holds is unknown (fix: add the scope crm.schemas.custom.read to the read key of target sandbox, then take a new snapshot) (docs: errors/W_INCOMPLETE.md)
```
