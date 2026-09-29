# E_UNKNOWN_TARGET

`--target` names a target that `kalup.config.ts` does not declare. Exit 3.

## When

Commands check `--target` against the `targets` block before they send anything. An undeclared name never falls back to `defaultTarget` or to the only target. A `defaultTarget` that names no declared target is `E_DEFAULT_TARGET`.

## Fix

Use a declared name (the fix lists them), or add the target with its `portalId` and `credentials`.

## Example

```
kalup.config.ts:8: E_UNKNOWN_TARGET: target 'staging' is not declared (fix: use one of sandbox, production, or declare targets.staging) (docs: errors/E_UNKNOWN_TARGET.md)
```
