# E_UNSUPPORTED_FILE

A file under `kalup/` that this version does not read. Exit 3.

## When

Anything under `kalup/pipelines/`, a `defineConfig` file under `kalup/`, and a `defineRemoved` file anywhere under `kalup/` except `kalup/removed.ts`. Kalup reports them instead of skipping them silently.

## Fix

Move the file out of `kalup/` until a release reads it. A `defineConfig` file belongs at the project root as `kalup.config.ts`, and tombstones belong in `kalup/removed.ts`.

## Example

```
kalup/pipelines/deals.ts:1: E_UNSUPPORTED_FILE: this version does not read pipelines yet (fix: move kalup/pipelines/deals.ts out of kalup/ until a release reads it) (docs: errors/E_UNSUPPORTED_FILE.md)
```
