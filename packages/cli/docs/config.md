# Config files

Kalup reads `kalup.config.ts` and every `.ts` file in the folder of object files except its `index.ts` as data. The folder is `hubspot/` unless `dir` in `kalup.config.ts` names another, such as `dir: 'lib/config/hubspot'`; the paths below use `hubspot/`. It parses a small grammar and never runs them. The app imports the same files and runs them for types and codecs.

This page is the reference. For the walk-through with examples, see [Config files](https://kalup.dev/docs/config/config-files), [kalup.config.ts](https://kalup.dev/docs/config/kalup-config) and [Property builders](https://kalup.dev/docs/config/property-builders) on the website.

## Files

- `kalup.config.ts`: one `export default defineConfig({...})` and nothing after it. Fields: `name` (default: the name in the nearest `package.json` up to the repository root, else the directory name), `dir` (the folder of object files, relative to `kalup.config.ts` and inside the project, default `hubspot`; `E_SETTING_VALUE` otherwise), `state` (`'local'`, the default, or `'repo'`, state.md), `prefix`, `defaultTarget` (targets.md), `mode` (below), `objects` (the pull scope, pull.md) and `targets` (targets.md). A setting at a level that does not take it is `E_SETTING_LEVEL`, whose fix lists the levels that do; a value it does not take is `E_SETTING_VALUE`, with the nearest allowed one.
- `hubspot/objects/<object>.ts`: one or more `export const <Name> = defineObject('<object>', {...})` or `defineCustomObject('<name>', {...})`. The writer adds an `export type <Name>Data = ...` line after each. A file with no such export is `E_MISSING_EXPORT`.
- `hubspot/index.ts`: the barrel, written by `pull` and `fmt`. It imports each object file as `./objects/<object>.js`, which resolves under TypeScript `NodeNext`, `Node16` and `Bundler` resolution, bundlers such as Vite and Next.js, and plain Node running `tsc` output. Under `NodeNext`, import it as `./hubspot/index.js`.
- `hubspot/removed.ts`: tombstones, below.
- `hubspot/pipelines/*`, and a `defineConfig` or `defineRemoved` file elsewhere under `hubspot/`, are `E_UNSUPPORTED_FILE`.
- `hubspot/blueprints.lock.json` and `hubspot/.blueprints/`: written by `kalup add` (blueprints.md).

The folder belongs to Kalup alone: every `.ts` file in it is read as config, `pull` rewrites its `index.ts`, and `init` takes it out of the formatter's checks. Point `dir` at a folder of its own (`lib/config/hubspot`, not `lib/config` next to the app's modules); `init` refuses a folder that holds other `.ts` files (`E_DIR_IN_USE`). A 0.1 project keeps its `kalup/` folder while `dir` is unset and `hubspot/` holds no `.ts` file, with `W_LEGACY_DIR` on every command until you set `dir: 'kalup'` or move the folder. When both hold `.ts` files, every command stops with `E_DIR_AMBIGUOUS` until `dir` says which.

Commit `kalup.config.ts` and the folder: the object files, `index.ts`, `removed.ts`, the blueprints lock, and `state/` only with `state: 'repo'` (state.md). Never commit `.kalup/` (local state, saved plans, journals, history, snapshots), a plan file, `.env` or any file holding a key.

## The grammar

Anything else is `E_NOT_DATA`.

- `import` lines. Imports from `@kalup/core` and `kalup` are rewritten; others are kept, for `p.json` validators.
- Object literals of `key: value` entries, arrays, strings in single or double quotes on one line, numbers, `true` and `false`. No template strings, identifiers as values, spreads, computed keys, shorthand, or calls other than the builders.
- A `//` comment on its own line above an export, a group entry or a property entry, and a comment block above the imports (the file header). Every other comment is an error, including any in `kalup.config.ts` but the header.
- `p.<kind>('<internal name>')` or `p.<kind>('<internal name>', {...})`, then any of `.strict()` (`p.enum` and `p.multiEnum` only), `.required()`, `.readonly()` and `.managed(false)`, each once. Any other chain call is `E_BAD_CHAIN`. A kind not listed below is `E_UNKNOWN_BUILDER`.
- `p.json('<name>', <validator>, {...})`. The validator is opaque text and may not hold a `//` comment.
- A custom object needs `labels: { singular, plural }` and `primaryDisplayProperty`, and may set `requiredProperties`, `searchableProperties` and `secondaryDisplayProperties`.

`E_DUPLICATE_KEY`: a key twice in one literal, an export name twice in one file, or one internal name under two keys. `E_DUPLICATE_ADDRESS`: one address from two files or two exports.

## Builders

Each builder sets the HubSpot `type`, which config never states, and allows these `fieldType` values. Any other is `E_TYPE_FIELDTYPE`.

- `p.string`: `string`; text, textarea, file, phonenumber, html (rich text), calculation_equation.
- `p.stringArray`, `p.json`: `string`; text, textarea, file, phonenumber.
- `p.number`: `number`; number, calculation_equation.
- `p.boolean`: `bool`; booleancheckbox, calculation_equation. Kalup creates it with the options `true` and `false`, which HubSpot requires.
- `p.date` (`YYYY-MM-DD`) and `p.datetime` (ISO 8601): `date` and `datetime`; date.
- `p.enum`: `enumeration`; select, radio, booleancheckbox, calculation_equation.
- `p.multiEnum`: `enumeration`; checkbox.
- `p.phoneNumber`: `phone_number`; phonenumber. The value is the text HubSpot stores.
- `p.owner`: `enumeration`; select, radio, with options HubSpot fills from the account's users (`externalOptions: true`, `referencedObjectType: 'OWNER'`, both implied). The value is the owner ID. It takes no `options`.

In the app every value can be `null`, and a blank one reads as `null`. `p.enum` gives one alias, `p.multiEnum` an alias array (`;`-separated on the wire); a stored value the options do not list reads as `Unlisted`, a branded string `set` writes back unchanged. `.strict()` makes both throw on it instead and drops `Unlisted` from the type; it needs options (`E_STRICT_WITHOUT_OPTIONS`). A bare `p.enum` reference is `Unlisted | null`. `p.stringArray` a `string[]` (split on `,` or `;`, written `,`-joined), `p.json` the validator's output. `.required()` drops `null` and makes `get` throw on a missing value. `.readonly()` removes `set` and `clear` from the type. `clear(bag)` writes `''`, which HubSpot reads as a clear; it does not compile on a `.required()` codec, and `set(bag, null)` leaves the bag untouched. A codec's `property` is its internal name as a literal type, and `PropertyName<typeof Company>` is the union of an object's names. `pull` never writes `.required()`, `p.stringArray` or `p.json`, and keeps them.

## Managed, reference, options-only

A definition with `label`, `group` and `fieldType` is managed: the fields present are owned, and an omitted field belongs to the portal. The optional fields, in HubSpot's names:

- `description`, `options`, `formField`, `hidden` (not shown in HubSpot), `displayOrder` (place in the group: lowest positive first, `-1` after the rest).
- `hasUniqueValue` and `dataSensitivity` (`non_sensitive`, `sensitive`, `highly_sensitive`): set on create only. HubSpot keeps them whatever a later update says, so a difference blocks the plan with a migration.
- On `p.number`: `numberDisplayHint` (`formatted`, `unformatted`, `currency`, `percentage`, `duration`, `probability`), `showCurrencySymbol`, and `currencyPropertyName`, which needs `showCurrencySymbol: true`.
- On `p.string`, `p.stringArray`, `p.json` and `p.phoneNumber`: `textDisplayHint` (`unformatted_single_line`, `multi_line`, `email`, `phone_number`, `domain_name`, `ip_address`, `physical_address`, `postal_code`). HubSpot takes no value that removes a hint.
- `calculationFormula` with `fieldType: 'calculation_equation'`, in HubSpot's formula syntax. HubSpot stores its own spelling (`a+1` as `a + 1`); write it as pull does, or plan notes the difference. A formula change is risky.

A field another builder or field rules out is `E_DEFINITION_FIELD`. HubSpot ignores `dateDisplayHint`, so it is no field. `group` must name a group declared under `groups` for the same object, in any export or file (`E_UNKNOWN_GROUP`). A managed internal name starting with `hs_` or `a<digits>_` is `E_HS_PREFIX`: HubSpot reserves `hs_` for its own properties and `a<appId>_` for an integration's, and refuses a create with either. A reference may carry the prefix, and pull writes such properties as references.

No definition makes a reference: never created, changed or removed. `p.enum` or `p.multiEnum` with `options` and nothing else is a reference with typed options, which pull refreshes.

A definition missing one of the three fields, options-only on another builder, or `.managed(false)` on a reference is `E_REFERENCE_DEFINITION`.

`.managed(false)` keeps a full definition for typing while nothing owns it.

## Options and aliases

`options: [{ value, label, as?, hidden?, description? }]`. Array order is display order. `as` is the app-side name: the TypeScript type is the union of `as ?? value`, `get` returns the alias and `set` takes it. `as` never goes to HubSpot. Values and aliases must each be unique (`E_DUPLICATE_OPTION`, `E_DUPLICATE_ALIAS`).

## Keys

The object key is the app's name for the property. Two exports of one object using the same key is `E_KEY_COLLISION`. Rename keys freely; HubSpot only knows the internal name.

## Lifecycle

`lifecycle: { options: 'additive' | 'exact', removedOptions: [...], ignoreChanges: [...], preventDestroy: true }` inside a full definition. `options` defaults to `additive`, and to `exact` under takeover, unless the property or the target's override states it. `removedOptions` may not name a value still in `options`, and `ignoreChanges` may name only definition fields (`E_LIFECYCLE`). `plan` and `compare` apply the others (plan.md); `preventDestroy` blocks a `rm` destroy.

## Per-target definitions

A target's override `definition` (targets.md) replaces each field it states there, whole, and owns it, empty values included: a property's `label`, `description`, `group`, `fieldType`, `formField`, `options` (no `as`), `hidden`, `displayOrder`, the display fields, `calculationFormula` and lifecycle but `preventDestroy`; a group's `label`. Else `E_OVERRIDE_DEFINITION`. `pull` writes these fields into the override.

## Mode: addon and takeover

`mode: 'addon' | 'takeover'` at the top level, under `objects.<object>`, under `targets.<target>`, or under `targets.<target>.objects.<object>`. The most specific wins, in that order from the last, and the default is `addon`: Kalup manages only what config names. A target `mode` that differs from an object's `mode` the target says nothing more about is `W_MODE_SHADOWED`.

Under `takeover`, `plan` archives every custom property and group in the object's pull scope that config lacks and `hubspot/removed.ts` does not name (a group only once every property in it goes, and after them), and removes enum options only the portal holds. Never a HubSpot-defined or calculated property, a kind Kalup does not write, anything an object file lists, a name `exclude` covers, or a property a custom object schema names. Every takeover removal is destructive: it needs `allowDestroy: true` on the target and a person at a terminal, and `--yes` and `--approve` never cover it. Without `allowDestroy` it is blocked, reason `policy`; after an incomplete read, reason `scope`.

## Removed resources

`hubspot/removed.ts` holds `export default defineRemoved({...})`, keyed by address:

```ts
export default defineRemoved({
  'property:companies/legacy_score': { action: 'destroy', reason: 'Replaced by lead_score' },
  'group:companies/old_billing': { action: 'release' },
})
```

`destroy` deletes the resource, only on a target with `allowDestroy: true` (default false). `release` stops managing it, leaving it there. Keys are property or group addresses (`E_TOMBSTONE_ADDRESS`) that config no longer defines (`E_TOMBSTONE_CONFLICT`).

## Canonical form

`kalup fmt` validates, then rewrites `kalup.config.ts`, `hubspot/removed.ts`, every object file and the barrel: groups and properties sorted by internal name, tombstones by address, fields in a fixed order, options in display order, quotes as biome writes them, 120 columns. It keeps every value you wrote, `description: ''`, `options: []`, `false` and an empty `lifecycle` included: a present field is owned. `fmt --check` lists the files it would change and exits 2 when there are any. Old files go to `.kalup/history/<timestamp>/` first; the last 20 runs are kept.
