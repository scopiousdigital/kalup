# E_PROJECT_WRITE

A command could not write the project files it changes. Exit 1.

## When

`kalup rm`, `kalup pull`, `kalup target rebind`, `kalup add` and `kalup blueprint upgrade` change several files as one: each file is copied to `.kalup/history`, written to a temporary name beside it, then renamed over the old one. When a history copy, a write, a rename or the removal of an old blueprint original fails, for example on a full disk or a read-only directory, every file already renamed gets its previous text back and the temporary files are removed, so the project is left as it was. The message says so, or names any file that could not be put back; its previous text is under `.kalup/history`.

## Fix

Check that the project directory is writable and the disk has room, then run the command again.

## Example

```
E_PROJECT_WRITE: could not write hubspot/index.ts, hubspot/objects/companies.ts, hubspot/removed.ts (ENOSPC). Every file was left as it was. (fix: check that the project directory is writable and the disk has room, then run the command again) (docs: errors/E_PROJECT_WRITE.md)
```
