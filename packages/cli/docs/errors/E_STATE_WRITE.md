# E_STATE_WRITE

State could not be saved or archived. Exit 1, or 5 when `kalup apply` had already written.

## When

A save writes a temporary file, flushes it, keeps the old file as `.bak` and renames the new one over it. When a step fails (a full disk, no write permission, a read-only file system), the old file stays as it was.

`state rebuild --write` and `target rebind` archive the old file first: when the new one fails to save, no state file is left, and the message names the archive. Until a state file exists again, the next plan proposes adopting every config resource the portal holds.

## Fix

Check that the state directory (`.kalup/state`, or `KALUP_STATE_DIR`) is writable and the disk has room, then run the command again. If `kalup apply` had already changed the portal, its message names the run's journal. Run `kalup plan`: it compares the portal with the state kept and shows what is left; a property the run created shows as an adopt, never a second create. After a rebuild or rebind, run it again, or move the archived file back to keep the previous state.

## Example

```
.kalup/state/portal-2222222.json: E_STATE_WRITE: .kalup/state/portal-2222222.json: could not save it (ENOSPC). The previous file is intact. (fix: check that the state directory is writable and the disk has room, then run the command again) (docs: errors/E_STATE_WRITE.md)
```
