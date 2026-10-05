# E_UNSUPPORTED_FILE

A file under `hubspot/` that this version does not read. Exit 3.

## When

A `definePipeline` file outside `hubspot/pipelines/`, a `defineConfig` file under `hubspot/`, and a `defineRemoved` file anywhere under `hubspot/` except `hubspot/removed.ts`. With `dir` set in `kalup.config.ts`, the same paths under that folder. Kalup reports them instead of skipping them silently.

## Fix

Move pipelines to `hubspot/pipelines/<object>.ts`, such as `hubspot/pipelines/deals.ts`. A `defineConfig` file belongs at the project root as `kalup.config.ts`, and tombstones belong in `hubspot/removed.ts`.

## Example

```
hubspot/deals.ts:1: E_UNSUPPORTED_FILE: a definePipeline file belongs under hubspot/pipelines/ (fix: move it to hubspot/pipelines/) (docs: errors/E_UNSUPPORTED_FILE.md)
```
