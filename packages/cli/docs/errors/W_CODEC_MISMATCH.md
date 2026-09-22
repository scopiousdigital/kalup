# W_CODEC_MISMATCH

A warning from `pull`: the file's builder does not match the portal's property type. Exit stays 0.

## When

The file has, say, `p.string` for a property that is a `number` in the portal. Pull keeps the property exactly as written and refreshes nothing on it, so the app's types do not change under it.

## Fix

Change the builder to match the portal type, or keep it if the app relies on it.

## Example

```
W_CODEC_MISMATCH: property:companies/plot_count is p.string in the file but type number in the portal; the file keeps p.string and nothing is refreshed (fix: change the builder to match the portal type, or keep it if the app relies on it) (docs: errors/W_CODEC_MISMATCH.md)
```
