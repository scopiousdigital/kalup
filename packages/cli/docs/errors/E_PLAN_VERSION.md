# E_PLAN_VERSION

The plan was made for another version of Kalup. Exit 1. Nothing was written.

## When

A saved plan applies only as `plan/1` and under the release line of Kalup that made it (`generator.version`): one major version from 1.0.0, one minor version before it (in 0.x any minor release may change what a field means), one exact pre-release. `kalup apply` checks this first, before the schema and any request, since a newer version's plan need not match this version's schema. After the portal guard it also refuses a step whose API row is not the one this version sends or whose pin has expired, and a plan compared under other normalizer versions. The comparison the plan was reviewed on would no longer hold.

## Fix

Plan again with the version you apply with: `kalup plan --target <name> --out <file>`, review it, and apply that file. An expired pin needs a newer release of Kalup.

## Example

```
E_PLAN_VERSION: plan.json was made by kalup 2.0.0, and this is kalup 1.4.0: a saved plan applies only under the release line that made it. Nothing was sent. (fix: plan again with this version: run kalup plan --target <name> --out <file>, review it and apply that file) (docs: errors/E_PLAN_VERSION.md)
E_PLAN_VERSION: plan pl_7f3a1c07b2e4 was made for another version of kalup: s2 uses crm.properties 2026-03, and this version sends crm.properties 2026-09. Nothing was written. (fix: run kalup plan --target sandbox --out <file> with this version and review it; an expired pin needs a newer release) (docs: errors/E_PLAN_VERSION.md)
```
