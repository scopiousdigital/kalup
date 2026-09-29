# E_OVERRIDE_DEFINITION

A target's definition override states something that cannot differ per target. Exit 3.

## When

`overrides: { '<address>': { definition: {...} } }` replaces fields of the shared definition on one target. `validate` and every command that validates first report, at the override's line:

- a field other than `label`, `description`, `group`, `fieldType`, `formField` and `options` on a property, or `label` on a group. `hasUniqueValue` is fixed when HubSpot creates a property, and `type` comes from the builder. In `lifecycle`, only `options`, `removedOptions` and `ignoreChanges`.
- an override on a reference, a `.managed(false)` property or a custom object schema.
- a result that breaks a shared rule: a `fieldType` the builder does not take, a `group` the object does not declare, an option value twice, `removedOptions` naming a kept option, `ignoreChanges` naming no definition field.
- an option with `as`. Aliases belong to the app and stay in the shared file.

## Fix

Change or remove what the message names.

## Example

```
kalup.config.ts:8: E_OVERRIDE_DEFINITION: property:deals/term_days on target sandbox: hasUniqueValue is fixed when HubSpot creates the property, so it cannot differ per target (fix: remove hasUniqueValue from the override) (docs: errors/E_OVERRIDE_DEFINITION.md)
```
