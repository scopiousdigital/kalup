# W_PENDING_TARGET

A warning from `validate` and every command that validates: a target has no `portalId` yet. Exit stays 0.

## When

`kalup init` without `--portal` writes a pending target, since init never asks HubSpot. Commands that only read the files work; one that needs the portal refuses the target with `E_PENDING_TARGET`. A pending target is left out of the IR, and it pins no portal.

## Fix

Set `portalId` on the target to the Hub ID from the HubSpot account menu.

## Example

```ts
targets: {
  production: { credentials: { read: { env: 'HUBSPOT_SERVICE_KEY' } } },
},
```

```
kalup.config.ts:7: W_PENDING_TARGET: target 'production' has no portalId yet, so no command reads or writes its portal (fix: set targets.production.portalId to the Hub ID from the HubSpot account menu) (docs: errors/W_PENDING_TARGET.md)
```
