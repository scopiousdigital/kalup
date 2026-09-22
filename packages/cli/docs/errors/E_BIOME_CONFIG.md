# E_BIOME_CONFIG

`init` found a `biome.json` that is not valid JSON. Exit 1. Nothing was written.

## When

`init` adds `!kalup` and `!kalup.config.ts` to `files.includes` in `biome.json`, so it reads that file before it writes anything. Biome reads `biome.json` as plain JSON, so a comment in it is also this error. A `biome.jsonc` that does not parse is not an error: `init` leaves it alone and prints a note.

## Fix

Fix the JSON in `biome.json` (a trailing comma or a comment is the usual cause), then run `npx kalup init --portal <id>` again.

## Example

```
biome.json: E_BIOME_CONFIG: biome.json is not valid JSON: <parser message> (fix: fix the file, then run npx kalup init again) (docs: errors/E_BIOME_CONFIG.md)
```
