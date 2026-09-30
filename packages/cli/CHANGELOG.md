# kalup

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
