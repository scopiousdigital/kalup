# W_RATE_HEADERS

A warning from `status`, `plan` or `apply` about HubSpot's rate-limit headers. Exit stays 0.

## When

From `status`: HubSpot sent no rate-limit headers, so Kalup sends at most 8 requests per second. The other commands report that as W_RATE_LIMIT.

From `plan`: HubSpot sent no daily figure, or one that is not a whole number of requests (empty, fractional, negative), so `budget.dailyRemaining` is `null` and the plan cannot weigh its calls against the daily limit. From `apply`: the same, so it cannot refuse a run that would use more than half of what is left (`E_BUDGET`).

A service key's answers carry the daily headers (live runs, 2026-09-29 and 2026-10-01), so this warning is not expected with one; the fallback stays for an answer without them.

## Fix

Nothing to fix.

## Example

```
W_RATE_HEADERS: HubSpot sent no daily rate-limit header, so the plan cannot weigh its calls against the daily limit (docs: errors/W_RATE_HEADERS.md)
```
