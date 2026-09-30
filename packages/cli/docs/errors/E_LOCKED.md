# E_LOCKED

Another Kalup command holds the lock of this portal. Exit 1. Kalup does not wait.

## When

Commands that write to a portal or its state take a lock named by the portal ID before they read state, and hold it until state is saved: `apply`, `state rebuild --write`, `target rebind`, and `pull` whenever it may record bases (not with `--check` or `--discover`). The lock is a file in `~/.kalup/locks` (or `KALUP_LOCK_DIR`) that names the holder's command, plan, host, process ID and start time. It keeps apart the writers of one user on one machine, across clones, worktrees and target names. Kalup never takes a lock over, even when its holder has ended: a command that crashed or was killed leaves its lock behind until a person deletes it.

## Fix

Wait for the other command to finish, then run yours again. If no Kalup command is running on the host the message names, the lock was left behind: delete the file the fix names, then run yours again. Never delete it while that command runs.

## Example

```
E_LOCKED: portal 2222222 is locked by kalup apply for plan pl_7f3a1c07b2e4 on build-agent-7, pid 4242, since 2026-09-24T10:00:00.000Z. (fix: wait for it to finish; delete /home/dana/.kalup/locks/portal-2222222.lock only when no kalup command is running on build-agent-7) (docs: errors/E_LOCKED.md)
```
