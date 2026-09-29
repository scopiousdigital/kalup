# E_APPROVAL_REQUIRED

Nothing approved this plan. Exit 4, `humanRequired: true`. Nothing was written.

## When

A plan with any effect needs one approval. A person at a terminal (stdin and stderr are terminals, no `--json`, `CI` unset) confirms it by typing the target name. `--yes` covers only an unprotected target, with no risky or destructive step, and at most 25 writes, adoptions and releases. Every delete, on every host, needs a person at a terminal who also types the number of destructive steps. Otherwise apply stops here, and the message says which condition failed. `kalup state rebuild --write` and `kalup target rebind` run only for a person at a terminal, and stop here otherwise.

## Fix

Stop. Hand the command in the fix to the user, who runs it in a terminal and confirms it there. Agents never approve on the user's behalf.

## Example

```
E_APPROVAL_REQUIRED: --yes does not cover this plan: s1 (risky) is not safe. (fix: ask the user to run kalup apply plan.json in a terminal, where they confirm it) (docs: errors/E_APPROVAL_REQUIRED.md)
```
