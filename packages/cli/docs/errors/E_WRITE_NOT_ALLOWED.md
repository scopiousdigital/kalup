# E_WRITE_NOT_ALLOWED

Kalup refused to send a write that this run may not send. Exit 1. Nothing was sent.

## When

A run that writes gets an explicit list of the writes it may send. This version allows creating, updating and archiving properties and property groups, and creating, updating and deleting pipelines and stages, and nothing else: no custom object schema writes and no pipeline replace (PUT). A request to any other write path, or to a read path through the write channel, is refused before it leaves Kalup.

## Fix

This is a bug in Kalup. Report it with the command you ran.

## Example

```
E_WRITE_NOT_ALLOWED: POST /crm-object-schemas/2026-09/schemas (object create) is not a write this run may send. Nothing was sent. (docs: errors/E_WRITE_NOT_ALLOWED.md)
```
