# E_PULL_INVALID

The files `pull` merged would not load or validate, so it wrote nothing. Exit 3, with or without `--check`.

## When

Pull merges the portal into the object files, then loads and validates the whole project as it would write it, before saving anything. The issues after this one are what `validate` would report, with the file and line in the merged text, not the file on disk.

Two examples: a property HubSpot does not define whose name starts with `hs_` (`E_HS_PREFIX`), and a new property whose key is taken twice (`E_DUPLICATE_KEY`).

## Fix

Change the portal or the file so the two agree, then pull again. To pull everything else first, leave the resource out with `--only`.

## Example

```
E_PULL_INVALID: the pulled project would not validate; nothing was written (fix: the issues that follow point at the files as pull would write them: change the portal or the file so they agree, or leave the resource out with --only) (docs: errors/E_PULL_INVALID.md)
kalup/objects/companies.ts:20: E_HS_PREFIX: 'hs_orchard_score' starts with hs_, the prefix HubSpot uses for its own properties (fix: rename the property, or drop label, group and fieldType to reference it) (docs: errors/E_HS_PREFIX.md)
```
