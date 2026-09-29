# E_TOMBSTONE_ADDRESS

A key in `kalup/removed.ts`, or the address given to `kalup rm`, is not the address of a property or group. Exit 3.

## When

Each key in `kalup/removed.ts` is an address, such as `property:companies/legacy_score`: the type, a colon, the object, a slash and the name. A key with no object, such as `property:legacy_score`, names nothing and is refused. This version removes properties and property groups only, so a key of another type, such as `object:parcels`, is refused as well.

## Fix

Write the address as `kalup ir` lists it, or remove the entry.

## Example

```ts
export default defineRemoved({
  legacyScore: { action: 'destroy' },
})
```

```
kalup/removed.ts:4: E_TOMBSTONE_ADDRESS: 'legacyScore' is not an address (fix: write the address of a property or group, such as 'property:companies/legacy_score') (docs: errors/E_TOMBSTONE_ADDRESS.md)
```
