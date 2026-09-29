# E_APPROVE_MISMATCH

The digest given to `--approve` is not this plan's. Exit 1. Nothing was written.

## When

`--approve <writesHash>` is for a reviewed CI job: the digest of the plan a reviewer saw. `kalup apply` recomputes the digest of the plan file it was given and refuses when the two differ. The plan changed after the review, or the digest belongs to another plan.

## Fix

Review the plan file again, and approve the digest of the plan that will run. A person can also apply it with `kalup apply <plan-file>` in a terminal.

## Example

```
E_APPROVE_MISMATCH: The digest given to --approve is not the writesHash of this plan: the plan changed after the review, or the digest belongs to another plan. Nothing was written. (fix: review this plan again; a person can apply it with kalup apply plan.json in a terminal) (docs: errors/E_APPROVE_MISMATCH.md)
```
