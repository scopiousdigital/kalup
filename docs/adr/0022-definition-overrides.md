# 0022. Per-target definition overrides replace whole fields

## Status

proposed

## Date

2026-09-24

## Context

`targets.<name>.overrides.<address>.definition` has been parsed and validated as a free object since milestone 1, and `plan` blocks such a resource with reason `override`. Agencies need it: one client wants a different label, an extra option, or a field left to the portal. The v1 assignment asks for schema-aware precedence, ownership and validation, including explicit empty values and option sets, one effective configuration used everywhere, and a pull that never lets one target's values overwrite the shared definition or leak into another target.

## Decision

**Precedence.** For target T, the effective definition of an address is the shared definition with each field the override states replaced whole. Fields are `label`, `description`, `group`, `fieldType`, `formField` and `options` for a property, and `label` for a group. `options` is replaced as a list: the override's options are the target's options, in their order. `lifecycle` may be overridden field by field (`options`, `removedOptions`, `ignoreChanges`). There is no deep merge of option members.

**Ownership.** A field present in the effective definition is owned on T, including a field the shared definition leaves to the portal. An explicit empty value is data: `description: ''` owns an empty description on T, and `options: []` owns an empty option list, which with the default `additive` lifecycle adds nothing and removes nothing.

**Validation**, as `E_OVERRIDE_DEFINITION` (exit 3) at the override's line:

- Only the fields above. `hasUniqueValue` is fixed at create, and `type` comes from the builder, so neither can differ per target.
- The effective definition passes the same rules as a shared one: `fieldType` fits the builder, `group` names a group of the same object in config, option values are unique, `removedOptions` does not list an option the target keeps.
- A reference (a builder with no label, group and fieldType) and a custom object schema cannot take a definition override in this release.
- Option aliases (`as`) belong to the app and stay in the shared file; an override option carries `value`, `label`, `hidden` and `description` only. An option value the shared list does not have is allowed, and `validate` warns (`W_OVERRIDE_OPTION`) that the app's codec throws on it.

**One effective configuration.** A pure core function, `effectiveResources(ir, target)`, applies the target's definition overrides to the IR's resources in IR form. `validate`, `compare` (a config side compared with a target), `plan` and the saved plan's `desired` values all use it. The shared IR that `kalup ir` prints is unchanged.

**Pull.** Pulling T takes the portal side for a field T overrides into the override in `kalup.config.ts`, never into the shared object file. Fields T does not override follow the normal pull rules, with two exceptions that keep T's values out of the shared file: a field T's own `lifecycle.ignoreChanges` releases is kept as written (the note `ignored`), and when HubSpot moved a property whose `group` T overrides into a group config does not declare, the override keeps its group until that group is added to config (the note `override-group`, counted as a difference). Another target's overrides are never touched. The candidate project, `kalup.config.ts` included, validates before any file is written, and every file is written through one staged write.

**`lookup` overrides** stay blocked. No resource type in this release references a lookup resource, so `plan` blocks such an address with reason `override` and says why, and `compare` reports it `unknown` on that target.

## Alternatives considered

- **Deep merge of options by value.** Lets a target add one option without restating the list, but then removing a shared option on one target needs a second syntax, and the result is harder to read in review. Rejected for whole-field replacement.
- **Per-target object files.** Duplicates every definition per portal and loses the shared intent. Rejected.
- **Let an override un-own a field.** Needs a sentinel value in a data-only grammar. Use `lifecycle.ignoreChanges` on the target instead.

## Consequences

- An agency keeps one shared definition and states only what differs per client portal.
- `irHash` stays a hash of the shared IR; a plan's approval digest covers the effective values through `desired`.
- A blueprint upgrade changes the shared definition only; overrides keep their fields, so a client's per-target difference survives an upgrade.
