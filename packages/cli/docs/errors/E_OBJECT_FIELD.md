# E_OBJECT_FIELD

A custom object in config has a name or a label HubSpot refuses. Exit 3.

## When

A custom object name starts with a letter and holds only letters, digits and underscores, at most 50 characters, and its singular and plural labels hold at most 50 characters each. HubSpot refuses anything else on create (live runs, 2026-10-05). The name is the first argument of `defineCustomObject` and is permanent once HubSpot creates the object; the labels can change.

## Fix

Choose a name HubSpot takes, such as `orchard_visit`, or shorten the label. For an object HubSpot holds already, the name in config is the portal's: keep it.

## Example

```ts
export const Visit = defineCustomObject('orchard-visit', {
```

```
hubspot/objects/orchard_visit.ts:3: E_OBJECT_FIELD: 'orchard-visit' is not a custom object name HubSpot takes: a letter, then letters, digits and underscores, at most 50 characters (fix: choose another name; HubSpot never changes a custom object name once it creates the object) (docs: errors/E_OBJECT_FIELD.md)
```
