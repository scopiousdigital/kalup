# E_TOMBSTONE_ADDRESS

A key in `hubspot/removed.ts`, or the address given to `kalup rm`, is not the address of a property, group, pipeline or stage. Exit 3.

## When

Each key in `hubspot/removed.ts` is an address, such as `property:companies/legacy_score`: the type, a colon, the object, a slash and the name. A key with no object, such as `property:legacy_score`, names nothing and is refused. A stage address names its pipeline as well: `stage:deals/renewals/won`. This version removes custom objects, properties, property groups, pipelines and stages, so a key of another type, such as `list:renewals`, is refused as well, and so is `object:<name>` for a standard object, which HubSpot defines, or for a key that is not under `objects` in `kalup.config.ts`.

## Fix

Write the address as `kalup ir` lists it, or remove the entry.

## Example

```ts
export default defineRemoved({
  legacyScore: { action: 'destroy' },
})
```

```
hubspot/removed.ts:4: E_TOMBSTONE_ADDRESS: 'legacyScore' is not an address (fix: write the address of a property, group, pipeline or stage, such as 'property:companies/legacy_score') (docs: errors/E_TOMBSTONE_ADDRESS.md)
```
