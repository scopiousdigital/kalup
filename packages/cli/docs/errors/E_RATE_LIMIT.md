# E_RATE_LIMIT

HubSpot kept answering 429 after three retries. Exit 1.

## When

Kalup honours `Retry-After`, else backs off, and retries three times.

## Fix

Wait a minute and run the command again.

## Example

```
E_RATE_LIMIT: HubSpot rate limit hit and 3 retries did not clear it. (docs: errors/E_RATE_LIMIT.md)
```
