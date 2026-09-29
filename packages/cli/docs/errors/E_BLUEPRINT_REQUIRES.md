# E_BLUEPRINT_REQUIRES

A blueprint needs a custom object config does not define. Exit 1. Nothing was written.

## When

A blueprint's resources and its `requires` list name objects. A standard object (contacts, companies, deals, tickets and the rest) is always there, and `kalup add` adds it to `objects` in `kalup.config.ts` when missing. A custom object has to exist in the portal and in config first: Kalup does not create custom object schemas, so the blueprint's properties would have nowhere to go.

## Fix

Create the custom object in HubSpot, add its key under `objects` in `kalup.config.ts`, run `kalup pull` to write its object file, then run the command again.

## Example

```
E_BLUEPRINT_REQUIRES: the blueprint needs the custom object vineyard, which config does not define. Nothing was written. (fix: add vineyard: {} under objects in kalup.config.ts and run kalup pull to write its object file, or create the object in HubSpot first) (docs: errors/E_BLUEPRINT_REQUIRES.md)
```
