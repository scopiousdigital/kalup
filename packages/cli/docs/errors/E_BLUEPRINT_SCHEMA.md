# E_BLUEPRINT_SCHEMA

A blueprint is not a valid `blueprint/1` document. Exit 1. Nothing was written.

## When

`kalup add` and `kalup blueprint upgrade` parse the source as JSON, never as code. Another `blueprintVersion` is refused first. Then they check `blueprint-1.schema.json` and the rules the schema cannot state: addresses of the form `group:<object>/<name>` or `property:<object>/<name>` that match their type, plain names that never start with a prefix HubSpot reserves, `hs_` or `a<digits>_` (a group `$ref` names a plain group too), unique option values, aliases that name an option, and a codec that fits the HubSpot type and field type. Text that is not JSON or UTF-8 is refused, and so are names a prefix makes invalid. Each issue names its path; quoted text is sanitized.

## Fix

A blueprint is third-party data: ask its author for a version that passes, `blueprint/1` for another version. If you maintain the blueprint, fix the field the issue names. For a prefix problem, pass another `--prefix`.

## Example

```
E_BLUEPRINT_SCHEMA: property name 'hs_renewal_flag' starts with hs_, a prefix HubSpot reserves (fix: a blueprint is third-party data: ask its author for a version that passes, or fix your own copy of the file) (docs: errors/E_BLUEPRINT_SCHEMA.md)
```
