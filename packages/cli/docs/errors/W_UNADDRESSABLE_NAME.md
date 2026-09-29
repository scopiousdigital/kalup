# W_UNADDRESSABLE_NAME

A warning from `compare`, `plan` and `snapshot`: a portal group or property has a name no address can hold, so the read left it out. Exit stays 0, except as below.

## When

An address is `<type>:<path>` with no whitespace. HubSpot names its groups and properties without spaces, but its API does not promise it. A group whose name holds whitespace is not captured, nor is a property whose own name or group name holds it; the property is listed as out of scope.

A property config names in such a group is `unaddressable` in coverage instead: unknown, never absent, so `plan` never creates it. `compare` reports it `unknown` (`E_INCOMPLETE`, exit 1), `plan` blocks it, and the read is incomplete (`W_INCOMPLETE` in `snapshot`).

`pull` still writes such a name into config, and `validate` accepts it. `compare` and `plan` then stop with `E_UNEXPECTED`.

## Fix

Rename it in HubSpot to a name without spaces if you want Kalup to compare it. Otherwise nothing to fix.

## Example

```
W_UNADDRESSABLE_NAME: property 'a b' on companies has a name no address can hold, so it is not captured (fix: rename it in HubSpot to a name without spaces) (docs: errors/W_UNADDRESSABLE_NAME.md)
```
