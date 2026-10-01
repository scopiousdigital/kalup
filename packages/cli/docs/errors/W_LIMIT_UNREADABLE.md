# W_LIMIT_UNREADABLE

A warning from `plan`, and from `apply` without a plan file: the plan creates properties, and HubSpot's property limit reading could not be read, so the plan did not check them against the limit. Exit stays 0. Nothing is blocked.

## When

Before it plans a property create, `plan` reads HubSpot's Limits Tracking API for the custom property limit (W_LIMIT_HEADROOM). That read answers 403 to a key with `crm.schemas.*` scopes only, and 200 once the key holds one `crm.objects.<object>.read` scope of any object (live runs, 2026-09-29 and 2026-10-01). The message gives HubSpot's status, or the issue code for another error or a 200 without a limit and a usage (`E_HTTP`). A create past the limit then fails in `apply` instead of being blocked in the plan.

## Fix

Add a `crm.objects.<object>.read` scope to the key, such as `crm.objects.companies.read` (Development > Keys > Service keys); it also lets the key read that object's records, which Kalup never requests. One such scope, of any object, is enough for every Limits Tracking reading.

## Example

```
W_LIMIT_UNREADABLE: HubSpot's property limit reading answered 403, so the plan could not check the property limit for 2 creates (fix: add a crm.objects.<object>.read scope, such as crm.objects.companies.read, to the key) (docs: errors/W_LIMIT_UNREADABLE.md)
```
