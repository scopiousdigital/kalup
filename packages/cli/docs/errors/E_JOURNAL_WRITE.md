# E_JOURNAL_WRITE

`kalup apply` could not write a line of its journal. Exit 1, or 5 when a write had already been sent.

## When

Apply records every request in `.kalup/journal/portal-<id>/` and flushes the line to disk before the next request goes. When a line cannot be written (a full disk, a directory without write permission), apply sends no further request. It still saves state for what it verified and records the outcome.

## Fix

Make the journal directory writable and check the disk has room. Then run `kalup plan`: it compares the portal with the state that was kept and shows what is left.

## Example

```
E_JOURNAL_WRITE: the journal .kalup/journal/portal-2222222/pl_7f3a1c07b2e4-20260924T100000000Z.jsonl could not be written (ENOSPC: no space left on device, write), so the run stopped before its next request (fix: make the journal directory writable, then run kalup plan to see what the portal holds and what is left) (docs: errors/E_JOURNAL_WRITE.md)
```
