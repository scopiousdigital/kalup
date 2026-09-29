# E_PLAN_DESTINATION

The plan's target is not where `kalup.config.ts` points now. Exit 1. Nothing was sent.

## When

A saved plan names its destination: a target name and a portal ID. `kalup apply` reads `kalup.config.ts` and refuses when that target is no longer declared, or when it now pins another portal. A renamed target keeps its state, but a plan saved under the old name is refused.

## Fix

Plan again against a declared target with `kalup plan --target <name> --out <file>`, review it, and apply that file. If the portal ID in config is wrong, a person corrects it first.

## Example

```
E_PLAN_DESTINATION: plan pl_7f3a1c07b2e4 is for target production on portal 2222222, and kalup.config.ts pins that target to portal 3333333. Nothing was sent. (fix: run kalup plan against a declared target with --out, review it and apply that file) (docs: errors/E_PLAN_DESTINATION.md)
```
