# E_LOCK_DIR

The lock directory cannot be written. Exit 1. No write was sent.

## When

Commands that write to a portal lock it with a file in a per-user directory: `~/.kalup/locks`, or `KALUP_LOCK_DIR` when it is set. Kalup could not create that directory or a file in it (no permission, a read-only file system, or a path under a file). It never falls back to a directory in the project, because then two clones of one project would not see each other's locks.

## Fix

Set `KALUP_LOCK_DIR` to a directory this user can write, outside the project, or fix the permissions of `~/.kalup/locks`. Every Kalup command that writes to the same portal on this machine must use the same directory.

## Example

```
E_LOCK_DIR: the lock directory /home/dana/.kalup/locks cannot be written (EACCES). (fix: set KALUP_LOCK_DIR to a directory this user can write, outside the project) (docs: errors/E_LOCK_DIR.md)
```
