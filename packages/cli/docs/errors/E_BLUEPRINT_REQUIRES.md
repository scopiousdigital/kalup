# E_BLUEPRINT_REQUIRES

A blueprint needs a custom object config does not define. Exit 1. Nothing was written.

## When

A blueprint's resources and its `requires` list name objects. A standard object (contacts, companies, deals, tickets and the rest) is always there, and `kalup add` adds it to `objects` in `kalup.config.ts` when missing. A custom object has to be in config first: a blueprint carries no custom object schema, so its properties would have nowhere to go.

## Fix

Add the key under `objects` in `kalup.config.ts`. Define the object with `defineCustomObject` in its object file, or, when HubSpot has it already, run `kalup pull` to write that file. Then run the command again.

## Example

```
E_BLUEPRINT_REQUIRES: the blueprint needs the custom object vineyard, which config does not define. Nothing was written. (fix: add vineyard: {} under objects in kalup.config.ts and define it with defineCustomObject, or run kalup pull to write its object file when HubSpot has it) (docs: errors/E_BLUEPRINT_REQUIRES.md)
```
