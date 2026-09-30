# W_CODEC_MISMATCH

A warning from `pull`: the file's builder does not match the portal's property type or fieldType. Exit stays 0, except that `--check --exit-code` exits 2 on it.

## When

The file has `p.string` for a `number` in the portal, say, or `p.enum` where the portal fieldType is `checkbox`, which only `p.multiEnum` takes. Pull keeps the property as written and refreshes nothing on it, so the app's types hold and the file still validates. A fieldType no builder takes, such as `calculation_rollup`, is not a mismatch. A custom HubSpot user property in the portal is managed by `p.owner` only, so another builder over it is a mismatch.

## Fix

Change the builder to the one the message names, or keep it if the app relies on it.

## Example

```
W_CODEC_MISMATCH: property:companies/plot_count is p.string in the file but type number in the portal; the file keeps p.string and nothing is refreshed (fix: change the builder to match the portal type, or keep it if the app relies on it) (docs: errors/W_CODEC_MISMATCH.md)
W_CODEC_MISMATCH: property:companies/yield_tier is p.enum in the file, but its fieldType in the portal is checkbox, which p.enum does not take (p.multiEnum does); the file keeps p.enum and nothing is refreshed (fix: change the builder to p.multiEnum, or keep it if the app relies on it) (docs: errors/W_CODEC_MISMATCH.md)
```
