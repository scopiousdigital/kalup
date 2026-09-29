# E_WRITE_IN_READ_MODE

Kalup refused to send a request to a write path through a read client. Exit 1. Nothing was sent.

## When

Every command that only reads (`pull`, `plan`, `status`, `compare`, `snapshot`, `init`) goes through a client that allows only paths tagged `read`, so none of them can reach a write path. Only `kalup apply` opens a write client, and it may send only the property and group writes on its own list (see `E_WRITE_NOT_ALLOWED`).

## Fix

This is a bug in Kalup. Report it with the command you ran.

## Example

```
E_WRITE_IN_READ_MODE: POST /crm/properties/2026-09/{objectType} is a write path and this client only reads. (docs: errors/E_WRITE_IN_READ_MODE.md)
```
