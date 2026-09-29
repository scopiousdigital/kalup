---
"kalup": minor
---

First release of the Kalup CLI: configuration as code for HubSpot properties, property groups and custom object schemas.

- `init` and `pull` read a portal into TypeScript files under `kalup/`, keeping your keys, aliases, comments and `.required()` calls. The files are parsed, never executed.
- The generated barrel, `kalup/index.ts`, uses `.js` specifiers so it resolves under NodeNext, bundlers and plain Node. `kalup fmt` rewrites an older extensionless barrel.
- `validate`, `ir`, `fmt` and `status` check the files, print the `ir/1` document, keep one canonical form and report each target's portal, scopes and state.
- `compare`, `snapshot` and `docs` compare config, portals and saved snapshots with explicit coverage, and write a Markdown data dictionary. An incomplete read never reports equality.
- `plan` shows every change to a target as a `plan/1` document, classifying config changes, drift, conflicts and divergence. Edits made in the HubSpot UI are held, not reverted.
- `apply` writes property and group changes after one approval: a person at a terminal, `--yes` for a small safe change on an unprotected target, or `--approve <writesHash>` from a reviewed CI job. Every write is checked against a fresh read and verified by reading it back.
- Deletes need a tombstone from `kalup rm`, an owning state entry, `allowDestroy: true` and a person at a terminal. Removing a definition from config never deletes anything.
- `state rebuild` and `target rebind` recover lost state and point a target at a recreated test portal or sandbox.
- `add` and `blueprint upgrade` bring versioned JSON blueprints into config and merge new versions while keeping each client's changes. Per-target `definition` overrides let one portal differ.
- Targets are chosen with `--target`, `defaultTarget` or the only target, and every networked command checks that the key belongs to the pinned portal.
- Every command takes `--json` and prints one `envelope/1` document with stable issue codes and exit codes. Error pages ship in the package.
- JSON Schemas for the `ir/1`, `plan/1`, `kalup.state/1`, `blueprint/1` and `blueprints-lock/1` documents, exported as `kalup/schemas/<file>`.
