# State

Kalup keeps what it knows about each portal in `.kalup/state/portal-<portalId>.json`: which resources it created or adopted there, and per unit the value config and the portal last agreed on (the base). `plan` reads it; `apply`, `state rebuild --write` and `target rebind` write it, and `pull` records the units the files and the portal agree on (pull.md): an address no entry owns gets origin `pulled`, which owns nothing. The first pull that creates the file prints its path. Every worktree of one clone shares it, when the main checkout holds the project and ignores its `.kalup/`; otherwise a worktree keeps its own. `KALUP_STATE_DIR` moves it.

`state: 'repo'` in `kalup.config.ts` keeps the files in `state/` inside the folder of object files (`hubspot/state/portal-<portalId>.json`), committed, so teammates and CI share bases and ownership. The trade-off: every apply, and every pull that records a base, changes a committed file, so two branches applying to one portal conflict in git. Kalup does not detect a stale or wrongly merged file: one from an older commit, or a conflict resolved to the wrong side, passes every command, and what it no longer records comes back as adopt steps. After a state merge conflict, keep the side that applied last, then run `kalup state rebuild` to see what the file lacks (`--write` rebuilds it from the portal). Before the first run with `state: 'repo'`, move `.kalup/state/portal-<id>.json` to `<dir>/state/`; until you do, commands warn `W_STATE_NOT_MOVED` and start from no state. The file holds no key and no record data. The portal lock, the journal and archived files stay local, and a save keeps no `.bak`: git holds the previous version. Never edit it by hand. `kalup status` prints its path, lineage, serial and last apply per target; "an apply did not finish" means run `kalup plan`.

This page is the reference. For the walk-through with examples, see [kalup state](https://kalup.dev/docs/commands/state) on the website.

## state rebuild

`kalup state rebuild [--target <name>] [--write] [--json]` rebuilds state from what the portal holds by name.

Without `--write` it is read-only: it checks the read key's portal, reads the target as `plan` does, and reports:

- `found`: config resources the portal holds, with how many units config and the portal agree on.
- `missing`: config resources a complete read did not find.
- `stale`: current entries that record another portal name, whose resource the portal no longer holds, or whose address is no longer in config.
- `excluded`: tombstoned addresses, skipped ones, ones the read could not see or does not trust yet because they are settling after an apply (plan.md), and ones Kalup does not write.

With `--write`, only a person at a terminal may run it (else `E_APPROVAL_REQUIRED`, exit 4); `--yes` and `--approve` are refused. It checks the write key's portal and refuses a read that left out what config names (`E_INCOMPLETE`: a rebuild would drop what it could not check): a list it could not read, a property it could not capture, a resource settling after an apply (run it again after the time it names), or an association a type HubSpot does not name yet may be. What settles where config names nothing does not stop it. It shows the report and what the current file loses for good (the `created` origin, agreed values, entries not in config), asks for the target name, takes the portal lock, refuses a state file changed since the report (`E_STATE_CHANGED`), archives the current file under `.kalup/state/archive/` (ending its lineage; also with `state: 'repo'`), and writes a new lineage at serial 1: an `adopted` entry for every found resource, with a base for the units that agree. A tombstoned address is never adopted. Nothing is sent to the portal.

Plans saved before a rebuild are refused by apply (`E_STATE_CHANGED`); plan again.

## target rebind

`kalup target rebind <target> --portal <id>` moves a target to a recreated test portal or sandbox (targets.md): at a terminal only, and only to a `DEVELOPER_TEST` or `SANDBOX` account (`E_REBIND_STANDARD`). It takes both portal locks in ascending portal ID order, checks that the old portal's state file is readable and the read complete, reports how many managed resources the new portal holds by name, asks for the target name, writes the new portal's state as `--write` does, writes the new `portalId` into `kalup.config.ts` (validated, with a history copy), and archives the old portal's state file.

## Output

`--json` data for rebuild: `target`, `portalId`, `statePath`, `found`, `missing`, `stale`, `excluded`, `loses` and `written`, always `false`, since `--write --json` exits 4. Rebind with `--json` exits 4 with no data.

## Exit codes

| Exit | When |
|---|---|
| 0 | Reported, or written |
| 1 | `E_USAGE`, `E_CANCELLED`, `E_MISSING_KEY`, `E_LOCKED`, `E_INCOMPLETE`, `E_STATE_CHANGED`, `E_STATE_INVALID`, `E_STATE_WRITE`, a failed request |
| 3 | Config invalid, `E_DUPLICATE_PORTAL` |
| 4 | `E_APPROVAL_REQUIRED` (no terminal), `E_TARGET_PORTAL_MISMATCH`, `E_REBIND_STANDARD` |
