# W_LARGE_SCOPE

A warning from `pull`: it wrote more than 200 properties into a new object file. Exit stays 0.

## When

`init` writes `{}` for each object, so every custom property is in the pull scope, and the first pull writes each object file.

## Fix

If the app needs only some of them, set `custom: false` for that object, then delete the properties it does not need from the object file. Every property the file keeps stays in the pull scope; with `custom: false` pull adds no other custom property, and removing one from a file never deletes it in HubSpot. `include` names any other property the app needs.

## Example

```ts
objects: {
  companies: { custom: false, include: ['domain'] },
},
```

```
W_LARGE_SCOPE: the pull wrote 312 properties into the new file for companies: every custom property is in the pull scope (fix: set objects.companies.custom to false, then delete the properties the app does not need from hubspot/objects/companies.ts) (docs: errors/W_LARGE_SCOPE.md)
```
