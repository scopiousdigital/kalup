# E_UNKNOWN_INCLUDE

`objects.<key>.include` names properties that neither the portal nor the object files have. Exit 3. Nothing is written.

## When

`pull` checks every `include` name against the portal's property list for that object, after reading all objects.

A name the object files define is never unknown: pull reports it as missing in the portal and plan creates it. The files need no `include` for their own properties.

## Fix

Remove the names, or correct them to the internal names shown in HubSpot's property settings.

## Example

```
kalup.config.ts:6: E_UNKNOWN_INCLUDE: objects.companies.include names properties the portal does not have: plot_colour (fix: remove them, or check the internal names in HubSpot) (docs: errors/E_UNKNOWN_INCLUDE.md)
```
