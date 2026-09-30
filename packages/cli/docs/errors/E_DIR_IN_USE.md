# E_DIR_IN_USE

`init` refused to run because the folder of object files holds a .ts file that is not Kalup's, or is a file. Exit 1. Nothing was written.

## When

The folder `--dir` names (`hubspot/` without it) belongs to Kalup alone: every command reads each .ts file in it as an object file, `pull` rewrites its `index.ts`, and `init` takes the folder out of the formatter's checks. A folder such as `lib/config` that already holds the app's own modules cannot be it. Object files, `removed.ts` and the `index.ts` barrel from an earlier `init` or `pull` are Kalup's, so `init` runs again after `kalup.config.ts` is removed.

## Fix

Pass `--dir` with a folder of its own, such as `lib/config/hubspot`, or move the file out of the folder.

## Example

```
lib/config/index.ts: E_DIR_IN_USE: lib/config/index.ts is not a kalup file, and lib/config/ must hold kalup's files only. Nothing was written. (fix: pass --dir with a folder of its own, such as lib/config/hubspot) (docs: errors/E_DIR_IN_USE.md)
```
