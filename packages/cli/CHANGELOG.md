# kalup

## 0.5.0

### Minor Changes

- 83fa339: Association labels. Kalup now reads, plans and writes association labels, and the plain association between a custom object and another object, from one new file, `hubspot/associations.ts`.
  
  - `defineAssociations` from `@kalup/core` holds one entry per association: `from` and `to` (object keys under `objects`), `name` (HubSpot's internal name, which is the address, `association:<from>/<to>/<name>`), and optional `label` and `inverseLabel`. Left out, `inverseLabel` is the label, as HubSpot shows it on both sides. An entry with no `label` is the pair's plain association. `AssociationName<typeof Associations>` types the names in your app, and the barrel re-exports `Associations`.
  - New in `kalup.config.ts`: `associations: true` on an object pulls every association between it and the other objects under `objects`. It defaults to `false`, so an existing project does not grow a new file on its next pull; pull refreshes the associations the file defines either way. `kalup init` now writes `associations: true` on every object it writes, and `pull --discover` lists the associations pull does not write.
  - Validate refuses an object not under `objects`, a pair of one object with itself, an empty label, a plain association between two standard objects (HubSpot defines it), two plain associations of one pair (`E_ASSOCIATION_FIELD`), a name or object holding whitespace or a slash (`E_ASSOCIATION_NAME`), a name used twice (`E_DUPLICATE_KEY`), and two labels a pair shows from one side (`E_DUPLICATE_LABEL`), including on a target whose overrides would make them clash. A target's `definition` override may change a label's `label` and `inverseLabel`.
  - Plan and apply: a create sends the name and both labels, a plain association first on its pair; an update sends both labels, since HubSpot puts the label on both sides otherwise; a delete is destructive and permanent, and a plain association delete waits until the labels of its pair are gone, as HubSpot refuses it before. A label created on a pair with a custom object and no plain association makes one too, under a name HubSpot picks, and the plan says so. Plan warns `W_LIMIT_HEADROOM` when label creates would pass HubSpot's cap of 50 per pair, and HubSpot's refusal of the 51st (HTTP 437) is reported with its fix. Takeover never deletes an association. Association limits are not managed yet, and plans say so.
  - HubSpot's schema read lists a new label's name only minutes after the create, so state records each association's two type IDs, and every read names the label by them meanwhile. A type no name reaches is unknown, never absent: plan creates, releases or deletes nothing on its pair until HubSpot names it, and says to plan again in a few minutes.
  - An association's identity is its name: an entry rewritten from the other side is the same association, and state follows it. A plain association that gains a label, or a label that loses it, is blocked, as is a create HubSpot would refuse: a label the pair shows already, a second plain association, or a label that fits HubSpot's cap only once a delete in the same plan has run.
  - `kalup rm association:<from>/<to>/<name>` removes the entry and writes its tombstone; `kalup rm object:<name>` also removes the associations on either side of the object, and its tombstone covers them.
  - `kalup docs` lists each object's associations, and `status` and `snapshot` count them.
  
  Document formats changed in place in this release: a `kalup.state/1` resource entry may hold `typeIds`, an association's two type IDs. In `ir/1`, association resources are described (`label`, `inverseLabel`), a snapshot's `coverage.notCaptured` gained `association`, and `coverage.objects.<object>` gained `associations`: `with`, per paired object, its `status`, `missingScope`, `issue` and `unnamed` (each `typeId` and `label`), and `typeIds`. A `plan/1` document's `normVersions` gains `association`, and `preflight.limits` may hold `association-labels` readings, one per direction of a pair as `association-labels/<from>/<to>`. In `--json` output, `status` and `snapshot` `counts` gained `associations`, and `pull --discover` gained `associations`. As after any minor release, plan again before applying a plan saved with an earlier one.
- effce28: Custom object schema writes. Kalup now creates, updates and archives custom objects defined with `defineCustomObject`, which until now it only read and compared.
  
  - `defineCustomObject` takes an optional `description`, and pull writes HubSpot's description there.
  - `kalup pull` no longer stops with `E_UNKNOWN_OBJECT` for a custom object your files define and the portal lacks: it reports it `missing in portal`, keeps its file, and pulls the rest. `E_UNKNOWN_OBJECT` is now only for a key under `objects` that is neither a standard object, nor defined in your files, nor in the portal. Pull also leaves out a custom object `hubspot/removed.ts` names.
  - A new custom object is one plan step. Apply creates it with its name, labels and description, then its groups and properties, then sets its display, required and searchable properties, since HubSpot refuses those fields until the properties they name exist. A new custom object gets HubSpot's default properties, the group `<name>_information` and associations with activities. When the object file lists `<name>_information`, as pull writes it once a property sits in it, apply gives HubSpot's group config's label instead of creating it, and records it adopted, since HubSpot made it. A create HubSpot answers with an object another writer made under the same name is `uncertain`, and nothing is written onto that object.
  - An update sends the whole schema in one request: HubSpot can set fields left out of a partial update back to older values.
  - A field your files changed while Kalup could not write custom objects now shows in the next plan as an update.
  - `kalup rm object:<name>` takes the object out of config with everything on it, its pipelines included, and writes one tombstone; it refuses a destroy while anything on the object sets `preventDestroy` (`E_PREVENT_DESTROY`). Its delete archives the object in HubSpot, needs `allowDestroy` and a person at a terminal like every delete, and is refused by HubSpot while the object holds records. The plan and the confirmation say how many of the object's properties, groups and pipelines go with it, and apply stops before any write when its own read finds more. Plan blocks the archive when the key cannot read the object's pipelines, since it cannot count them. Kalup never purges an archived object, and takeover never archives one.
  - Validate refuses a custom object tombstone while config still holds anything on the object (`E_TOMBSTONE_CONFLICT`), and apply refuses that archive too (`E_PLAN_DELETE`).
  - Plan blocks a create whose name HubSpot holds archived (the create would purge the archived object and its records) or holds in another case, and a display field naming a property HubSpot will not hold or whose create the plan itself blocks.
  - Fixed: apply ran a pipeline or stage delete that a hand-edited plan labelled `takeover`, including one state did not own. A delete labelled `takeover` now meets takeover's rules whatever `hubspot/removed.ts` says, so it is never a custom object, a pipeline or a stage.
  - New warnings: `W_OBJECT_FIELD` for a name or label HubSpot refuses, or more than two secondary display properties (plan blocks a write that would send one), and `W_OBJECT_PROPERTY` for a display, required or searchable field naming a property the object file does not list.
  
  Document formats changed in place in this release: the `ir/1` definition of a custom object, and `coverage.objects.<object>.unsupportedSchema` in a snapshot, gained `description`. A `plan/1` custom object delete step carries `expect.values.takes` (`properties`, `groups`, `pipelines`, all three required), what the archive takes along. In `kalup apply --json`, a custom object create's step report may carry a new field, `display` (`outcome`, and `units`, `issue` when present): how the update apply derives to set its display fields once its properties exist went. As after any minor release, plan again before applying a plan saved with an earlier one.

### Patch Changes

- Updated dependencies [83fa339]
- Updated dependencies [effce28]
  - @kalup/core@0.5.0

## 0.4.0

### Minor Changes

- 497cb9f: Pipelines and stages. Kalup now reads, plans and writes the pipelines and stages of deals, tickets and custom objects, kept in `hubspot/pipelines/<object>.ts` with `definePipeline` from `@kalup/core`. Each stage carries its ID and the metadata of its object: `probability` on deals, `ticketState` on tickets, `state` on custom objects. The pipelines of other objects, such as the contacts and companies lifecycle pipelines, are read and compared, never written.
  
  - Pull refreshes the pipelines your files define. Set `pipelines: true` on an object to pull all of its pipelines; `kalup init` sets it for deals and tickets, and `pull --discover` lists the rest. An existing project pulls no new pipelines until you set it.
  - Plan and apply work as for properties: a stage relabelled in HubSpot is held, not reverted. A new pipeline is created with its stages in one request. A stage order change moves stages one request at a time, because HubSpot renumbers a pipeline when a stage lands on a taken position. A change of probability or closed state is risky.
  - `kalup rm` takes a pipeline or stage out of config. Its delete is permanent, since HubSpot keeps no archive, and needs `allowDestroy` and a person at a terminal like every delete.
  - New issue codes: `E_PIPELINE_FIELD`, `E_PIPELINE_ID`, `E_PIPELINE_STAGES` and `E_DUPLICATE_LABEL`. `E_UNSUPPORTED_FILE` no longer covers `hubspot/pipelines/`; it now refuses a `definePipeline` export outside that folder.
  - `snapshot` and `status` count pipelines and stages, and `pull --discover` returns `pipelines` in its JSON data.
  
  Document formats gained fields in this release, additively: `plan/1` steps may carry `stages` (the stages a pipeline create carries) and `stageLabels` (display only: the label of each stage a stage order names, so the plan text shows labels), and the `ir/1` coverage block gained `objects.<object>.pipelines` and `notCaptured.pipeline` and `notCaptured.stage`, alongside the new `pipeline` and `stage` resource types. As after any minor release, plan again before applying a plan saved with an earlier one.

### Patch Changes

- Updated dependencies [497cb9f]
  - @kalup/core@0.4.0

## 0.3.0

### Minor Changes

- 56ab7d4: Live runs against HubSpot on 2026-10-01 settled the behaviours Kalup had treated as unverified. What changes:
  
  - `kalup status` reads the scopes a service key holds through HubSpot's token introspection and checks the recommended scope and, when apply writes with the same key, each write scope by name. A missing write scope is `W_WRITE_SCOPE`. The list probes stay. The JSON gains `keyScopes` on each target. The key goes in that one request's body, as HubSpot requires, to the host the Authorization header already reaches; nothing logs or journals request bodies.
  - `kalup apply` names each workflow, list, form or calculation property that keeps a property from being archived, from HubSpot's refusal. A sensitive property create refused for a missing scope names `crm.objects.<object>.sensitive.write` (or `highly_sensitive.write`), and one refused because the portal has sensitive data turned off names the setting.
  - `kalup plan` blocks turning `showCurrencySymbol` off once the property ever had a `currencyPropertyName`, an empty one included: HubSpot never allows it again, and the property has to be recreated. `validate` refuses `currencyPropertyName: ''`, which HubSpot stores as a value. A project that states `''` today exits 3 until the field is removed.
  - Group deletes no longer wait on archived properties. HubSpot archives a group whose properties are all archived, and an archived group never comes back, so plan and apply block a group delete only while an active property names it, and no longer read the archived lists for one.
  - `a<appId>_` names are reserved like `hs_`: HubSpot refuses a create with either prefix, so `E_HS_PREFIX` covers both. `kalup pull` writes a property under either prefix as a reference instead of failing with `E_PULL_INVALID`. A project that pulled an `hs_` property Kalup does not define as a managed property sees pull rewrite it as a reference on the next run.

### Patch Changes

- @kalup/core@0.3.0

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

### Patch Changes

- Updated dependencies [10f021b]
  - @kalup/core@0.2.0

## 0.1.1

### Patch Changes

- cf48eeb: `kalup init` now adds `@kalup/core` to `dependencies` in package.json when no dependency list has it, so a project that only ran `npm install -D kalup` works after the next install. It keeps the file's indentation and key order, sorts the dependencies as npm does, and prints the install command for the package manager named by the nearest lockfile (a workspace root's counts) or else the `packageManager` field. With no package.json, init creates none and prints the command to install `@kalup/core` in your app. `init --json` reports this under `data.packageJson`.

  The docs now install `@kalup/core` as a regular dependency, since apps import it at runtime, and `kalup` as a dev dependency. `kalup` and `@kalup/core` are now released together at the same version.

- Updated dependencies [cf48eeb]
  - @kalup/core@0.1.1

## 0.1.0

### Minor Changes

- 114e090: First release of the Kalup CLI: configuration as code for HubSpot properties and property groups, on standard and custom objects. Custom object schemas are read and compared, not written.

  - `init` and `pull` read a portal into TypeScript files under `kalup/`. The files are parsed, never executed, and a pull keeps your keys, aliases, comments and chained calls. Properties Kalup does not write, such as owner and rich text properties, come back as read-only references.
  - `plan` shows every change to a target, with the values it writes and the settings that decide each step. An edit made in the HubSpot UI is held, not reverted, with the command for each side. `plan --exit-code` exits 2 while anything is pending.
  - `apply` writes property and group changes after one approval: a person at a terminal, `--yes` for a small safe change on an unprotected target, or `--approve` from a reviewed CI job. Each write is checked against a fresh read and read back. Deletes need a tombstone from `kalup rm`, `allowDestroy: true` and a person at a terminal.
  - `mode: 'takeover'` makes config the whole truth for an object on a target: plan archives the custom properties and groups config lacks, and never without `allowDestroy` and a person at a terminal. `exclude` keeps named properties, such as an integration's, out of scope.
  - `adopt: 'overwrite'` writes config over a portal's differing values on first adoption, and `yesLimit` sets how much one `--yes` covers.
  - `compare`, `snapshot` and `docs` compare config, portals and saved reads, and write a Markdown data dictionary.
  - `add` and `blueprint upgrade` bring versioned JSON blueprints into config and merge new versions while keeping each client's changes. Per-target `definition` overrides let one portal differ.
  - `status`, `validate`, `fmt`, `ir`, `state rebuild` and `target rebind` check the project, keep one canonical form and recover lost state.
  - Every command takes `--json` and prints one `envelope/1` document with stable issue codes and exit codes. The docs and JSON Schemas ship in the package.

### Patch Changes

- Updated dependencies [a742270]
  - @kalup/core@0.1.0
