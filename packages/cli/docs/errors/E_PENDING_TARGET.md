# E_PENDING_TARGET

The command needs the portal of a target that has no `portalId` yet. Exit 3. Nothing was sent.

## When

`kalup init` without `--portal` writes a pending target: a name and no `portalId`, since init never asks HubSpot. `validate`, `ir`, `fmt`, `rm`, `add` and `docs` work with it. A command that reads or writes the portal (`pull`, `plan`, `apply`, `compare`, `snapshot`, `state rebuild`, `target rebind`) refuses it before any request, because the portal guard has nothing to check the key against. `status` lists it as pending.

## Fix

Set `targets.<name>.portalId` in `kalup.config.ts` to the Hub ID from the HubSpot account menu, then run the command again.

## Example

```
kalup.config.ts: E_PENDING_TARGET: target production has no portalId yet, so pull cannot check the key against its portal. Nothing was sent. (fix: set targets.production.portalId in kalup.config.ts to the Hub ID from the HubSpot account menu) (docs: errors/E_PENDING_TARGET.md)
```
