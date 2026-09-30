# E_POLICY_CHANGED

The target's policy changed after the plan was made. Exit 1. Nothing was written.

## When

A plan records the target's effective policy: `protected`, `drift`, `adopt`, `allowDestroy`, `yesLimit` and the objects whose mode is takeover, with their defaults filled in (unless config says otherwise, every account but a `DEVELOPER_TEST`, `SANDBOX` or `APP_DEVELOPER` one is protected, an unknown type included). An approval covers the plan under that policy. `kalup apply` works the policy out again from `kalup.config.ts` and the account type, and refuses when any field differs. The message names each field, before and now.

## Fix

Run `kalup plan --target <name> --out <file>` again under the policy config holds now, review it, and apply that file.

## Example

```
E_POLICY_CHANGED: the policy of target sandbox changed since plan pl_7f3a1c07b2e4: protected was false, now true. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it under the policy in kalup.config.ts) (docs: errors/E_POLICY_CHANGED.md)
```
