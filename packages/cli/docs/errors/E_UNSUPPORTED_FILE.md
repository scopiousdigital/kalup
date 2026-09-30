# E_UNSUPPORTED_FILE

A file under `hubspot/` that this version does not read. Exit 3.

## When

Anything under `hubspot/pipelines/`, a `defineConfig` file under `hubspot/`, and a `defineRemoved` file anywhere under `hubspot/` except `hubspot/removed.ts`. With `dir` set in `kalup.config.ts`, the same paths under that folder. Kalup reports them instead of skipping them silently.

## Fix

Move the file out of `hubspot/` until a release reads it. A `defineConfig` file belongs at the project root as `kalup.config.ts`, and tombstones belong in `hubspot/removed.ts`.

## Example

```
hubspot/pipelines/deals.ts:1: E_UNSUPPORTED_FILE: this version does not read pipelines yet (fix: move hubspot/pipelines/deals.ts out of hubspot/ until a release reads it) (docs: errors/E_UNSUPPORTED_FILE.md)
```
