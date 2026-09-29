# E_PLAN_INVALID

`kalup apply` could not use the plan file. Exit 1. Nothing was sent.

## When

The file named on the command line is missing, is not JSON, or does not match the `plan/1` schema. The message names the first place that fails. Apply also refuses a file whose steps contradict themselves: a change that writes a value the step's `desired` values do not hold. `kalup plan` never writes such a file.

## Fix

Save the plan again with `kalup plan --target <name> --out <file>`, review it, and apply that file. Never edit a plan file by hand.

## Example

```
E_PLAN_INVALID: plan.json is not JSON. Nothing was sent. (fix: save the plan again with kalup plan --target <name> --out <file>, and apply that file) (docs: errors/E_PLAN_INVALID.md)
```
