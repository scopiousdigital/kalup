# E_OVERRIDE_NAME

Two addresses in config would read one portal resource through a name override. Exit 3.

## When

`overrides: { '<address>': { name: '<portal name>' } }` makes the address read the portal resource of that name on the target. When another address of the same type, on the same object, already has that name and no name override of its own on the target, both addresses would read the same portal resource. So would two name overrides with the same value, an override to the address's own name included. `validate` and every command that validates first report it.

Swapping two names is fine: give each address its own name override.

## Fix

Give the other address its own name override on the target, give each of two overrides its own portal name, or rename one of the two in config.

## Example

```ts
overrides: { 'property:deals/term_days': { name: 'amount' } },
```

```
kalup.config.ts:8: E_OVERRIDE_NAME: the name override for property:deals/term_days on target sandbox is 'amount', the name of property:deals/amount, which has no name override there (fix: give property:deals/amount its own name override on sandbox, or rename one of the two in config) (docs: errors/E_OVERRIDE_NAME.md)
```
