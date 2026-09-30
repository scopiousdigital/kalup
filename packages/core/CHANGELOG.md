# @kalup/core

## 0.1.0

### Minor Changes

- a742270: First release of `@kalup/core`, what Kalup's config files and your app import. No runtime dependencies, no HTTP and no file system.

  - `defineObject`, `defineCustomObject` and the `p.*` property builders, with `.strict()`, `.required()`, `.readonly()` and `.managed(false)`.
  - Codecs that read a CRM property bag into typed values and write them back, and `InferProperties` to type your app with no generate step.
  - Enums read a value their options do not list as `Unlisted`, and write it back unchanged. `.strict()` throws on such a value instead.
  - `propertyNames` for CRM reads.
  - `defineConfig` and `defineRemoved`, so `kalup.config.ts` and `kalup/removed.ts` get editor types, with each field's docs and default.
