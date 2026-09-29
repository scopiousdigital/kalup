# E_PLAN_DIGEST

The plan file changed after `kalup plan` saved it. Exit 1. Nothing was sent.

## When

`kalup apply` recomputes `writesHash` and `planId` from what the file says it writes: the destination, the policy, the state lineage and serial, the normalizer versions, the bindings and every step with an effect. When they differ from the values in the file, someone or something edited the plan. Titles, stated risk and counts are not part of the digest, so editing them does not trigger this.

## Fix

Run `kalup plan --target <name> --out <file>` again, review the new plan, and apply that file.

## Example

```
E_PLAN_DIGEST: plan.json: writesHash and planId do not match what the plan says it writes, so it was changed after kalup plan saved it. Nothing was sent. (fix: run kalup plan --target sandbox --out plan.json again and review it) (docs: errors/E_PLAN_DIGEST.md)
```
