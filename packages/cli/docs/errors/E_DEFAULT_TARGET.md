# E_DEFAULT_TARGET

`defaultTarget` in `kalup.config.ts` names a target that `targets` does not declare. Exit 3.

## When

`validate` reports it, and so does every command that loads the config, with or without `--target`, before anything is read. The name must match a key under `targets` exactly.

## Fix

Set `defaultTarget` to a declared name (the fix lists them), declare the target, or remove `defaultTarget`. A project with one target needs no default.

## Example

```
kalup.config.ts:5: E_DEFAULT_TARGET: defaultTarget 'staging' is not a declared target (fix: use one of sandbox, production, or remove defaultTarget) (docs: errors/E_DEFAULT_TARGET.md)
```
