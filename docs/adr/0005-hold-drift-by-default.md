# 0005. Hold drift by default

## Status

accepted

## Date

2026-09-22

## Context

Terraform treats every change made outside the config as drift to revert on the next apply. That model assumes the config is the whole truth and nobody touches the resource by hand. HubSpot is the opposite: admins, marketers and sales ops edit labels, options, pipelines and lists in the UI every day, for the life of the project. A tool that reverts those edits will be switched off within a month.

The first draft had the problem from both sides. Its `pull` let the portal win for every HubSpot-owned field, so an unapplied config edit was wiped. Its `apply` let config win, so a UI edit was reverted. Neither side asked who changed what. The three-way base (ADR 0001) makes that question answerable, and this ADR decides what to do with the answer.

## Decision

A unit is one owned top-level field, or one member of a keyed set (options by `value`, stages by `stageId`). For each unit the engine classifies:

| Base | Config vs base | Live vs base | Class | Default |
|---|---|---|---|---|
| any | config equals live | | `converged` | none |
| yes | changed | same | `config-change` | write |
| yes | same | changed | `drift` | hold |
| yes | changed | changed | `conflict` | hold |
| none | config differs from live | | `diverged` | hold |

Hold is the default for `drift`, `conflict` and `diverged`. A held unit is reported and not written. Held units never block other units or resources; the plan folds them into one line and `--json` lists each with its class, both values and the two commands that resolve it. The base does not move for a held unit, so an admin's edit stays held across any number of applies.

There are exactly two exits, and both are explicit:

- **Take the portal side.** `kalup pull --target production --only property:companies/billing_status#label` writes the live value into config. Config-change units keep config, so `pull` no longer wipes unapplied edits.
- **Take the config side.** `kalup plan --target production --take config property:companies/billing_status#label` adds a step labelled `reverts-ui-edit`. The person who approves that line is the one who picks.

Two settings change the default. A target may set `drift: 'overwrite'` in `kalup.config.ts`, which is the Terraform model and suits a personal sandbox. A resource may list `lifecycle: { ignoreChanges: ['description'] }`, which sets that field on create and then leaves it unowned.

Where the API returns `updatedAt` and `updatedUserId`, the drift report carries a `lastPortalEdit` hint so an agent can say "Dana changed this on Tuesday". It never changes what `plan` does.

## Alternatives considered

- **Overwrite by default, hold as opt-in.** Wrong default for the daily case. An unrelated CI merge would revert an admin's label. Rejected.
- **Push no-base differences as `risky` writes.** Free CI users with no persisted state would hit this mode most, and it reverts admin edits without saying so. Rejected. A missing base makes the tool more careful, never less.
- **Config always wins (bindings-only).** Cannot tell who moved a value, so it reverts. Rejected.
- **Report drift and offer no way out.** A held conflict with no command to settle it stalls the admin persona. Rejected. Both exits are named on every held line.
- **Per-object or per-group authority toggles.** Deferred. The per-target switch and `ignoreChanges` cover the known cases without a third vocabulary.

## Consequences

- Config is not the whole truth, and the docs say so. The pitch is review, repeatability and rollback, not "the file is the portal".
- Holds can pile up on a busy portal. The one-line summary may not be enough, and a team may be tempted to set `drift: 'overwrite'` on production to silence it. Watch for that in the dogfood project.
- Every resource type needs a faithful normalizer; phantom drift is the fastest way to lose trust.
- `pull --check` in CI is the drift check for config. `diff` and `drift` are docs recipes over `compare`, not verbs.
- State is local per checkout, so a second branch on the same sandbox sees the first branch's applied change as `drift` and holds it; nothing is reverted. The recommended layout is still one test account per developer.
- A resource deleted in HubSpot while still in config is held with "deleted in HubSpot". `plan --take config` recreates it, `kalup rm` with `release` lets it go.
