# Snapshot

`kalup snapshot [--target <name>]` reads one target and saves what it read, with a record of what the read covered. It never writes to the portal or to a config file.

This page is the reference. For the walk-through with examples, see [kalup snapshot](https://kalup.dev/docs/commands/snapshot) on the website.

## Order of work

1. Validate (exit 3), pick the target (targets.md), the read key, then the portal guard (exit 4).
2. Pull's read and scope: three properties lists per object, its pipelines when they are in scope, and the associations of each pair in association scope, `skip` and `name` overrides applied. A 403 leaves that object unread; on the pipelines list, only its pipelines; on a labels list, only that pair's associations.
3. Write the file, then print a summary.

## The file

By default the file is `.kalup/snapshots/<target>/<stamp>.json` under the project root, stamped when the read finished, as in `20260923T101530123Z`. A target name that is not a safe directory name on every system becomes a slug plus the first 8 hex digits of the name's SHA-256. `--out <file>` writes exactly there, relative to the current directory. A snapshot never replaces a file: one that exists is `E_SNAPSHOT`, exit 1.

The file is an `ir/1` document with `generator.frontend: 'portal'`, keys sorted, and U+007F to U+009F, U+2028 and U+2029 escaped:

- `resources`: what the read captured, under local addresses. Groups carry their label. A custom property carries its definition; a HubSpot-defined or calculated one at most its options. A custom object carries its labels, description, display property and property lists. Where one names a portal resource a `name` override shadows (a property's group, a schema's property), it reads `shadowed:<name>`, which never equals a config name.
- `observation`: the target's name and `portalId`, `observedAt`, the one timestamp an IR document may hold, and `coverage`.

`coverage` has `complete`, `otherObjects` (custom objects config does not name, or `unknown` when the schemas list was not read), `notCaptured` (documented fields Kalup drops) and one entry per object key: `status` (`read`, `unreadable`, `absent` or `excluded`), `missingScope` when unreadable, `objectTypeId`, the names out of scope, `unaddressable` (config names them), shadowed by a `name` override or unsupported (Kalup does not write it; `externalOptions` and `referencedObjectType` are kept), `unsupportedSchema` for a schema without a label, and the addresses `skip` and `name` overrides exclude or rename.

A snapshot holds the scope and the captured fields, and is no backup of the portal.

## Using it

- `kalup compare <file> <target>`: drift since the snapshot.
- `kalup compare <older file> <newer file>`: two reads, no request or project needed.
- `kalup docs <file>`: the data dictionary of the read (dictionary.md).

## Incomplete reads

The file is still written, with `complete: false`, the objects not read marked `unreadable` and `unaddressable` properties listed, and `W_INCOMPLETE` names the fix. The exit stays 0. A resource settling after an apply (plan.md) is listed under `coverage.settling` with when its window ends, and compare reports it unknown.

## Output

```
Snapshot of target sandbox, portal 1111111, observed at 2026-09-23T10:15:30.123Z: 2 objects, 3 groups, 10 properties
Wrote .kalup/snapshots/sandbox/20260923T101530123Z.json
```

`--json` gives `file`, `target`, `portalId`, `observedAt`, `complete` and `counts` (objects read, groups, properties, pipelines, stages and associations held). The text names pipelines, stages and associations only when the snapshot holds any.

## Exit codes

| Exit | When |
|---|---|
| 0 | Written, an incomplete read included |
| 1 | `E_USAGE`, `E_NO_CONFIG`, `E_TARGET_REQUIRED`, `E_CANCELLED`, `E_MISSING_KEY`, `E_OVERRIDE_AMBIGUOUS`, `E_SNAPSHOT` (the file exists), a failed request |
| 3 | Config invalid, `E_NO_TARGETS`, `E_UNKNOWN_OBJECT` |
| 4 | `E_TARGET_PORTAL_MISMATCH` |
