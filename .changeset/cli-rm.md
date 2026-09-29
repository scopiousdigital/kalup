---
"kalup": minor
---

`kalup rm <address> [--release]` takes a property or property group out of config and writes its tombstone in `kalup/removed.ts` (ADR 0002). It works offline: no key, no request, no state.

- `destroy` by default, `release` with `--release`. An address already tombstoned gets its action changed; an address config does not define gets the tombstone alone.
- Refuses a destroy of a resource with `preventDestroy` (`E_PREVENT_DESTROY`) and a group or property other config still uses (`E_RM_DEPENDENTS`), both exit 3.
- Validates the project as it would leave it, copies each file to `.kalup/history`, and writes all files through one staged write that puts every file back on a failure (`E_PROJECT_WRITE`).
- `pull` reports a tombstoned address it would otherwise add as `removed`, never a difference. A tombstoned group is never written back: a new portal property in it is left out (`removed-group`, never a difference), and a file property HubSpot moved into it keeps the file's group (a difference).
- An object split across exports or files: rm edits the export that defines the address. Removing an export's last property leaves it with no `properties` block, which `defineObject` now accepts.
- New shipped page `docs/rm.md`, listed in the AGENTS.md block. AGENTS.md rule 3 now says: apply only to targets the user names, never pass `--approve`, and show the user the command when apply exits 4.
