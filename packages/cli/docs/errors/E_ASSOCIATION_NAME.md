# E_ASSOCIATION_NAME

An entry of `associations.ts` names an object or an internal name holding whitespace or a slash. Exit 3.

## When

An association is addressed as `association:<from>/<to>/<name>`, so from, to and name must each be non-empty and hold no whitespace or slash. The name is what HubSpot stores for both directions of the label, unique in the portal and never changed.

## Fix

Use the object keys from `objects`, and an internal name of letters, digits and underscores, such as the label in lower case with underscores: `charter_signer`.

## Example

```
hubspot/associations.ts:6: E_ASSOCIATION_NAME: from, to and name must each be non-empty and hold no whitespace or slash, so an address can hold them (fix: use object keys and an internal name without spaces or slashes) (docs: errors/E_ASSOCIATION_NAME.md)
```
