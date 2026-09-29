---
"kalup": minor
---

`kalup state rebuild [--target <name>] [--write]` reports which config resources the target's portal holds by name, with how many units agree, which are missing, and which state entries are stale (ADR 0021). With `--write`, only for a person at a terminal and never with `--yes` or `--approve`, it archives the state file and writes a new lineage that adopts every config resource the portal holds, with a base where config and the portal agree. Tombstoned addresses are never adopted. `--write` refuses an incomplete read (`E_INCOMPLETE`), since the new lineage would drop entries it could not check, and a state file another command changed after the report was shown (`E_STATE_CHANGED`); both write nothing. When the new file fails to save after the archive, `E_STATE_WRITE` says no state file is left and names the archived one.

`kalup status` now reads the pinned portal's state file and prints its path, lineage, serial and last apply, with "an apply did not finish; run kalup plan" for a run left `running`. The JSON `state` of each target is now an object (`path`, `exists`, `lineage`, `serial`, `lastApply`, `error`) instead of `none` or `present`.

New shipped page `docs/state.md`.
