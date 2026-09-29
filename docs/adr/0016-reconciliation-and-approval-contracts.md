# 0016. Preserve intent and coordinate approved execution

## Status

accepted

## Date

2026-09-22

## Context

The product review reproduced formatting that changes field ownership, pull output that fails validation, and a CI check that reports success with a configured resource missing. The planned CI recipe detects concurrent applies only when state is pushed after portal writes. The proposed approval hash omits the destination, while ADR 0010 contradicts ADR 0004 about whether apply needs config.

## Decision

- Explicit definition values, including empty strings, false and empty arrays, preserve ownership through formatting and loading. Only semantically equivalent defaults may be omitted.
- Pull validates the complete candidate project before saving any changed file.
- Observation distinguishes absent resources from unreadable or unsupported resources and fields. An incomplete read cannot establish equality or authorize a create. Machine results carry completeness separately from successful command execution.
- Cooperating writers coordinate by portal before apply reads mutable state and verifies the saved plan. The coordination remains held through execution and state persistence. A Git push conflict is a persistence failure after side effects, not a lock.
- Approval binds to the portal, target policy, state lineage, relevant bindings, portal writes and ownership changes such as adoption or release. Changes to titles, timestamps and unrelated held fields do not invalidate approval.
- Apply uses the saved plan, trusted execution policy, credentials, state and fresh observations. It never loads current config or silently replaces the approved intent. Risk, titles and execution decisions are derived or checked by trusted code.
- Full replacement writes check the complete write footprint and use provider revisions where supported. Read-then-write without a provider revision is not atomic with HubSpot UI edits; recovery and coverage docs state that limit.
- Creation and activation are separate operations when an asset can send messages or trigger automation. A configuration restore does not undo effects on records or recipients.

This supersedes the post-write concurrency assumption in ADR 0001, the writing-steps-only approval digest in ADRs 0004 and 0010, and the config-recomputation clause in ADR 0010. The remaining decisions in those ADRs stand; accepted records remain unchanged.

## Consequences

- The detailed saved-plan schema must contain the execution context needed to check these rules. Finalize and test that schema before publishing a compatibility promise for it.
- Prove a resource with a server-assigned identity and cross-target references before declaring the contracts sufficient for broader resources.
- Test concurrent writers, stale approval, incomplete reads, and interruption between a successful portal write and state persistence.
- A checkout-local file lock covers only that checkout. The documented CI recipe requires one authoritative writer; shared hosted coordination follows in its own milestone.
- Use the same planner and executor from CLI, MCP and UI. The host supplies credentials, approval and storage; terminal prompts do not belong in the engine.
