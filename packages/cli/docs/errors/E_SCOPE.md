# E_SCOPE

HubSpot answered 403: the key lacks a scope.

## When

In `pull`, a 403 on a properties, groups or schemas list is a gap: that object is skipped, the rest continue, exit 0. In `status`, a 403 on a scope check marks the scope missing, exit 0. A 403 on account-info stops `pull` and `init`, exit 1. In `status` it marks that target failed and the other targets are still checked; the exit is 1, or 4 when another target has `E_TARGET_PORTAL_MISMATCH`.

## Fix

A person adds the scope named in the fix to the key in HubSpot. A key can only hold scopes its creator has, so a Super Admin creates it.

## Example

```
E_SCOPE: HubSpot refused GET /crm-object-schemas/2026-09/schemas (403). The key likely lacks the scope crm.schemas.custom.read. (fix: Add the scope crm.schemas.custom.read to the key.) (docs: errors/E_SCOPE.md)
```
