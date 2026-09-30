# E_STANDARD_OBJECT

A `defineCustomObject` uses the key of a standard object. Exit 3.

## When

`defineCustomObject` defines a custom object schema. HubSpot has no custom object schema under a standard object's name (`contacts`, `companies`, `deals`, `line_items` and the rest), so no read can find one there. `validate` and every command that validates first report it, before any request.

## Fix

For the standard object, use `defineObject` and drop `labels` and the display properties. For a custom object, give it a name that is not a standard object's.

## Example

```ts
export const Company = defineCustomObject('companies', { labels: { singular: 'Company', plural: 'Companies' }, ... })
```

```
hubspot/objects/companies.ts:6: E_STANDARD_OBJECT: 'companies' is a standard object in HubSpot, so defineCustomObject cannot define it (fix: use defineObject('companies', ...) without labels and the display properties, or name the custom object differently) (docs: errors/E_STANDARD_OBJECT.md)
```
