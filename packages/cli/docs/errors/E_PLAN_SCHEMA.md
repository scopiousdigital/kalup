# E_PLAN_SCHEMA

A plan does not match the `plan/1` JSON Schema. Exit 1.

## When

`kalup plan` checks the plan it built against `plan-1.schema.json` before it prints or writes it, and stops when the plan does not match. `configPath` is a path in the plan, such as `steps[2].risk`, not a place in a file. A tool that reads a plan file can check it against `plan-1.schema.json`, which the `kalup` package ships as `kalup/schemas/plan-1.schema.json`.

## Fix

A plan Kalup built always matches, so from `kalup plan` this is a bug in Kalup: report it with the command you ran and the issue text. For a plan file that was edited by hand, run `kalup plan` again instead.

## Example

```
E_PLAN_SCHEMA: expected "blocked" (docs: errors/E_PLAN_SCHEMA.md)
```
