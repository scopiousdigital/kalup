# W_LEGACY_DIR

A warning from every command that reads the project: the object files are in `kalup/`. Exit stays 0.

## When

Kalup 0.2 keeps the object files in the folder `dir` in `kalup.config.ts` names, `hubspot/` by default. When `dir` is not set, `kalup/` holds .ts files and `hubspot/` holds none, Kalup keeps reading and writing `kalup/` and warns once per command. When both hold .ts files it stops with `E_DIR_AMBIGUOUS` instead.

## Fix

Add `dir: 'kalup'` to `kalup.config.ts` to keep the folder, or move `kalup/` to `hubspot/` (`git mv kalup hubspot`) and change the imports of `./kalup` in the app. If the folder holds `blueprints.lock.json`, replace `kalup/.blueprints/` with `hubspot/.blueprints/` in it. Update the formatter ignore `init` wrote (`!kalup` in biome, `kalup/` in `.prettierignore`) to the folder you keep.

## Example

```
kalup.config.ts: W_LEGACY_DIR: the object files are in kalup/, the folder Kalup 0.1 used; the default is now hubspot/ (fix: add dir: 'kalup' to kalup.config.ts, or move kalup/ to hubspot/) (docs: errors/W_LEGACY_DIR.md)
```
