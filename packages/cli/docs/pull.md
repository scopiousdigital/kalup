# Pull

`kalup pull --target <name>` reads one portal and merges it into `kalup/objects/*.ts`. It never writes to the portal: a request on a path not tagged `read` is refused before it is sent (`E_WRITE_IN_READ_MODE`).

## Order of work

1. Validate. `E_NO_CONFIG` is exit 1, any other issue exit 3, and nothing is read.
2. The read key (`E_MISSING_KEY`), then the portal guard: a key for another portal is `E_TARGET_PORTAL_MISMATCH`, exit 4, and nothing else is sent.
3. The read. The custom object schemas first, when `objects` has a key that is not a standard object (or with `--discover`). A key that is neither is `E_UNKNOWN_OBJECT`. Then, per object in config order, its properties and property groups. A 403 on one of these lists is an `E_SCOPE` gap: that object is skipped (all custom objects, when the schemas list failed), the rest continue, exit stays 0. Any other failed request stops the command with exit 1. An `include` name the portal does not have is `E_UNKNOWN_INCLUDE`, exit 3, after the reads.
4. Normalize. Archived properties and groups are skipped. A `hubspotDefined` or `calculated` property becomes a reference: options only for an enumeration. A `type` no builder carries (`object_coordinates`, `json`, anything unknown), or a managed property's `fieldType` its builder refuses, is skipped with `W_UNSUPPORTED_TYPE`. Options are ordered by `displayOrder`, missing or negative values last.
5. Merge, write canonical files and `kalup/index.ts`, print the summary. Changed files are first copied to `.kalup/history/<timestamp>/`. Only files whose text changes are written, so a repeat pull with no portal change writes nothing.

## Scope

`objects.<key>` in `kalup.config.ts` decides what pull writes:

- `custom` (default `true`): every property that is not HubSpot-defined.
- `include: [...]`: properties by internal name, on top of `custom`. HubSpot-defined ones come in only this way.
- `as`: the export name for the first pull. Default: PascalCase singular, `line_items` to `LineItem`.

A portal property in scope that is not in config is written. A pull never removes a property, group or option, though a merge can drop fields from a definition. A property in the file that the scope leaves out is kept and printed `out of scope, not refreshed`.

## Merge rules

**Custom object schema**: `labels`, `primaryDisplayProperty`, `requiredProperties`, `searchableProperties` and `secondaryDisplayProperties` take the portal value.

**Properties already in the file**:

- Not in the portal, or archived there: kept, printed `missing in portal`.
- Builder kind conflicts with the portal `type` (a `p.string` on an `enumeration`): kept as written, `W_CODEC_MISMATCH`.
- Portal says reference, file says `.managed(false)`: kept as written.
- Portal says reference: the definition becomes options-only (`value`, `label`, the file's `as`) for an enumeration, or none. `lifecycle` and option `hidden` and `description` are dropped.
- Portal says managed: `label`, `group`, `fieldType`, `description`, `hasUniqueValue` and `formField` take the portal value, one line per field that differs.
- Key, builder kind, chain, comments, the `p.json` validator and (for managed) `lifecycle` always come from the file.

**Options** merge by `value`. A member in both takes the portal's `label`, `hidden` and `description` and keeps the file's `as`. Members follow portal order. A portal-only member is added. A file-only member is kept and printed `only in config`; it may be an edit not applied yet, so on its own it is not a change.

**New properties** get camelCase of the internal name as key, or the internal name with `W_KEY_COLLISION` when that key is taken, and `.readonly()` when calculated.

**Groups**: a file group missing in the portal is kept and printed `missing in portal`; otherwise its label takes the portal value. Every group a managed property uses is written, whatever `--only` says.

A per-target `name` override reads a resource under its portal name and writes it under the address. For a property or group override, a portal that holds both names is `E_OVERRIDE_AMBIGUOUS`.

## Flags

- `--target <name>`: required (`E_USAGE`). An undeclared name is `E_UNKNOWN_TARGET`.
- `--only <glob>`: merge only matching addresses. `*` matches any run of characters, `/` included: `property:companies/*`, `group:*`, `object:harvest`. An object with no file gets one only when something is added.
- `--discover`: list the custom objects and properties outside the scope, write nothing.
- `--check`: print what would change, write nothing. With `--exit-code`, exit 2 when a file would change: the drift check for CI.
- `--json`: one `envelope/1` on stdout. `data` holds `target`, `portalId`, `objects` (counts and `changes[]` per object) and `files`; with `--discover`, the `objects` and `properties` outside the scope.

An unknown flag or a positional argument is `E_USAGE`.

## Output

Per object: `<object>: N added, N changed, N unchanged, N missing in portal`, then one line per change: `added`, `changed` (`<address>#<field> "before" -> "after"`), `missing in portal`, `only in config`, `out of scope, not refreshed`. Then `wrote <file>` (`would write` with `--check`) or `Files are up to date`. Portal strings are sanitized: no control characters, 120 characters at most.

## Exit codes

| Exit | When |
|---|---|
| 0 | Done, including `E_SCOPE` gaps and warnings |
| 1 | `E_USAGE`, `E_NO_CONFIG`, `E_MISSING_KEY`, `E_OVERRIDE_AMBIGUOUS`, a failed request (`E_AUTH`, `E_SCOPE` on account-info, `E_HTTP`, `E_RATE_LIMIT`, `E_DAILY_LIMIT`, `E_UNEXPECTED`) |
| 2 | `--check --exit-code` found a file that would change |
| 3 | Config invalid: any validate issue, `E_UNKNOWN_TARGET`, `E_UNKNOWN_OBJECT`, `E_UNKNOWN_INCLUDE` |
| 4 | `E_TARGET_PORTAL_MISMATCH` |

Warnings: `W_CODEC_MISMATCH`, `W_KEY_COLLISION`, `W_UNSUPPORTED_TYPE`, `W_RATE_LIMIT`, and the validate warnings `W_PREFIX`, `W_JSON_FIELDTYPE` and `W_UNRESOLVED`. With `--json` they are `issues[]` on an `ok: true` envelope, each with its page in `docs`.
