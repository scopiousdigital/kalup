# E_OVERRIDE_AMBIGUOUS

A name override is ambiguous: the portal holds both names. Exit 1.

## When

`overrides: { '<address>': { name: '<portal name>' } }` says the resource has another name in this portal. When the portal also holds a resource under the address's own name, and no other name override claims that name, Kalup cannot tell which one the address means. A swap is fine, since each override claims the other's name, as is an override to the address's own name. In a chain, the first address's own name must be missing from the portal or claimed by another override. Property and group overrides are checked against the object's lists (an archived group does not count), `object:` overrides against the custom object schemas.

## Fix

Remove the override if the address's own name is the right one, or rename one of the two in HubSpot.

## Example

```ts
overrides: { 'property:harvest/picked_on': { name: 'pickedon' } },
```

```
E_OVERRIDE_AMBIGUOUS: the portal holds both 'pickedon' and 'picked_on' on harvest, so the name override for property:harvest/picked_on is ambiguous (fix: remove the override, or rename one of the two in HubSpot) (docs: errors/E_OVERRIDE_AMBIGUOUS.md)
```
