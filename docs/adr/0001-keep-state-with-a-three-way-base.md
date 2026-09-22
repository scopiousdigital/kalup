# 0001. Keep state with a three-way base

## Status

accepted

## Date

2026-09-22

## Context

The first draft was stateless: git was the history, every plan was a live diff of config against the portal. That works for the CRM data model, where the caller sets the internal name. It breaks for lists, forms, workflows and teams, which get a server-assigned ID and an editable name, so a rename reads as delete plus create. It also breaks two-way sync: the draft's `pull` let the portal win and its `apply` let config win, and nobody defined what happens when both sides changed.

Three designs were compared against the daily cases (an admin edits a label in the UI, a colleague applies from another branch, a list is renamed): bindings-only, an ID map with no values; snapshot-based, a full pull saved as the merge base; three-way state, the last-applied values of owned fields per target. Only the third answers "who moved this value?" and holds the admin's label instead of reverting it.

## Decision

Kalup keeps state per target in `.kalup/state/<target>.json`, format `kalup.state/1`. `init` gitignores it, it never lives on a working branch, and it is never stored inside the HubSpot portal.

```json
{
  "format": "kalup.state/1",
  "lineage": "b0a1c6e2",
  "serial": 42,
  "target": { "name": "production", "portalId": 2222222 },
  "resources": {
    "property:companies/billing_status": { "origin": "adopted", "id": "billing_status", "via": "public-api", "normVersion": 1,
      "base": { "label": "Billing status", "options": { "active": { "label": "Active" } } } },
    "team:sales_emea": { "origin": "reference", "id": "8841" }
  }
}
```

Per resource address: `origin` (`created`, `adopted`, `reference`), `id` (`null` for runbook-only types), `via` (transport of the last write), `normVersion`, and either `base` (last-applied normalized values of owned fields, keyed sets as maps by member key) or `baseHash` for opaque payloads and runbook types, plus `attested { by, at }` for runbook types. Top level also holds `lastApply { planId, commit, actor, at }`. `lineage` is new on rebuild and rebind; plans from an older lineage are refused. `serial` is for compare-and-swap only.

The engine never sees the store. It goes through `StateStore` (`read`, `write` with an expected serial, `lock`), which the open-source `FileStateStore` implements with write-to-temp-then-rename, one `.bak` and an exclusive-create lock.

Rules:

1. Safety never depends on state. A missing or stale base makes `plan` hold and ask, never overwrite.
2. Only `apply` and the repair commands (`bind`, `attest`, `state rebuild`, `target rebind`) write base. `pull` may add a binding and never touches base.
3. The base moves forward only where config and portal agree (`advanceBase`, on each read-back and once at the end of every apply). Held drift and failed steps leave it alone.
4. A `normVersion` mismatch makes the base count as absent for that type for one cycle. No migration code.

State never holds tokens, credentials, record data, unowned fields or unmanaged resources. Every base value once stood in config.

## Alternatives considered

- **Stateless (the first draft).** Cannot tell whether config or the portal moved a value, so `pull` wiped unapplied config edits and `apply` reverted UI edits. Rejected.
- **Bindings-only.** Cheapest to build, but the admin's label edit is proposed for revert. The only fix is a base, which turns it into this design. Rejected; its tombstones were kept.
- **Snapshot-based.** Its base rule was right and is adopted. The rest costs a full pull per cycle, six store methods and retention, to reach what base values give directly. Rejected as the merge base; the snapshot stays as its own artifact for `compare` and `docs`.
- **Fingerprints in place of values.** As large as the values per option, and hashes cannot survive a normalizer change. Rejected.
- **State on the working branch, or in the CI cache.** A forked record of one portal; caches get evicted. Rejected.

## Consequences

- State size follows config, not portal size.
- Free CI users keep state on a `kalup-state` branch checked out as a worktree at `.kalup/state`. A rejected push means a concurrent apply. Nothing to build.
- Every resource type needs a faithful normalizer. A sloppy one makes phantom drift, which costs trust faster than missing drift detection does.
- `kalup state rebuild` recovers lost state: natural resources return as `adopted`, bound ones bind on a unique name match. Lost for good: the `created` label, bindings of renamed bound resources, attestations.
- State stays local per checkout. When two branches share one sandbox, B's plan holds A's applied changes as drift and never reverts them; A's new property is unmanaged to B until the merge. The docs push toward one test account per developer.
- Dropping the base later leaves a working bindings file. Adding it later would have been a format break.
