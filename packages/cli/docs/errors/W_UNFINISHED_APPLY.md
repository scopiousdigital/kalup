# W_UNFINISHED_APPLY

A warning from `plan`, and from `apply` without a plan file, about the last apply to this portal. Exit stays 0.

## When

State records that the last apply did not finish (the process ended while it ran, so `lastApply.outcome` is still `running`), or that it left a write whose outcome is unknown (`uncertain`). What that apply wrote may already be in HubSpot. A property or group it created appears in this plan as an adopt step, because state has no entry for it yet, and a value it wrote may appear as a held value.

Recovery is this plan: nothing is repeated blindly, and nothing is adopted without your review.

## Fix

Review the adopt steps and held values before you apply this plan. `kalup status` shows the last apply and its plan ID, and the journal under `.kalup/journal/` lists each request it sent.

## Example

```
W_UNFINISHED_APPLY: the last apply (pl_3f9a1c07b2e4, at 2026-09-24T10:15:30.000Z) did not finish; resources it may have written appear below as adopt steps or held values (fix: review those steps before you apply this plan; kalup status shows the last apply) (docs: errors/W_UNFINISHED_APPLY.md)
```
