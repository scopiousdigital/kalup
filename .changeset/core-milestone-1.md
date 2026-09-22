---
"@kalup/core": minor
---

Milestone 1 of the runtime. Property codecs and the `p.*` builders (`string`, `number`, `boolean`, `date`, `datetime`, `enum`, `multiEnum`, `stringArray`, `json`) with `.required()`, `.readonly()` and `.managed(false)`; `defineObject`, `defineCustomObject`, `InferProperties` and `propertyNames`, so the config files type the app with no generate step. The config grammar reader and canonical writer, with `IssueError` and the file data types. The `ir/1` document, its JSON Schema, `validateIR`, `DEFAULTS`, `stableStringify` and `toCreatePayload`. The pure loader, `loadFiles` and `validate`, which turn a map of file text into an IR and report every issue with file, line and a fix. The `kalup.state/1` types and the `StateStore` interface, as types only. No runtime dependencies, no HTTP, no file system.
