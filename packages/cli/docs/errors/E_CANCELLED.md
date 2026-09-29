# E_CANCELLED

The person at the terminal cancelled, or a signal stopped `kalup apply`. Exit 1, or 5 when apply had already written.

## When

`pull`, `plan`, `snapshot` or `apply` asked which target to use, and got the end of input (Ctrl-D), Ctrl-C, or three answers that were neither a listed number nor a target name. Nothing was read or written.

`kalup apply` asked the person to type the target name, and the number of destructive steps when there are any, and the answer did not match or the input ended. Nothing was written.

SIGINT or SIGTERM during `kalup apply`: it let the request in flight settle, sent nothing more, saved state and released the lock. A second signal stops at once.

## Fix

Run the command again and answer, or pass `--target <name>`. Set `defaultTarget` in `kalup.config.ts` to stop the question. After a stopped apply, run `kalup plan` to see what is left.

## Example

```
E_CANCELLED: Not applied: the answer was not the target name. Nothing was written. (docs: errors/E_CANCELLED.md)
```
