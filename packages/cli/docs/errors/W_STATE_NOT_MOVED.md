# W_STATE_NOT_MOVED

A warning from `status`, `pull`, `plan` and `apply`: with `state: 'repo'` the portal has no state file beside the object files, but `.kalup/state/` holds one. Exit stays 0.

## When

`state: 'repo'` moves where Kalup reads and writes state, from `.kalup/state/` to `<dir>/state/`. Kalup does not move the file for you. Until it is moved, every command starts from no state: what Kalup created plans as adopt steps, and a value you changed in a file is held as diverged instead of planned as an update.

## Fix

Move the file the warning names before the next apply, for example `mkdir -p hubspot/state && mv .kalup/state/portal-2222222.json hubspot/state/portal-2222222.json`, then commit it. If a `pull` already wrote a new file there, the move replaces it, which is what you want: the old file keeps what Kalup created and the values it last applied.

## Example

```
hubspot/state/portal-2222222.json: W_STATE_NOT_MOVED: state: 'repo' reads hubspot/state/portal-2222222.json, which does not exist, but .kalup/state/portal-2222222.json holds the state from before the switch; this command starts from no state (fix: move it before the next apply: mkdir -p hubspot/state && mv .kalup/state/portal-2222222.json hubspot/state/portal-2222222.json) (docs: errors/W_STATE_NOT_MOVED.md)
```
