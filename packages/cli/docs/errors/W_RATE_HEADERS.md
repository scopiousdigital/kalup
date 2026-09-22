# W_RATE_HEADERS

A warning from `status`: HubSpot sent no rate-limit headers. Exit stays 0.

## When

Kalup paces requests from HubSpot's rate-limit headers. Without them it sends at most 8 requests per second. Service keys may not return the headers. `pull` reports the same thing as W_RATE_LIMIT.

## Fix

Nothing to fix.

## Example

```
W_RATE_HEADERS: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_HEADERS.md)
```
