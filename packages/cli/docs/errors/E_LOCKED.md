# E_LOCKED

Another Kalup command holds the lock of this portal. Exit 1. Kalup does not wait.

## When

Commands that write to a portal take a lock named by the portal ID before they read state, and hold it until state is saved. The lock is a file in `~/.kalup/locks` (or `KALUP_LOCK_DIR`) that names the holder's command, plan, host, process ID and start time. It keeps apart the writers of one user on one machine, across clones, worktrees and target names. A lock whose holder has ended on this host is taken over. A lock from another host, or one that cannot be read, is never taken over.

## Fix

Wait for the other command to finish, then run yours again. If no Kalup command is running on the host the message names, the lock was left behind: delete the file the fix names.

## Example

```
E_LOCKED: portal 2222222 is locked by kalup apply for plan pl_7f3a1c07b2e4 on build-agent-7, pid 4242, since 2026-09-24T10:00:00.000Z. (fix: wait for it to finish; if no kalup command is running on build-agent-7, delete /home/dana/.kalup/locks/portal-2222222.lock) (docs: errors/E_LOCKED.md)
```
