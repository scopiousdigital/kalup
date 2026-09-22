# E_UNKNOWN_OVERRIDE

An override key is not an address in config. Exit 3.

## When

`targets.<name>.overrides` is keyed by address: `property:<object>/<name>`, `group:<object>/<name>` or `object:<name>`. The address must exist in the config files.

## Fix

Use an address that `kalup ir` lists, or remove the override. Add the property to config first if it is missing.

## Example

```
kalup.config.ts:13: E_UNKNOWN_OVERRIDE: override 'property:companies/plot_size' is not an address in config (fix: use an address that kalup ir lists, or remove the override) (docs: errors/E_UNKNOWN_OVERRIDE.md)
```
