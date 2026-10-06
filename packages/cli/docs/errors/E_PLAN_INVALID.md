# E_PLAN_INVALID

`kalup apply` could not use the plan file. Exit 1. Nothing was sent.

## When

The file named on the command line is missing, is not JSON, or does not match the `plan/1` schema. The message names the first place that fails. Apply also refuses a file whose steps contradict themselves: a change that writes a value the step's `desired` values do not hold, or a custom object archive whose `expect` does not count the properties, groups and pipelines it takes along. `kalup plan` never writes such a file.

A step of a resource type this version does not handle: a later version of Kalup made the plan. The message names the step and that version. Apply the plan with it, or a later one.

## Fix

Save the plan again with `kalup plan --target <name> --out <file>`, review it, and apply that file. Never edit a plan file by hand.

## Example

```
E_PLAN_INVALID: plan.json is not JSON. Nothing was sent. (fix: save the plan again with kalup plan --target <name> --out <file>, and apply that file) (docs: errors/E_PLAN_INVALID.md)
```
