# E_PROTECTED_SAVED_PLAN

`kalup apply` without a plan file on a protected target needs a person at a terminal. Exit 4, `humanRequired: true`. Nothing was written.

## When

Without a file, `kalup apply` plans the target and applies that plan in one run. On a protected target (`protected: true`, and unless config says otherwise every account but a `DEVELOPER_TEST`, `SANDBOX` or `APP_DEVELOPER` one) a person at a terminal reviews that plan there and confirms it by typing the target name, and the number of destructive steps when there are any. Here nobody can: stdin or stderr is not a terminal, `--json` is set, or `CI` is. Apply stops after the portal guard, before it plans.

## Fix

Stop. Hand the command in the fix to the user, who runs it in a terminal and confirms it there. In CI, save the plan with `kalup plan --target <name> --out` for review, and let the reviewed job apply that file. Agents never approve on the user's behalf.

## Example

```
E_PROTECTED_SAVED_PLAN: target production is protected: applying it without a plan file needs a person at a terminal to confirm the plan, and there is none here (no terminal, --json, or CI set). Nothing was written. (fix: ask the user to run kalup apply --target production in a terminal, where they confirm it; in CI, apply a plan saved with kalup plan --target production --out after review) (docs: errors/E_PROTECTED_SAVED_PLAN.md)
```
