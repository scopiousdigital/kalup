# E_PORTAL_ID

A target has no `portalId`, or it is not a positive integer. Exit 3.

## When

`portalId` pins the target to one portal. Every networked command checks the key against it.

## Fix

Set `portalId` to the Hub ID from the HubSpot account menu. Do not change a pin to make a mismatch go away; see E_TARGET_PORTAL_MISMATCH.md.

## Example

```
kalup.config.ts:10: E_PORTAL_ID: portalId 0 is not a positive integer (fix: set portalId to the portal ID shown in HubSpot, a positive integer) (docs: errors/E_PORTAL_ID.md)
```
