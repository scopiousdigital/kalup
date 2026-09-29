# E_AUTH

HubSpot rejected the read key with a 401. Exit 1.

## When

A request from a command that reads a portal came back 401: the key is wrong, revoked or expired. `status` reports it for that target and checks the others.

## Fix

Check the key in the variable the target reads (`credentials.read.env`, or `HUBSPOT_SERVICE_KEY` when there is none). If it was revoked, a person creates a new one in HubSpot. When the request needed a scope, the fix names it.

## Example

```
E_AUTH: HubSpot rejected the key (401). (fix: Check that the key is valid and not expired. It needs the scope crm.schemas.companies.read.) (docs: errors/E_AUTH.md)
```
