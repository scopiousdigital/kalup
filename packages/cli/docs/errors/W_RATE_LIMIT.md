# W_RATE_LIMIT

A warning from `pull`, `plan`, `snapshot` or `compare`: HubSpot sent no rate-limit headers. Exit stays 0.

## When

Kalup paces requests from HubSpot's rate-limit headers. Without them it sends at most 8 requests per second. A service key's answers carried them on a developer test account (2026-09-29); other account types are not confirmed. `status` reports the same thing as W_RATE_HEADERS.

## Fix

Nothing to fix. A large read takes a little longer.

## Example

```
W_RATE_LIMIT: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_LIMIT.md)
```
