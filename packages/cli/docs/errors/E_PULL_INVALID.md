# E_PULL_INVALID

The files `pull` merged would not load or validate, so it wrote nothing. Exit 3, with or without `--check`.

## When

Pull merges the portal into the object files, then loads and validates the whole project as it would write it, before saving anything. The issues after this one are what `validate` would report, with the file and line in the merged text, not the file on disk.

An example: a new property whose internal name another key of the same object already uses (`E_DUPLICATE_KEY`).

## Fix

Change the portal or the file so the two agree, then pull again. To pull everything else first, leave the resource out with `--only`.

## Example

```
E_PULL_INVALID: the pulled project would not validate; nothing was written (fix: the issues that follow point at the files as pull would write them: change the portal or the file so they agree, or leave the resource out with --only) (docs: errors/E_PULL_INVALID.md)
hubspot/objects/companies.ts:20: E_DUPLICATE_KEY: internal name 'plot_count' is used by two keys of Company: 'plotCount' and 'plotTotal' (fix: remove or rename one of the two entries) (docs: errors/E_DUPLICATE_KEY.md)
```
