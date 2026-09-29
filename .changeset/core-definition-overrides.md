---
"@kalup/core": minor
---

Per-target `definition` overrides (ADR 0022). `effectiveResources(ir, target)` returns the IR's resources with that target's definition overrides applied, in IR form: each field an override states replaces the shared field whole (`label`, `description`, `group`, `fieldType`, `formField` and `options` on a property, `label` on a group, and `lifecycle.options`, `removedOptions` and `ignoreChanges` one by one). `options` is a whole list in the override's order, and an explicit empty value is owned. A skip wins, and the shared IR is never changed. `OVERRIDABLE` lists the fields.

`validate` checks every target's definition overrides with `E_OVERRIDE_DEFINITION` (exit 3, at the override's line): a field that cannot differ per target, an override on a reference, a `.managed(false)` property or a custom object schema, an option carrying `as`, and a result that breaks a shared rule (fieldType, group, duplicate option values, `removedOptions`, `ignoreChanges`). The reader reports `type` or an unknown field in an override's definition as `E_OVERRIDE_DEFINITION` too. `W_OVERRIDE_OPTION` warns about an override option value the shared options lack, since the app's codec throws on it.
