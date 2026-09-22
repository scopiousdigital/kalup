# E_TARGET_NAME

A target is named `config`. Exit 3.

## When

`compare` will use the word `config` for the config side, so no target may take it.

## Fix

Rename the target, for example to `sandbox` or `production`.

## Example

```
kalup.config.ts:9: E_TARGET_NAME: a target may not be named 'config': compare uses that word for the config side (fix: rename the target) (docs: errors/E_TARGET_NAME.md)
```
