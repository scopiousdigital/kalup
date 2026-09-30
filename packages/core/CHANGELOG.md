# @kalup/core

## 0.1.1

### Patch Changes

- cf48eeb: `kalup init` now adds `@kalup/core` to `dependencies` in package.json when no dependency list has it, so a project that only ran `npm install -D kalup` works after the next install. It keeps the file's indentation and key order, sorts the dependencies as npm does, and prints the install command for the package manager named by the nearest lockfile (a workspace root's counts) or else the `packageManager` field. With no package.json, init creates none and prints the command to install `@kalup/core` in your app. `init --json` reports this under `data.packageJson`.

  The docs now install `@kalup/core` as a regular dependency, since apps import it at runtime, and `kalup` as a dev dependency. `kalup` and `@kalup/core` are now released together at the same version.

## 0.1.0

### Minor Changes

- a742270: First release of `@kalup/core`, what Kalup's config files and your app import. No runtime dependencies, no HTTP and no file system.

  - `defineObject`, `defineCustomObject` and the `p.*` property builders, with `.strict()`, `.required()`, `.readonly()` and `.managed(false)`.
  - Codecs that read a CRM property bag into typed values and write them back, and `InferProperties` to type your app with no generate step.
  - Enums read a value their options do not list as `Unlisted`, and write it back unchanged. `.strict()` throws on such a value instead.
  - `propertyNames` for CRM reads.
  - `defineConfig` and `defineRemoved`, so `kalup.config.ts` and `kalup/removed.ts` get editor types, with each field's docs and default.
