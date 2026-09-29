# E_PLAN_RISK

A step in the plan does not match what Kalup derives from state and the portal. Exit 1. Nothing was written.

## When

Under the portal lock, `kalup apply` reads state and the portal again and derives each step's risk, labels and blocked status as `plan` does. It refuses when a step states a lower risk than derived, leaves out a derived label (`reverts-ui-edit`), or would be blocked: an update or delete of what state does not own, an adopt of what it does, a delete the target does not allow or whose `expect` leaves out a field the base holds, a custom object schema change, or a group delete while properties still name the group. A plan `kalup plan` saved matches: the file was edited.

## Fix

Run `kalup plan --target <name> --out <file>` again and review it. Never edit a plan file by hand.

## Example

```
E_PLAN_RISK: plan pl_7f3a1c07b2e4 does not match what kalup derives from state and the portal: s1 states risk safe, and it is risky. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_RISK.md)
```
