# W_OBJECT_FIELD

A warning from validate: a custom object in config has a name, a label or secondary display properties HubSpot refuses. Exit stays 0.

## When

A custom object name starts with a letter and holds only letters, digits and underscores, at most 50 characters, and its singular and plural labels hold at most 50 characters each. HubSpot refuses anything else on create (live runs, 2026-10-05). The name is the first argument of `defineCustomObject` and is permanent once HubSpot creates the object; the labels can change.

`secondaryDisplayProperties` holds at most two properties, each once: HubSpot refuses a third (live runs, 2026-10-01).

An object HubSpot holds already can break these rules, so validate only warns. `plan` blocks a create, or an update, that would send such a value, with reason `unsupported`.

## Fix

Choose a name HubSpot takes, such as `orchard_visit`, or shorten the label. For an object HubSpot holds already, the name in config is the portal's: keep it. List at most two secondary display properties, each once.

## Example

```ts
export const Visit = defineCustomObject('orchard-visit', {
```

```
hubspot/objects/orchard_visit.ts:3: W_OBJECT_FIELD: 'orchard-visit' is not a custom object name HubSpot takes: a letter, then letters, digits and underscores, at most 50 characters (fix: choose another name; HubSpot never changes a custom object name once it creates the object) (docs: errors/W_OBJECT_FIELD.md)
```
