# W_JSON_FIELDTYPE

A warning from validate: a `p.json` property whose `fieldType` is not `textarea`. Exit stays 0.

## When

JSON text is often longer than one line, so it belongs in a textarea.

## Fix

Set `fieldType: 'textarea'`.

## Example

```
hubspot/objects/companies.ts:24: W_JSON_FIELDTYPE: p.json 'orch_row_meta' has fieldType 'text'; JSON text belongs in a textarea (fix: set fieldType: 'textarea') (docs: errors/W_JSON_FIELDTYPE.md)
```
