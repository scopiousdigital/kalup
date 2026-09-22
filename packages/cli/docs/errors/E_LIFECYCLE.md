# E_LIFECYCLE

A `lifecycle` block contradicts itself. Exit 3.

## When

`removedOptions` names a value that is still in `options`, or `ignoreChanges` names something other than `label`, `group`, `fieldType`, `description`, `options`, `hasUniqueValue` or `formField`.

## Fix

Take the value out of `options` or out of `removedOptions`. Spell `ignoreChanges` entries as definition field names.

## Example

```ts
options: [{ value: 'clay', label: 'Clay' }, { value: 'loam', label: 'Loam' }],
lifecycle: { removedOptions: ['clay'], ignoreChanges: ['colour'] },
```

```
kalup/objects/companies.ts:14: E_LIFECYCLE: removedOptions names 'clay', which is still in options (fix: remove it from options or from removedOptions) (docs: errors/E_LIFECYCLE.md)
kalup/objects/companies.ts:14: E_LIFECYCLE: ignoreChanges names 'colour', which is not a definition field (fix: use one of label, group, fieldType, description, options, hasUniqueValue, formField) (docs: errors/E_LIFECYCLE.md)
```
