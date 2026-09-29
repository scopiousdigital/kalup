# E_STATE_CONFLICT

The state file changed while this command ran, so its save was refused. Exit 1.

## When

Every state save compares serials: the file must still hold the serial the command read before it started. Another Kalup command saved state for the same portal in between, or someone replaced the file. Nothing was saved, and the file keeps what the other writer put there.

## Fix

Run `kalup plan` again. It reads the new state and shows what is left to do. Two commands that write to one portal should not run at once; the portal lock keeps them apart on one machine.

## Example

```
.kalup/state/portal-2222222.json: E_STATE_CONFLICT: .kalup/state/portal-2222222.json changed while this command ran: its serial is 8, not 7. Nothing was saved. (fix: another kalup command wrote state for portal 2222222; run kalup plan again) (docs: errors/E_STATE_CONFLICT.md)
```
