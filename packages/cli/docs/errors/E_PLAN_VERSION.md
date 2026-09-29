# E_PLAN_VERSION

The plan was made for another version of Kalup. Exit 1. Nothing was written.

## When

A saved plan applies only as `plan/1` and under the release line of Kalup that made it (`generator.version`): one major version from 1.0.0, one minor version before it, one exact pre-release. `kalup apply` checks this first, before the schema and any request. After the portal guard it also refuses a step whose API row is not the one this version sends or whose pin has expired, and a plan compared under other normalizer versions. The comparison the plan was reviewed on would no longer hold.

## Fix

Plan again with the version you apply with: `kalup plan --target <name> --out <file>`, review it, and apply that file. An expired pin needs a newer release of Kalup.

## Example

```
E_PLAN_VERSION: plan.json was made by kalup 2.0.0, and this is kalup 1.4.0: a saved plan applies only under the release line that made it. Nothing was sent. (fix: plan again with this version: run kalup plan --target <name> --out <file>, review it and apply that file) (docs: errors/E_PLAN_VERSION.md)
```
