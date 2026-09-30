# @kalup/core

## 0.2.0

### Minor Changes

- 10f021b: Kalup 0.2: object files in a folder you choose, an offline `init`, `apply` in one step on every target, shared state, every writable property field, and monorepos.

  **Breaking changes**

  - **The object files live in `hubspot/`, not `kalup/`.** Set `dir` in `kalup.config.ts` (such as `dir: 'lib/config/hubspot'`) or pass `kalup init --dir <path>` to keep them elsewhere in the project. A 0.1 project keeps working with a warning (`W_LEGACY_DIR`) until you migrate, below. Output that names project files now says `hubspot/...`, and lists of files in `--json` output sort differently.
  - **`kalup init` is offline.** It needs no key, sends no request and no longer runs the first pull: run `kalup pull` after it. The target is named `production` unless `--target` says otherwise, `init` writes no `protected` (the account type decides), and without `--portal` the target is pending until you set `portalId`. `init --json` drops `account` and `pull` and adds `keyVariable` and `next`. `E_FIRST_PULL` is gone.
  - **`fmt --check` exits 2** when a file would change, without `--exit-code`.
  - **`apply` without a plan file works on protected targets.** At a terminal it prints the whole plan and asks for the target name. Without a terminal it stops before planning with `E_PROTECTED_SAVED_PLAN`, now exit 4 (was 1).
  - **Properties an object file defines are always in the pull scope**, whatever `custom`, `include` and `exclude` say. `pull` now refreshes them where it used to leave them as written, and the `out-of-scope` change kind is gone from `pull --json`.
  - **Pull writes more.** Owner properties come in as `p.owner`, `phone_number` properties as `p.phoneNumber`, rich text as a managed `p.string`, custom calculations as managed properties with their formula, and the new definition fields wherever the portal differs from HubSpot's default. A file that keeps `p.string` over a custom owner property gets `W_CODEC_MISMATCH`, and plan blocks it until you change the builder to `p.owner`.
  - **Schemas widen.** `ir/1`, `blueprint/1` and `binding.codec` take the new fields, types and codecs, so a document that uses them does not validate against the 0.1 schemas.
  - **Codec types take the property name.** `Codec`, `ReadonlyCodec` and the builder types have a name type parameter (default `string`), and a hand-written `Codec<T>` needs a `clear` member.

  **New**

  - **One-step apply.** `kalup apply` plans the target, prints the plan and applies it after you confirm, like `terraform apply`. Saved plans are for a review first or a CI job with `--approve`. `plan --out` with no file writes `.kalup/plans/<target>-<planId>.json`.
  - **Shared state.** `state: 'repo'` in `kalup.config.ts` keeps state in `hubspot/state/portal-<id>.json`, committed with the files, so teammates and CI read the same bases. Two branches that apply to one portal then both change the file, and Kalup does not detect a stale or wrongly merged copy. Before the first run with `'repo'`, move `.kalup/state/portal-<id>.json` to `hubspot/state/` (`W_STATE_NOT_MOVED` until you do). The default stays `'local'`: gitignored, on your machine.
  - **Every writable property field**, in HubSpot's names: `hidden`, `displayOrder`, `numberDisplayHint`, `showCurrencySymbol`, `currencyPropertyName`, `textDisplayHint`, `calculationFormula` (with `fieldType: 'calculation_equation'`) and `dataSensitivity`. New builders `p.phoneNumber` and `p.owner`, and `fieldType: 'html'` on `p.string`. `hasUniqueValue` and `dataSensitivity` are set on create only; a formula change is risky; a formula property is created after the properties it names. A field the builder rules out is `E_DEFINITION_FIELD`. Each field was checked against a live developer test account.
  - **Monorepos.** `init` edits the `.gitignore` and formatter config it finds up to the repository root, and the project name comes from `name` or the nearest `package.json`. A git worktree shares the main checkout's state only when that checkout holds the project and ignores `.kalup/`. The pull that creates a state file prints its path.
  - **Codecs for apps.** A codec's `property` is its internal name as a literal type, `PropertyName<typeof Company>` is the union of an object's names, and `codec.clear(bag)` writes `''`, HubSpot's clear. `clear` does not compile on a `.required()` codec, and `set(bag, null)` still leaves the bag alone.
  - `custom: false` no longer needs the files' own properties repeated in `include`. A file property the portal lacks is reported `missing in portal`, and `plan` creates it.
  - `W_UNSUPPORTED_TYPE` and the property form of `W_UNADDRESSABLE_NAME` only fire for properties in the scope or in the files.
  - `status` shows a pending target with `check: 'pending'`.
  - New issue codes: `W_LEGACY_DIR`, `E_DIR_AMBIGUOUS` (exit 3, both `hubspot/` and `kalup/` hold `.ts` files and `dir` is unset), `E_DIR_IN_USE` (`init` found another file in the folder), `W_STATE_NOT_MOVED`, `E_PENDING_TARGET` (exit 3), `W_PENDING_TARGET` and `E_DEFINITION_FIELD`. `E_PORTAL_ID` now only means an invalid value, and `W_LARGE_SCOPE` comes from a pull that writes more than 200 properties into a new object file.

  **Fixes**

  - A `p.boolean` create sends the options `true` and `false`, which HubSpot requires.
  - The published `kalup` and `@kalup/core` manifests no longer list `devDependencies`.

  **Upgrading a 0.1 project**

  1. Move the folder, or keep it. Either add `dir: 'kalup'` to `kalup.config.ts`, or run `git mv kalup hubspot`, then change the app's imports of `./kalup` to `./hubspot`, the formatter ignore `init` wrote (`!kalup` in `biome.json`, `kalup/` in `.prettierignore`), and, if you use blueprints, `kalup/.blueprints/` to `hubspot/.blueprints/` in `blueprints.lock.json`.
  2. Run `kalup pull` once per target. It captures the new fields and records them in state, so a field you add later plans as a change instead of a held value. Where it warns `W_CODEC_MISMATCH` on an owner property, change the builder to `p.owner`. Review and commit the file changes.
  3. In scripts: drop `--exit-code` from `fmt --check`, stop reading `account` and `pull` from `init --json`, and expect exit 4 from `E_PROTECTED_SAVED_PLAN`.

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
