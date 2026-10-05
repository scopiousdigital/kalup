# E_UNKNOWN_OBJECT

A key under `objects` is neither a standard object nor a custom object in the portal. Exit 3. Nothing is written.

## When

A key that is not a standard object name (`contacts`, `companies`, `deals`, `line_items` and the rest, plural) is read as a custom object. None of the portal's custom objects has that name, and config defines none either. A key a `defineCustomObject` in config backs is never this code: `pull` reports that object missing in portal and leaves its file as it is, `plan` creates it, and `compare` finds it on the config side only. A key whose object `hubspot/removed.ts` names is left out by `pull` too, whether or not HubSpot still holds it.

## Fix

Use one of the names the message lists, or remove the key. Standard objects use HubSpot's plural API name: `companies`, not `company`.

## Example

```
kalup.config.ts:8: E_UNKNOWN_OBJECT: 'presses' is not a standard object or a custom object in the portal (custom objects: harvest, press_run) (fix: use one of the names listed, or remove the key) (docs: errors/E_UNKNOWN_OBJECT.md)
```
