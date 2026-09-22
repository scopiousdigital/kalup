# Config files

Kalup reads `kalup.config.ts` and every `.ts` file under `kalup/` except `kalup/index.ts` as data. It parses a small grammar and never runs the files. The app imports the same files and runs them for types and codecs.

## Files

- `kalup.config.ts`: one `export default defineConfig({...})` and nothing after it. Fields: `name` (default: the directory name), `prefix`, `objects` (the pull scope, see pull.md) and `targets` (see targets.md).
- `kalup/objects/<object>.ts`: one or more `export const <Name> = defineObject('<object>', {...})` or `defineCustomObject('<name>', {...})`. The writer adds an `export type <Name>Data = ...` line after each. A file with no such export is `E_MISSING_EXPORT`.
- `kalup/index.ts`: the barrel, written by `pull` and `fmt`.
- `kalup/removed.ts`, `kalup/pipelines/*` and a `defineConfig` file under `kalup/` are `E_UNSUPPORTED_FILE`.

## The grammar

Anything else is `E_NOT_DATA` with the file, the line and a fix.

- `import` lines. Imports from `@kalup/core` and `kalup` are rewritten by the tool. Other imports are kept, for `p.json` validators.
- Object literals of `key: value` entries, arrays, strings in single or double quotes on one line, numbers, `true` and `false`. No template strings, identifiers as values, spreads, computed keys, shorthand, or calls other than the builders.
- A `//` comment on its own line above an export, a group entry or a property entry, and a comment block above the imports (the file header). Every other comment is an error, including any comment in `kalup.config.ts` except the header.
- `p.<kind>('<internal name>')` or `p.<kind>('<internal name>', {...})`, then any of `.required()`, `.readonly()` and `.managed(false)`, each once. Any other chain call is `E_BAD_CHAIN`. A kind not in the table below is `E_UNKNOWN_BUILDER`.
- `p.json('<name>', <validator>, {...})`. The validator is kept as opaque text and may not hold a `//` comment.
- A custom object needs `labels: { singular, plural }` and `primaryDisplayProperty`, and may set `requiredProperties`, `searchableProperties` and `secondaryDisplayProperties`.

`E_DUPLICATE_KEY`: the same key twice in one literal, the same export name twice in one file, or one internal name under two keys of one export. `E_DUPLICATE_ADDRESS`: one address, such as `group:companies/orchard`, from two files or two exports.

## Builders

Each builder sets the HubSpot `type`, which config never states, and allows these `fieldType` values. Any other is `E_TYPE_FIELDTYPE`.

- `p.string`, `p.stringArray`, `p.json`: `string`; text, textarea, file, phonenumber.
- `p.number`: `number`; number.
- `p.boolean`: `bool`; booleancheckbox.
- `p.date` (`YYYY-MM-DD`) and `p.datetime` (ISO 8601): `date` and `datetime`; date.
- `p.enum`: `enumeration`; select, radio, booleancheckbox.
- `p.multiEnum`: `enumeration`; checkbox.

In the app every value can be `null`, and a blank one reads as `null`. `p.enum` gives one alias, `p.multiEnum` an alias array (`;`-separated on the wire), `p.stringArray` a `string[]` (split on `,` or `;`, written `,`-joined), `p.json` the validator's output. `.required()` drops `null` and makes `get` throw on a missing value. `.readonly()` removes `set` from the type. `pull` never writes `.required()`, `p.stringArray` or `p.json`; those are hand edits, and pull keeps them.

## Managed, reference, options-only

A definition with `label`, `group` and `fieldType` is managed: the fields present are owned, and an omitted `description`, `options`, `hasUniqueValue` or `formField` belongs to the portal. `group` must name a group declared under `groups` for the same object, in any export or file (`E_UNKNOWN_GROUP`). A managed internal name starting with `hs_` is `E_HS_PREFIX`.

No definition makes a reference: never created, changed or removed. `p.enum` or `p.multiEnum` with `options` and nothing else is a reference with typed options, which pull refreshes. Pull writes HubSpot-defined and calculated properties as references, and adds `.readonly()` to a calculated one only when it first writes it.

A definition missing one of the three fields, options-only on another builder, or `.managed(false)` on a reference is `E_REFERENCE_DEFINITION`.

`.managed(false)` keeps a full definition for typing while nothing owns it.

## Options and aliases

`options: [{ value, label, as?, hidden?, description? }]`. Array order is display order. `as` is the app-side name: the TypeScript type is the union of `as ?? value`, `get` returns the alias and `set` takes it. `as` never goes to HubSpot.

## Keys

The object key is the app's name for the property. Pull picks camelCase of the internal name (`plot_count` to `plotCount`), or the internal name when that key is taken (`W_KEY_COLLISION`). Two exports of one object using the same key is `E_KEY_COLLISION`. Rename keys freely; HubSpot only knows the internal name.

## Lifecycle

`lifecycle: { options: 'additive' | 'exact', removedOptions: [...], ignoreChanges: [...], preventDestroy: true }` inside a full definition. `options` defaults to `additive`. `removedOptions` may not name a value still in `options`, and `ignoreChanges` may name only `label`, `group`, `fieldType`, `description`, `options`, `hasUniqueValue` or `formField` (`E_LIFECYCLE`). This version validates the block and carries it into the IR; nothing acts on it yet.

## Canonical form

`kalup fmt` validates, then rewrites `kalup.config.ts`, every object file and the barrel: groups and properties sorted by internal name, options in display order, defaults left out (`description: ''`, `options: []`, `hasUniqueValue: false`, `formField: false`, `hidden: false`, `options: 'additive'`), single quotes unless a string holds more single than double quotes, 120 columns. `fmt --check` lists the files that would change and writes nothing; add `--exit-code` to exit 2 then. Old files are copied to `.kalup/history/<timestamp>/` first; the last 20 runs are kept.

What a pull keeps from the file and takes from the portal is in pull.md.
