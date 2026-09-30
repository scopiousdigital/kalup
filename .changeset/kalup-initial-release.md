---
"kalup": minor
---

First release of the Kalup CLI: configuration as code for HubSpot properties, property groups and custom object schemas.

- `init` and `pull` read a portal into TypeScript files under `kalup/`, keeping your keys, aliases, comments and `.strict()` and `.required()` calls. The files are parsed, never executed. Pull records in state the values the files and the portal agree on, so a later edit in a file is a config change the next plan writes, not a difference it holds. Pull adds `.readonly()` wherever HubSpot marks a value read-only, and writes owner, `externalOptions`, phone number, rich text and other properties Kalup does not write as `p.string` references, which plan never changes.
- The generated barrel, `kalup/index.ts`, uses `.js` specifiers so it resolves under NodeNext, bundlers and plain Node. `kalup fmt` rewrites an older extensionless barrel.
- `validate`, `ir`, `fmt` and `status` check the files, print the `ir/1` document, keep one canonical form and report each target's portal, scopes and state. `init` and `status` also name the write scopes `apply` needs.
- `compare`, `snapshot` and `docs` compare config, portals and saved snapshots with explicit coverage, and write a Markdown data dictionary. An incomplete read never reports equality.
- `plan` shows every change to a target as a `plan/1` document, classifying config changes, drift, conflicts and divergence. Edits made in the HubSpot UI are held, not reverted. The text shows each value it writes as portal then config, each held unit with config, portal and base, and the settings that decide the steps. `plan --exit-code` exits 2 while anything is pending, blocked steps and an incomplete read included.
- `apply` writes property and group changes after one approval: a person at a terminal, `--yes` for a small safe change on an unprotected target (at most the target's `yesLimit`, 25 by default), or `--approve <writesHash>` from a reviewed CI job. Every write is checked against a fresh read and verified by reading it back. Steps the plan blocked are listed with their reason, never skipped silently.
- Deletes need a tombstone from `kalup rm`, an owning state entry, `allowDestroy: true` and a person at a terminal. In the default `addon` mode, removing a definition from config never deletes anything.
- `mode: 'takeover'`, at the top level, per object, per target or per target object, makes config the whole truth for an object's pull scope: plan archives the custom properties and groups config lacks and removes enum options only the portal holds, each only with `allowDestroy: true` and a person at a terminal, and never after an incomplete read. Apply checks takeover's rules again against its own read, so a saved plan never archives what a new plan would keep. `exclude` per object keeps properties such as an integration's out of pull and out of takeover.
- `adopt: 'overwrite'` per target writes config over the differing values of a first adoption, as risky steps labelled `overwrites-portal`, and `plan --take config` accepts a glob such as `'property:companies/*'`.
- Commands that write take a lock per portal and never wait. A lock left by a crashed command is never taken over: `E_LOCKED` names its holder and the file to delete.
- `state rebuild` and `target rebind` recover lost state and point a target at a recreated test portal or sandbox.
- `add` and `blueprint upgrade` bring versioned JSON blueprints into config and merge new versions while keeping each client's changes. Per-target `definition` overrides let one portal differ.
- Targets are chosen with `--target`, `defaultTarget` or the only target, and every networked command checks that the key belongs to the pinned portal.
- Every command takes `--json` and prints one `envelope/1` document with stable issue codes and exit codes. Error pages ship in the package.
- JSON Schemas for the `ir/1`, `plan/1`, `kalup.state/1`, `blueprint/1` and `blueprints-lock/1` documents, exported as `kalup/schemas/<file>`.
