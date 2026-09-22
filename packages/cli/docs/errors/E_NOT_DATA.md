# E_NOT_DATA

A config file holds something outside the grammar Kalup reads. Exit 3.

## When

Kalup parses config as data and never runs it. Identifiers, spreads, template strings, calls other than the builders, a comment that is not on its own line above an entry, an unknown field, a value of the wrong type, and a missing required field (a custom object's `labels` or `primaryDisplayProperty`, a group's `label`, an option's `value` or `label`, `credentials.read`) are all this code. The message and the fix say which. config.md lists the grammar.

## Fix

Follow the fix. To keep a note, put a `//` comment on its own line above the property, group or export.

## Example

```ts
plotCount: p.number('plot_count'), // counted by hand
```

```
kalup/objects/companies.ts:5: E_NOT_DATA: this comment is not attached to an entry (fix: move this comment above the entry it describes) (docs: errors/E_NOT_DATA.md)
```
