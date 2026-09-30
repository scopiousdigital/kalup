# E_DUPLICATE_ADDRESS

One address is defined twice, in two files or in two exports. Exit 3.

## When

Every group, property and custom object has one address, such as `group:companies/orchard`. Two exports of the same object that both declare the group `orchard`, or the same property in two files, give that address twice. The issue names both places.

## Fix

Keep one definition and remove the other, or give one of them another internal name.

## Example

```
hubspot/objects/companies.ts:15: E_DUPLICATE_ADDRESS: group:companies/orchard is defined twice: hubspot/objects/companies.ts:5 and hubspot/objects/companies.ts:15 (fix: remove or rename one of the two definitions) (docs: errors/E_DUPLICATE_ADDRESS.md)
```
