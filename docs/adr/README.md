# Architecture decision records

An ADR records one decision that shapes Kalup: the situation, the choice, the options that lost and why, and what the choice costs. ADRs are short, numbered and never edited after acceptance. A change of mind gets a new ADR that supersedes the old one.

Status values:

- `accepted`: in force. Build to it.
- `proposed`: written down, not yet decided by the founder.
- `superseded`: replaced. The record names its successor.

Rule for agents: do not re-argue an accepted ADR without a new fact (a measurement, a HubSpot change, a live test result). Cite the fact, then propose a superseding ADR.

Current updates from the accepted product review:

- [0015: agency-first release sequence](0015-agency-first-release-sequence.md) puts the local MVP and blueprint upgrades before the full SDK and cloud expansion.
- [0016: reconciliation and approval contracts](0016-reconciliation-and-approval-contracts.md) supersedes the post-write coordination assumption in 0001 and the approval/config-recomputation clauses identified in 0004 and 0010. Their other decisions remain in force.
- [0017: oclif command layer](0017-oclif-command-layer.md) accepts the TypeScript CLI framework and replaces only 0008's single-dynamic-import restriction. Config non-execution and the engine boundary remain in force.
- [0018: block on limits, keep structured values exact, give snapshots a time](0018-limits-exact-values-and-snapshot-time.md), accepted on 2026-09-24, replaces the blocked reason `tier` with `limit` (the tier wording in 0007), limits sanitizing to human text while structured values stay exact (the sanitizer clauses in 0009), and lets a snapshot carry `observedAt`, the one timestamp in an IR document (the no-timestamps rule in 0004).
- [0019: held units on a shadowed name carry no pull command](0019-held-units-without-a-pull-on-shadowed-names.md), accepted on 2026-09-24, makes `resolve` optional on a `plan/1` held unit (the "two commands" and "both exits" clauses in 0005).
- [0020: target selection](0020-target-selection.md), accepted: `--target`, else `defaultTarget`, else the only target, else a choice at a terminal, else an error. No target name carries meaning.

Proposed, awaiting the founder's decision (implemented to them under the v1 assignment):

- [0021: apply, state by portal, one approval contract, serial execution and re-plan recovery](0021-apply-state-approval-and-recovery.md) amends 0001 (state path, serial, per-checkout state, rebuild), 0005 (recreating a resource deleted in HubSpot), 0009 and 0010 (a reviewed CI job may apply risky steps with `--approve`; deletes always need a person at a terminal).
- [0022: per-target definition overrides replace whole fields](0022-definition-overrides.md) specifies the `definition` override that 0004 and the architecture left on paper.

Milestone references in older records describe the sequence at acceptance. The current [roadmap](../roadmap.md) owns delivery order and scope; keep historical records intact.
