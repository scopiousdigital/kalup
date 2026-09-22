# E_KEY_COLLISION

Two properties of one object have the same key. Exit 3.

## When

The app reads every property of an object through one type, so keys must differ. Within one export a repeated key is `E_DUPLICATE_KEY`; this code is for two exports of the same object.

## Fix

Rename one of the keys. The internal name stays, so nothing changes in HubSpot.

## Example

```ts
export const Company = defineObject('companies', { properties: { owner: p.string('orch_owner') } })
export const CompanyExtra = defineObject('companies', { properties: { owner: p.string('orch_owner_name') } })
```

```
kalup/objects/companies.ts:39: E_KEY_COLLISION: key 'owner' is used by two properties of companies: property:companies/orch_owner and property:companies/orch_owner_name (fix: rename one of the two keys) (docs: errors/E_KEY_COLLISION.md)
```
