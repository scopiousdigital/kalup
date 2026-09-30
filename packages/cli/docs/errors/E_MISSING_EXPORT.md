# E_MISSING_EXPORT

A file under `hubspot/` has no `defineObject` or `defineCustomObject` export. Exit 3.

## When

Kalup reads every `.ts` file in the folder of object files (`hubspot/`, or the folder `dir` in `kalup.config.ts` names) except `index.ts` and `removed.ts` as an object file. A file with only imports, or an empty file, has nothing to read.

## Fix

Add the export, or move the file out of `hubspot/`.

## Example

```
hubspot/objects/empty.ts:1: E_MISSING_EXPORT: no defineObject or defineCustomObject export in this file (fix: add `export const <Name> = defineObject('<object>', {...})`) (docs: errors/E_MISSING_EXPORT.md)
```
