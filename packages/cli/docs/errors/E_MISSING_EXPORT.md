# E_MISSING_EXPORT

A file under `kalup/` has no `defineObject` or `defineCustomObject` export. Exit 3.

## When

Kalup reads every `.ts` file under `kalup/` except `kalup/index.ts` as an object file. A file with only imports, or an empty file, has nothing to read.

## Fix

Add the export, or move the file out of `kalup/`.

## Example

```
kalup/objects/empty.ts:1: E_MISSING_EXPORT: no defineObject or defineCustomObject export in this file (fix: add `export const <Name> = defineObject('<object>', {...})`) (docs: errors/E_MISSING_EXPORT.md)
```
