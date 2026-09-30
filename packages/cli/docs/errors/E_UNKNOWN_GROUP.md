# E_UNKNOWN_GROUP

A property's `group` is not declared for its object. Exit 3.

## When

A managed definition names its group by internal name. That group must be declared under `groups` in some export of the same object, in this file or another.

## Fix

Add the group to `groups`, or use a group that is there. `kalup pull` writes every group a pulled property uses.

## Example

```ts
plotCount: p.number('plot_count', { label: 'Plot count', group: 'orchard', fieldType: 'number' }),
```

```
hubspot/objects/companies.ts:5: E_UNKNOWN_GROUP: group 'orchard' is not in the groups of companies (fix: add orchard: { label: '...' } to the groups block) (docs: errors/E_UNKNOWN_GROUP.md)
```
