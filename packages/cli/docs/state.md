# State

Kalup keeps what it knows about each portal in `.kalup/state/portal-<portalId>.json`: which resources it created or adopted there, and per unit the value config and the portal last agreed on (the base). `plan` and `pull` read it; only `apply`, `state rebuild --write` and `target rebind` write it. Every worktree of one clone shares it; `KALUP_STATE_DIR` moves it. Never edit it by hand. `kalup status` prints its path, lineage, serial and last apply per target; "an apply did not finish" means run `kalup plan`.

## state rebuild

`kalup state rebuild [--target <name>] [--write] [--json]` rebuilds state from what the portal holds by name.

Without `--write` it is read-only: it checks the read key's portal, reads the target as `plan` does, and reports:

- `found`: config resources the portal holds, with how many units config and the portal agree on.
- `missing`: config resources a complete read did not find.
- `stale`: current entries that record another portal name, whose resource the portal no longer holds, or whose address is no longer in config.
- `excluded`: tombstoned addresses, skipped ones, and ones the read could not see or no builder carries.

With `--write`, only a person at a terminal may run it (else `E_APPROVAL_REQUIRED`, exit 4); `--yes` and `--approve` are refused. It checks the write key's portal and refuses an incomplete read (`E_INCOMPLETE`: a rebuild would drop what it could not check). It shows the report and what the current file loses for good (the `created` origin, agreed values, entries not in config), asks for the target name, takes the portal lock, refuses a state file changed since the report (`E_STATE_CHANGED`), archives the current file under `.kalup/state/archive/` (ending its lineage), and writes a new lineage at serial 1: an `adopted` entry for every found resource, with a base for the units that agree. A tombstoned address is never adopted. Nothing is sent to the portal.

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
