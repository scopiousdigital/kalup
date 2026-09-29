# E_CONFIG_EXISTS

`init` refused to run because `kalup.config.ts` already exists in the working directory. Exit 1. Nothing was written.

## When

`init` runs once per project. It never overwrites a config.

## Fix

To refresh the files from the portal, run `npx --no-install kalup pull --target <name>`. To start over, remove `kalup.config.ts` first.

## Example

```
kalup.config.ts: E_CONFIG_EXISTS: kalup.config.ts already exists in /work/orchard-crm (fix: this is a kalup project already: run npx kalup pull --target <name>, or remove the file to start over) (docs: errors/E_CONFIG_EXISTS.md)
```
