# E_ACCEPT_UNMATCHED

A `pull --accept` selector matches nothing pull keeps. Exit 1. Nothing was written.

## When

Where state owns a resource, pull keeps the file's value for a unit config changed, for a conflict, for an option config added, and for an option HubSpot removed that config still holds. `--accept <address[#unit]>` takes the portal's side of those units. A selector that matches none of them (a unit that agrees, one pull takes from the portal anyway, a typo) is refused. The message lists what pull keeps there; warnings such as `E_INCOMPLETE` follow.

## Fix

Run `kalup pull --target <name> --check`, pick a unit it lists as a config change kept, a conflict or removed in HubSpot, and pass that. A selector without `#unit` takes every such unit on the address, and `*` in the address works as in `--only`.

## Example

```
E_ACCEPT_UNMATCHED: --accept property:companies/soil_ph#description matches no config change, conflict or option removed in HubSpot; pull keeps: property:companies/soil_ph#label (conflict, config kept). Nothing was written. (fix: accept a unit that kalup pull --target sandbox --check lists as kept, a conflict or removed in HubSpot, or leave the selector out) (docs: errors/E_ACCEPT_UNMATCHED.md)
```
