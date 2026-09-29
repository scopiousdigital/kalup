---
"@kalup/core": minor
---

First release of `@kalup/core`, the runtime your app and Kalup's config files import. No runtime dependencies, no HTTP and no file system.

- `defineObject`, `defineCustomObject` and the `p.*` property builders, with `.required()`, `.readonly()` and `.managed(false)`.
- Property codecs that decode a CRM property bag into typed values and encode them back, and `InferProperties` to type the app with no generate step.
- `propertyNames` for CRM reads.
- `defineConfig` and `defineRemoved` with their types, so `kalup.config.ts` and `kalup/removed.ts` get editor types. Every field is documented with its default.
