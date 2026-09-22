# E_WRITE_IN_READ_MODE

Kalup refused to send a request to a write path. Exit 1. Nothing was sent.

## When

Every request goes through one HTTP layer that allows only paths tagged `read`. This version only reads, so no command should ever reach a write path.

## Fix

This is a bug in Kalup. Report it with the command you ran.

## Example

```
E_WRITE_IN_READ_MODE: POST /crm/properties/2026-09/{objectType} is a write path and this version only reads. (docs: errors/E_WRITE_IN_READ_MODE.md)
```
