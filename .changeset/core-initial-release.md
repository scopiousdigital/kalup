---
"@kalup/core": minor
---

First release of `@kalup/core`, the runtime your app and Kalup's config files import. No runtime dependencies, no HTTP and no file system.

- `defineObject`, `defineCustomObject` and the `p.*` property builders, with `.required()`, `.readonly()` and `.managed(false)`.
- Property codecs that decode a CRM property bag into typed values and encode them back, and `InferProperties` to type the app with no generate step.
- `propertyNames` for CRM reads, and `toCreatePayload` for the exact create body.
- The config grammar reader and canonical writer, and `loadFiles` and `validate`, which turn file text into the `ir/1` document with every issue located by file and line.
- JSON Schemas and validators for the `ir/1`, `plan/1`, `kalup.state/1`, `blueprint/1` and `blueprints-lock/1` documents, exported as `@kalup/core/schemas/<file>`.
- Deterministic serialization that escapes terminal control characters.
