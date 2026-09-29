# W_LIMIT_HEADROOM

A warning from `plan`: HubSpot reports room for fewer custom properties than the plan creates. Exit stays 0.

## When

Before it plans, `plan` reads HubSpot's Limits Tracking API for the custom property limit when the plan creates a property. It does not read the custom object limit, since custom object creates are unsupported. Properties count against the portal's limit and against their object's own limit, standard or custom, when HubSpot lists one. When the limit minus the usage is above 0 but below the number of creates, every create stays in the plan and the ones past the limit would fail. When nothing is left, each create is blocked with reason `limit` instead.

A reading HubSpot refuses, or answers without a limit and usage, is unreadable and blocks nothing (`W_LIMIT_UNREADABLE`).

## Fix

Leave some of the creates out on this target: add `{ '<address>': { skip: true } }` under `targets.<target>.overrides` for each one.

## Example

```
W_LIMIT_HEADROOM: the plan creates 3 custom properties and HubSpot reports room for 2 more (limit 1000, 998 in use) (fix: leave some of them out on this target with skip overrides under targets.sandbox.overrides) (docs: errors/W_LIMIT_HEADROOM.md)
```
