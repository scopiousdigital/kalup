# E_SCOPE

HubSpot answered 403: the key lacks a scope.

## When

A 403 on a properties, groups or schemas list is a gap: the objects behind it are not read and the rest continue. `pull` and `compare` then end with `E_INCOMPLETE`, exit 1. `plan` blocks what is on them and `snapshot` marks them unread, both with `W_INCOMPLETE` and exit 0. The archived properties lists `plan` reads for its creates are no gap: a 403 there stops `plan`, exit 1. In `status`, a 403 on a scope check marks the scope missing, exit 0. A 403 on account-info stops the command, exit 1; `status` marks that target failed and checks the others. A refused Limits Tracking reading is no error: `plan` records it as unreadable, and warns with `W_LIMIT_UNREADABLE` when it creates properties.

## Fix

A person adds the scope named in the fix to the key in HubSpot. A key can only hold scopes its creator has, so a Super Admin creates it.

## Example

```
E_SCOPE: HubSpot refused GET /crm-object-schemas/2026-09/schemas (403). The key likely lacks the scope crm.schemas.custom.read. (fix: Add the scope crm.schemas.custom.read to the key.) (docs: errors/E_SCOPE.md)
```
