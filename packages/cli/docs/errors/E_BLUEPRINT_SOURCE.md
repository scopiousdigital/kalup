# E_BLUEPRINT_SOURCE

A blueprint source could not be read. Exit 1. Nothing was written.

## When

A source is a path to a JSON file, relative to the current directory, or an `https://` URL. Kalup refuses anything else (an `http://` URL, a registry name), a missing file, a URL that answers with an error status or does not answer within 30 seconds, a redirect to a location that is not https, and a file or body over 1 MB. It also refuses a URL with credentials or a query string: the lock records the source. `kalup blueprint upgrade` also refuses a source that holds another blueprint than the name it was given. A URL fetch sends no key and no header but `accept`.

## Fix

Pass a path to the blueprint file, or an https URL that serves it. For a private URL, download the file and pass its path. Check the name against `hubspot/blueprints.lock.json` for an upgrade.

## Example

```
E_BLUEPRINT_SOURCE: http://blueprints.example.com/renewals.json is not an https URL; Kalup fetches blueprints over https only (fix: pass a path to a blueprint JSON file, or an https:// URL that serves one) (docs: errors/E_BLUEPRINT_SOURCE.md)
```
