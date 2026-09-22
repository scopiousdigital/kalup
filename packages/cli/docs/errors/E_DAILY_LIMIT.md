# E_DAILY_LIMIT

The portal has used its daily HubSpot API limit. Exit 1.

## When

HubSpot answered 429 with the `DAILY` policy. Kalup does not retry it. Other apps on the portal share the same daily limit.

## Fix

Run the command again after the time in the fix. Kalup takes it as the next midnight in the portal's time zone.

## Example

```
E_DAILY_LIMIT: The portal has used its daily API limit. (fix: Try again after 2026-09-23T22:00:00.000Z.) (docs: errors/E_DAILY_LIMIT.md)
```
