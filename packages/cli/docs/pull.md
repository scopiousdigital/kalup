# Pull

`kalup pull [--target <name>]` reads one target and merges it into `kalup/objects/*.ts` and the target's `definition` overrides. It never writes to the portal (`E_WRITE_IN_READ_MODE`), records in state what the files and the portal agree on (below), and sanitizes portal strings it prints.

## Order of work

1. Validate, then pick the target (targets.md).
2. The read key, then the portal guard (targets.md).
3. The read: custom object schemas when `objects` names one (or with `--discover`), then each object's properties (sensitive ones too) and groups. A 403 on a list is `E_SCOPE`: that object is skipped and pull ends with `E_INCOMPLETE`.
4. Normalize. A `hubspotDefined` or `calculated` property becomes a reference. A property Kalup does not write becomes a `p.string` reference, with `W_UNSUPPORTED_TYPE`: a `type` or custom `fieldType` no builder carries (`phone_number`, rich text `html`), or a custom owner or `externalOptions` property. A HubSpot-defined owner property is a `p.string` reference with no warning. Options are ordered by `displayOrder`, missing or negative last.
5. Merge, with state where it owns a resource (below), then validate: an issue is `E_PULL_INVALID`, even with `--check`, and nothing is written.
6. Write the changed files and `kalup/index.ts` as one, each first copied to `.kalup/history/<timestamp>/`; a failure puts all back (`E_PROJECT_WRITE`).

## Scope

`objects.<key>` in `kalup.config.ts` decides what pull writes:

- `custom` (default `true`): every property that is not HubSpot-defined.
- `include: [...]`: properties by internal name, on top of `custom`; the only way in for HubSpot-defined ones.
- `exclude: [...]`: internal names left out, `*` matching any run: never pulled, never archived by takeover. `include` wins over a pattern; a name in both is `E_SETTING_VALUE`, so `--discover` and the plan's notes say to take a listed name out of `exclude` rather than add it to `include`.
- `as`: the export name for the first pull, by default PascalCase singular (`line_items` to `LineItem`).

Under takeover (config.md), pull ends with a line naming what a plan for the target would archive once the files are as pull leaves them, such as what `--only` left out.

A portal property in scope is written unless `kalup/removed.ts` names it or its group, printed `in kalup/removed.ts, not written back` or `its group is in kalup/removed.ts, not written`, never a difference. A file property HubSpot moved into such a group keeps its group, a difference. Pull removes nothing. A file property outside the scope is kept, printed `out of scope, not refreshed`.

## Merge rules

**Custom object schema**: its fields (config.md) take the portal value.

**Properties already in the file**:

- Not in the portal, or archived there: kept, printed `missing in portal`.
- Kalup does not write it (step 4): a reference stays as written, whatever its builder; a full definition becomes a `p.string` reference, a `definition` change.
- Builder conflicts with the portal `type` or `fieldType` (`checkbox` on `p.enum`): kept, `W_CODEC_MISMATCH`.
- Portal says reference: the definition becomes options-only (`value`, `label`, the file's `as`), or none; `.managed(false)` stays as written.
- Portal says managed: `label`, `group`, `fieldType`, `description`, `hasUniqueValue` and `formField` take the portal value. A field the file states stays, even `description: ''`.
- Key, builder kind, chain, comments, the `p.json` validator and `lifecycle` come from the file. Pull adds `.readonly()` where HubSpot marks the value read-only (`modificationMetadata.readOnlyValue`), and never removes one.

**Options** merge by `value`. A member in both takes the portal's `label`, `hidden` and `description` and keeps the file's `as`. Members follow portal order. A portal-only member is added; a file-only one is kept, printed `only in config`.

**New properties** get camelCase of the internal name as key (the internal name, with `W_KEY_COLLISION`, when taken) and `.readonly()` when calculated or when HubSpot marks the value read-only.

**Groups**: a file group missing in the portal is kept, printed `missing in portal`; otherwise it takes the portal label. Every group a managed property uses is written, whatever `--only` says.

## With state

Where state holds agreed values for a resource (its base), each unit is compared with it, as `plan` does:

- Only the portal changed it: the portal's value.
- Only config changed it: the file's value, printed `config change kept`.
- Both changed it: the file's value, printed `conflict, config kept`, a difference.
- An option config added stays, printed `config change kept`; one config dropped stays dropped. An option HubSpot removed stays, printed `removed in HubSpot, kept in config`.
- No base: the rules above.

`--accept <address[#unit]>` (repeatable, `*` as in `--only`) takes the portal side of those units, as each kept line prints; one matching nothing is `E_ACCEPT_UNMATCHED`.

After the files are written, and only after a complete read, pull records in state the base of every unit the files and the portal agree on, for the addresses `--only` selects: under the portal lock (`E_LOCKED`) with the serial check, as apply saves. An owned entry keeps its origin; an address no entry owns gets origin `pulled`, which owns nothing: the next plan still adopts it, but compares against that base, so a later file edit is a `config-change`, not `diverged`. A field the files leave out because HubSpot holds its default (an empty description, `formField` off, an option with no description) is recorded at that default, so adding it to the file later is a `config-change` too. A unit that still differs keeps its base. `--check` and `--discover` record nothing and take no lock. A plan saved before the pull no longer applies (`E_STATE_CHANGED`).

## Target overrides

- `skip: true`: not read (a group with its file properties), printed `skipped on this target, kept as written`, never a difference.
- `name: '<portal name>'`: read under that name, written under the address. When the portal lacks it, the address is `missing in portal`, and a resource referring to its own name is printed `refers to a shadowed portal name, not written`. A portal holding both names is `E_OVERRIDE_AMBIGUOUS`.
- `definition`: a field it states merges into the override, not the object file. A field only its `ignoreChanges` names keeps the file's value, printed `ignored on this target, kept as written`. A move into a group config lacks keeps the override's group, printed `its portal group is not in config, override kept`, a difference: add the group to take it.

## Flags

- `--only <glob>`: merge only matching addresses. `*` matches any characters, `/` included: `property:companies/*`.
- `--discover`: list what is outside the scope, write nothing.
- `--check`: print the changes and `would write <file>`, write nothing. With `--exit-code`, exit 2 on any difference: a change line but `out of scope`, `skipped`, `in kalup/removed.ts`, a new property in a removed group, `config change kept` or `ignored on this target`, a `W_CODEC_MISMATCH`, or a file to rewrite.
- `--json`: `data` holds `target`, `portalId`, `objects` (counts and `changes[]` per object; a kept value has the file's side in `before`, the portal's in `after`), `files` and `state` (`recorded`, the resources whose base changed, and `serial`; absent with `--check` or after an incomplete read); with `--discover`, what is outside the scope.

## Exit codes

| Exit | When |
|---|---|
| 0 | Done, warnings included |
| 1 | `E_USAGE`, `E_NO_CONFIG`, `E_TARGET_REQUIRED`, `E_MISSING_KEY`, `E_STATE_INVALID`, `E_ACCEPT_UNMATCHED`, a failed request, `E_INCOMPLETE`, `E_PROJECT_WRITE`, `E_LOCKED`, `E_STATE_CONFLICT`, `E_STATE_WRITE` |
| 2 | `--check --exit-code` found a difference |
| 3 | Any validate issue, `E_NO_TARGETS`, `E_UNKNOWN_OBJECT`, `E_UNKNOWN_INCLUDE`, `E_PULL_INVALID` |
| 4 | `E_TARGET_PORTAL_MISMATCH` |
