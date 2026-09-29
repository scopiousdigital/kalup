# E_UNCERTAIN_WRITE

HubSpot may or may not have applied a write. Exit 5. Kalup never sends it again.

## When

The write timed out, the network failed, HubSpot answered 5xx or a body that is not JSON, or it refused a create whose name then read back. HubSpot documents no idempotency keys, so a second attempt could fail on what the first made, or undo an edit made in between. Apply reads the resource back until a deadline of 60 seconds, and settles the step only when the approved values read back. Otherwise the step is `uncertain`, its state entry stays as it was, and steps that depend on it do not run.

## Fix

Run `kalup plan --target <name>`. It reads what HubSpot holds: a property the write made shows as an adopt, and anything not made shows again.

## Example

```
E_UNCERTAIN_WRITE: s2 Create property "Soil pH" (soil_ph) on companies: HubSpot may or may not have applied it (no read showed the approved values within 60 s). kalup never sends it again. (fix: run kalup plan --target sandbox: it reads what HubSpot holds and shows what is left) (docs: errors/E_UNCERTAIN_WRITE.md)
```
