# E_PROTECTED_SAVED_PLAN

`kalup apply` without a plan file does not run on a protected target. Exit 1. Nothing was written.

## When

Without a file, `kalup apply` plans the target and applies that plan in one run. That is only for an unprotected target, such as a sandbox. A protected target (`protected: true`, and unless config says otherwise every account but a `DEVELOPER_TEST`, `SANDBOX` or `APP_DEVELOPER` one) accepts only a saved plan that a person reviewed.

## Fix

Run `kalup plan --target <name> --out plan.json` and review the plan. Then a person runs `kalup apply plan.json` in a terminal and confirms it.

## Example

```
E_PROTECTED_SAVED_PLAN: target production is protected, so it accepts only a saved plan that a person reviewed. Nothing was written. (fix: run kalup plan --target production --out plan.json, review it, then ask the user to run kalup apply plan.json in a terminal) (docs: errors/E_PROTECTED_SAVED_PLAN.md)
```
