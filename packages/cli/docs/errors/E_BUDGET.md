# E_BUDGET

The apply would use more than half of the API calls HubSpot reports left today. Exit 1. Nothing was written.

## When

After it reads the portal, `kalup apply` estimates its calls: the reads it made, plus three per step that writes (a read before it, the write, a read-back). When HubSpot reports a daily figure and the estimate is more than half of it, apply stops, so that other apps on the portal keep room. With no daily figure it warns `W_RATE_HEADERS` and goes on.

## Fix

Apply after the daily limit resets at midnight in the portal's time zone, or split the change into smaller plans.

## Example

```
E_BUDGET: plan pl_7f3a1c07b2e4 needs about 640 API calls, more than half of the 1100 HubSpot reports left today. Nothing was written. (fix: apply after the daily limit resets, or split the change into smaller plans) (docs: errors/E_BUDGET.md)
```
