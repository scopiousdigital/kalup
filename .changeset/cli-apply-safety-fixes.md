---
"@kalup/core": patch
"kalup": patch
---

`kalup apply` adopts an existing custom object, checks a saved plan's bindings and deletes against the project, and keeps keys with a line break out of every request and message.

- Apply adopts an existing custom object and records its base, so a first apply of a project with a custom object in scope succeeds. Groups and properties on a custom object are created with its type ID. A custom object schema is still never written.
- Apply rebuilds every name binding from the target's name overrides in `kalup.config.ts`, and every custom object type ID from the schemas list. A plan that binds an address to another portal resource, or in which two steps resolve to one, is refused before any write (`E_BINDING_CHANGED`). The terminal confirmation and the results show the portal name next to the address when the two differ.
- Before approval, apply reads `kalup/removed.ts` and the object files as data and refuses a delete step whose address has no `destroy` tombstone, is still in config, or sets `preventDestroy` (new `E_PLAN_DELETE`). A delete whose `expect` leaves out a field the state entry's base holds is refused (`E_PLAN_RISK`), so an edit in HubSpot after the review stops it.
- A read or write key that holds a line break or another character a request header cannot carry is refused, naming the variable and never the value (new `E_KEY_INVALID`). The key is cut out of network error text both before and after control characters are stripped.
- `credentials.*.env` must be an environment variable name (`E_NOT_DATA`, exit 3), and `E_MISSING_KEY` never quotes a value that looks like a key.
- When config does not set `protected`, every account type but `DEVELOPER_TEST`, `SANDBOX` and `APP_DEVELOPER` is protected, an unknown type included; `status` reports the same. `target rebind` accepts only `DEVELOPER_TEST` and `SANDBOX` accounts (`E_REBIND_STANDARD`).
- `--out` refuses a path inside `.kalup/` (except `.kalup/snapshots/`), the lock directory or `KALUP_STATE_DIR` (`E_USAGE`). `E_STATE_INVALID` names the `.bak` file before it suggests `state rebuild`.
- Two signals within a second are one interrupt, as `npx` delivers a Ctrl-C twice: the run stops cleanly, saves state and prints its summary. A later second signal still exits at once.
- `kalup apply` without a plan file says which target it chose and how. `W_UNFINISHED_APPLY` says "at" the time of the last save. A read-back that waits more than a few seconds prints one line on stderr, in human mode only.
- Printed commands quote a selector with `#`, so they run under zsh.
