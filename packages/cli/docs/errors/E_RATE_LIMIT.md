# E_RATE_LIMIT

HubSpot kept answering 429 after three retries. Exit 1, or 5 when `kalup apply` had already written.

## When

Kalup honours `Retry-After` up to 60 seconds, else backs off, and retries three times. `kalup apply` waits out a 429, 423 or 477 on a write three times, reading the resource again before each new attempt, then stops the run with that step not run.

## Fix

Wait a minute and run the command again.

## Example

```
E_RATE_LIMIT: HubSpot rate limit hit and 3 retries did not clear it. (docs: errors/E_RATE_LIMIT.md)
```
