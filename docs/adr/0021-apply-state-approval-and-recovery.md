# 0021. Apply: state by portal, one approval contract, serial execution and re-plan recovery

## Status

proposed

## Date

2026-09-24

## Context

Milestone 3 adds the first portal writes: properties and property groups. ADRs 0001, 0002, 0005, 0010 and 0016 fix the principles: a three-way base, absence never deletes, drift is held, a stored write key plus a terminal confirmation, and approval bound to the saved intent and its execution context. Five questions were open or in conflict:

1. ADR 0001 keys state by target name, while ADR 0016 requires cooperating writers to coordinate by portal. A renamed target, or two names for one portal, would get separate state and separate locks for the same resources.
2. ADR 0010 requires a person at a terminal for risky and destructive steps and says CI applies from secrets behind a reviewed environment. A CI job has no terminal, and an environment variable such as `CI` proves nothing about review.
3. HubSpot documents no idempotency keys, conditional updates or revision fields for property and group writes, and does not document its answer to creating an existing name (docs/conformance/hubspot-reference.md, sections 2 and 8). A timed-out create may or may not exist.
4. After ADR 0016 removed the recomputation of a plan from config, nothing stopped an old approved plan from running again.
5. The plan vocabulary had no scalar update, release, labels, or way to report a resource deleted in HubSpot.

An adversarial review of the first draft of this record found five blockers and eighteen major issues. This version resolves them.

## Decision

### State is per verified portal

State lives in `.kalup/state/portal-<portalId>.json`. In a linked git worktree the path resolves to the main worktree's project directory, so every worktree of one clone shares state. `KALUP_STATE_DIR` overrides the directory, for example for a CI state-branch worktree. `kalup status` prints the path per target. Separate clones keep separate state, as ADR 0001's "two branches, one sandbox" describes; the lock below only serializes their requests.

Two targets in one config may not pin the same portal (`E_DUPLICATE_PORTAL`, exit 3). A renamed target keeps its state; a plan saved under the old name is refused because its target is no longer declared. The file holds no target name; output shows the name from config. Every read checks that the file's `portalId` equals the verified portal.

`kalup.state/1` keeps `origin`, `id`, `normVersion` and `base` per resource. `base` holds, per owned unit, the value config and portal last agreed on; an adopted resource may have a partial base. A resource entry may carry `rewrites`: units whose read-back showed HubSpot storing a different value than the one sent, with both values. `lastApply` holds `planId`, `writesHash`, `actor`, `at` and `outcome` (`running`, `done`, `partial`, `uncertain`). There are no per-resource pending markers. State stays an internal format.

An entry owns a resource only when its `id` equals the portal name the address resolves to on that target, after `name` overrides. Otherwise the planner treats the address as having no entry and notes the stale one.

### Planning with a base

`classify` takes the base: a unit is `converged` when config equals live, else `config-change`, `drift` or `conflict` against the base, else `diverged` when the unit has no base. For options, a member in config and the base but missing live is drift ("removed in HubSpot"); a member live and in the base but dropped from config is kept with a note.

Per managed property and group:

| State entry | Portal | Plan |
|---|---|---|
| none | absent | `create` |
| none | present | `adopt`: config's owned values in `desired`; differing units held as `diverged`; option adds written |
| owned | present | `update`: every owned unit's config value in `desired`; `config-change` units written; `drift` and `conflict` held, or written under `drift: 'overwrite'`. A step with no write exists only when a converged unit's base is missing or out of date (a base-only step) |
| owned | absent | no step; a root `missing` entry with its archived status and the exits: restore in HubSpot, `kalup rm <address> --release`, or `--take config` to recreate it when HubSpot does not hold it archived |
| owned, destroy tombstone | present | `delete`, destructive, `expect.values` holding every owned unit; labelled `existed-before-kalup` when the origin is `adopted`; blocked with `policy` unless the target sets `allowDestroy: true` |
| not owned, destroy tombstone | present | blocked, `not-owned` |
| owned, release tombstone, or destroy tombstone with the resource shown absent by a complete read | any | `release`: drops the entry, no portal request |
| tombstone, no entry | absent | nothing |
| owned, no config, no tombstone | any | a root `orphans` entry with both `rm` commands, no step |
| any | unreadable | blocked with `scope`, action `unknown` |

Custom object schemas are compared but not written in this release: a missing custom object is blocked with `unsupported`, and its groups and properties with `dependency-blocked`.

The write matrix, from HubSpot's documented update schemas: a property update may set `label`, `description`, `group` (as `groupName`), `formField`, `fieldType` (risky; the plan says the effect on existing values is not checked) and options. `type` and `hasUniqueValue` differences are blocked as `unsupported` with the migration recipe, on adopt and update alike. A group update may set `label` only. A property HubSpot reports with `readOnlyDefinition`, `readOnlyOptions` or `archivable: false` is blocked for the affected change as `unsupported`.

`plan --take config <address[#unit]>` turns matching held units into writes labelled `reverts-ui-edit` at risk `risky`, and recreates a missing resource that HubSpot does not hold archived. Under `drift: 'overwrite'`, drift and conflict units are written at the risk of the change itself and labelled `reverts-ui-edit`; the `exists` of a missing resource is never overwritten. A unit recorded in `rewrites` whose live value is the stored value, with config unchanged, becomes a note ("HubSpot stores X; change config to match") and is never written again.

A step lists in `baseUnits` the units apply will record in the base because config and portal already agree: an adopt's converged units, or an owned resource's converged units whose base is missing or out of date. An `update` step with no changes and no `baseUnits` only reports held units or notes; it is neither approved nor executed.

`plan/1` changes before it is published as stable: the action `release`; step `baseUnits`; the change op `set` for scalar units; step `labels` (`reverts-ui-edit`, `existed-before-kalup`); the blocked reasons `not-owned` and `policy`; root `orphans` and `missing`; `stateSerial` next to `stateLineage`; `normVersion` per resource type; and `allowDestroy` in the target policy. A release step has no `api`.

### What approval binds

`writesHash` covers the destination (target name and portal ID), the effective policy (`protected`, `drift`, `allowDestroy`), the state lineage and serial, the normalizer versions, the relevant bindings, and every step that is not blocked and has an effect (a create, adopt, delete or release, or an update with changes or `baseUnits`), with its API row, labels, `baseUnits`, desired values, `ignoreChanges`, changes (`unit`, `op`, `after`) and `expect`. Apply executes exactly the steps in that context. Titles, stated risk, change classes, counts, held values, notes, orphans, missing entries, coverage and budget are display only.

### What apply trusts

`kalup apply <plan.json>` reads the saved plan and `kalup.config.ts`, and sends every request with the write key. Config can refuse a plan but never changes what it writes: every `name` binding must equal what the target's overrides give today and every step's object must be declared under `objects` (`E_BINDING_CHANGED`, also when two effect steps resolve to one portal resource), and a plan that deletes also reads `kalup/removed.ts` and the object files as data, so a delete runs only for an address with a `destroy` tombstone that config no longer holds and no config resource protects with `preventDestroy`, whatever address reaches it (`E_PLAN_DELETE`). It refuses before any write when:

1. the plan fails the `plan/1` schema, or `writesHash` does not match its content (`E_PLAN_INVALID`, `E_PLAN_DIGEST`);
2. the plan's target is no longer declared or pins another portal, or the write key's portal is not the plan's (`E_PLAN_DESTINATION`, `E_TARGET_PORTAL_MISMATCH`);
3. the effective policy differs from the plan's (`E_POLICY_CHANGED`);
4. a step's API family or version differs from the registry row that would run it, the row has expired, or a normalizer version differs (`E_PLAN_VERSION`);
5. after the lock, the state lineage or serial differs from the plan's (`E_STATE_CHANGED`), except that a plan whose `writesHash` equals `lastApply.writesHash` with outcome `done` reports "already applied" and exits 0 without writing;
6. after the lock, trusted code derives a step's labels, risk or blocked status from state, policy and a fresh observation, and the plan states a lower risk or omits a derived label (`E_PLAN_RISK`);
7. the fresh observation is incomplete for an affected object, a custom object binding no longer matches, or any step's `expect` no longer matches live (`E_INCOMPLETE`, `E_BINDING_CHANGED`, `E_PLAN_STALE`);
8. the call estimate, reads included, exceeds half of the daily remainder read after the guard (`E_BUDGET`); with no daily figure, `W_RATE_HEADERS`.

Current config never replaces the saved intent. For an unprotected target, `kalup apply` without a file plans and applies in one run through the same checks.

### One approval contract

A plan needs approval when it has any effect: a write, an adoption, a release, a delete or a base-only step. A plan with no effect exits 0 without approval. Approval comes from exactly one of:

1. **A person at a terminal.** stdin and stderr are terminals, `--json` is absent and `CI` is unset. Kalup prints the target, portal and account type, each effect in HubSpot's words (titles redrawn from step data, portal text sanitized) and the counts, then asks for the target name, and for the number of destructive steps when there are any. It covers any plan.
2. **`--yes`.** Only for an unprotected target, with no step trusted code derives as risky or destructive, and at most 25 writes, adoptions and releases together.
3. **`--approve <writesHash>`.** For a reviewed CI job: the digest of a plan a reviewer saw, usually posted by the pull request job. Apply compares it with the saved plan's recomputed digest. The target must name a separate `credentials.write`; the write key is read from the process environment only; and apply refuses when any `.env` file it would read defines that variable, because the key is then on this machine. `--approve` never covers a delete.

Otherwise apply exits 4 with `humanRequired` (`E_APPROVAL_REQUIRED`) and the exact command for a person to run in a terminal. Fix text never suggests `--approve`, and AGENTS.md tells agents never to pass it. Protected targets accept only saved plans. Every delete, on every host, needs mode 1: nothing destructive runs without a person confirming it at a terminal.

The limits are stated wherever this appears. `--approve` shows that the writes about to happen equal a digest someone reviewed; it does not prove a review happened. Its boundary is custody of the write key, held only by a CI environment limited to the protected default branch. An agent with a shell can read any key on the same machine; the terminal confirmation is an interlock against an over-eager agent, not a wall against a hostile one.

### Execution

The order: check the plan file offline (schema, digest, step numbering), guard the write key's portal, check destination, policy and versions, ask for approval, take the lock, re-read state and check lineage and serial, observe the affected objects (three sensitivity lists, the archived lists where a property create or a delete needs them, the groups list, and the schemas list for custom object bindings), run the checks above, record `lastApply.outcome: running` in state, then run the steps.

Steps run serially: groups before the properties in them, creates and updates before deletes, properties deleted before their groups. Deletes run only when every earlier step finished and verified. For each step that writes:

1. Read the resource again. A property is read singly with its `dataSensitivity`; a group through the groups list. A 404 is "not found by this query", never proof of absence. A mismatch with `expect`, or a create whose resource now appears, stops the run before this write (exit 5 when earlier writes happened).
2. Build the payload from that read. For options, send every live option's `label`, `value`, `displayOrder`, `hidden` and `description` unchanged, apply the approved changes, and give new options `displayOrder` after the highest live one, in config order; renumber only for an approved `options.order` change. A property PATCH also carries the live `type` and `fieldType` unless the step changes `fieldType`.
3. Send it with a timeout. A 429 without the daily policy, a 423 or a 477 is a definite rejection: wait, re-read, compare with `expect`, rebuild and resend, a bounded number of times, then stop the run. A daily 429 stops the run. Any other 4xx is a definite rejection (`rejected`), except that a rejected create is followed by a read: a resource that is present then makes the outcome `uncertain`, never "nothing written". A 5xx, a timeout, a network failure or an unreadable 2xx body is `uncertain` and never resent.
4. Read back until a bounded deadline (read-after-write lag is unverified). A 2xx create whose body names the resource proves it exists, so its dependents proceed; a dependent create's definite 400 or 404 is retried after re-reading its precondition, within the same deadline. An uncertain write is settled only by positive evidence: the approved values read back, or for a deleted property an archived read showing it archived; for a deleted group, which HubSpot offers no archived read for, its absence from the groups list.
5. Save state: set `origin` (`created` for a verified create, `adopted` for an adopt), `id`, and `base` for each unit whose read-back equals the approved value. A mismatching unit keeps its old base and is recorded in `rewrites`. A verified delete drops the entry. The save is atomic and compares the serial.

Steps with no write (adopt, base-only update, release) record ownership and base from the fresh observation, only where live equals the approved value. Held units never move. A run whose effects change nothing leaves the state file byte-identical, and a plan with no effects writes nothing at all.

A group delete also requires that no property, active or archived, names the group, except properties this run deleted and verified; otherwise it is blocked as `unsupported` with the member names. Whether HubSpot can archive a group that still holds properties, and what then happens to them, is not confirmed, and neither is a UI restore for groups.

The journal, `.kalup/journal/portal-<id>/<planId>-<time>.jsonl`, gets one line per request, flushed before the next: `planId`, `writesHash`, portal, approval mode, step, address, method, HTTP status, HubSpot's `category` and `correlationId`, times and outcome. It never holds a key, a request or response body, or an email address.

Exit codes: 0 when every approved effect applied and verified, including a run with nothing to do; 5 when a write landed or may have landed (HubSpot accepted it, or its outcome is uncertain) or a resource entry in state changed, and not every effect verified; 1 when nothing landed (no write was sent, or every write sent was definitely rejected) and no resource entry changed (the `lastApply` record alone does not count); 3 for invalid config or an undeclared target; 4 for the portal guard and for missing approval. Each step reports `done`, `unverified`, `uncertain`, `rejected`, `stale`, `not-run` or `blocked` in `data`.

### Recovery

There is no resume and no rollback. Recovery is a new plan, and a partial run always prints `kalup plan` as the next command. A crash leaves `lastApply.outcome: running`, which the next plan reports. A resource an interrupted create made is present with no entry, so the next plan adopts it with origin `adopted`: a reviewed adoption, never a claim that Kalup created it. A natural key cannot duplicate. A verified delete whose state save failed leaves an owned entry for an absent resource, which the next plan releases.

`kalup state rebuild` reports, read-only, which config resources exist in the portal and which state entries are stale. With `--write`, at a terminal only, it archives the current file (ending its lineage), then writes a new lineage with an `adopted` entry and a base where config and live agree for every config resource present in the portal, except addresses with a tombstone. It never runs under `--yes` or `--approve`. Lost for good: the `created` origin, and the direction of fields that differ now.

`kalup target rebind <target> --portal <id>` runs at a terminal only, accepts only a `DEVELOPER_TEST` or `SANDBOX` account, refuses a portal another target pins, changes the pin in `kalup.config.ts`, and runs the rebuild for the new portal. A command that touches two portals takes both locks in ascending portal order.

### Coordination

Apply, `state rebuild --write` and `target rebind` take a lock named by the verified portal ID and hold it until state is saved. Apply takes it after the terminal prompt and before reading state. `state rebuild --write` re-reads state under the lock before it writes. `target rebind` takes both portals' locks before it reads and prompts, so the report the person confirms is the one it writes. The lock file lives in a per-user directory (`~/.kalup/locks/`, or `KALUP_LOCK_DIR`) and records the holder's process, host, command, plan and start time. Kalup never waits for a lock. A lock whose holder is a finished process on this host is stale and is taken over; any other is `E_LOCKED`, naming the holder. An unwritable lock directory is an error naming `KALUP_LOCK_DIR`, never a fallback. SIGINT and SIGTERM stop before the next request, record the request in flight as `unverified` or `uncertain` without waiting for its read-back, save state and release the lock, so the next plan reconciles it; a second signal exits at once.

The lock serializes cooperating writers on one machine for one user, across clones, worktrees and target names. It does not coordinate other users or machines. For CI, one repository and workflow is the authoritative writer for a portal, with a concurrency group and a state branch (`kalup-state/portal-<id>`) named by the portal, and in-progress runs never cancelled. The apply job pushes state and uploads state and journal as artifacts whether or not apply succeeded. A rejected push is a recovery incident, never a lock.

### Deletes

A delete needs all four keys of ADR 0002: a `destroy` tombstone written by `kalup rm`, an owning entry in that portal's state, `allowDestroy: true` on the target, and a person at a terminal typing the target name and the destructive count. HubSpot archives a deleted property; its knowledge base says archived properties are removed after 90 days and can be restored in the UI until then. Use in workflows, lists and forms is not checked.

### Credentials

Writes use `credentials.write` when the target names one, otherwise the read credential. Apply sends every request, reads included, with that key, and guards it once. The write key therefore needs the read scopes of the objects it manages, the account-info scope, and the sensitive write scopes for sensitive properties. Read commands never resolve the write key.

## Alternatives considered

- **State per target name (ADR 0001 as written).** A rename or an alias creates a second owner of the same resources and a second lock. Rejected.
- **Trust `CI=true` or a GitHub variable as approval.** Anyone can set an environment variable. Rejected.
- **Let `--approve` cover deletes.** Contradicts ADR 0002's human confirmation and the rule that nothing destructive runs without a person at a terminal. Rejected; unattended deletes would need a separate founder decision amending both.
- **A write key pasted at a prompt for every protected apply.** Rejected by the founder in ADR 0010; not reopened.
- **Retry uncertain writes.** Without idempotency keys a retried create can fail on a resource the first attempt made, and a retried full options replacement can undo an edit made in between. Rejected in favour of reading back.
- **Per-resource pending markers that grant `created` on recovery.** A marker proves intent, not that a request landed, and would record ownership or origin Kalup cannot back. Rejected for a reviewed adoption.
- **Advance the base from any observation.** Turns held drift into a later silent revert. Rejected: the base moves only where the approved value and the live value agree.
- **Allow several targets per portal with differing policies.** A less protected alias bypasses the stricter one. Rejected.
- **A lock server.** Hosted work. Rejected for this release.

## Consequences

This record supersedes or amends, by name:

- ADR 0020's parenthetical on the protection default: `protected` now defaults to true for every account type except `DEVELOPER_TEST`, `SANDBOX` and `APP_DEVELOPER`, so an unknown or new type fails closed (final audit, 2026-09-28).

- ADR 0001: the state path by target name and `<target>.lock` (now per portal); "serial is for compare-and-swap only" (the plan also binds it); "state stays local per checkout" (shared by the worktrees of one clone); and `state rebuild` (now archives and adopts at a terminal).
- ADR 0002: none of the four keys changes; the confirmation is specified as the typed count at a terminal on every host.
- ADR 0005: "`plan --take config` recreates it" now applies only when HubSpot does not hold the resource archived; a deleted resource is reported in `missing`, not as a held step.
- ADR 0009 and the AGENTS.md rule on production applies: a reviewed CI job may apply risky steps with `--approve`; agents never pass it.
- ADR 0010: "the CLI trusts that the environment gate released the key" becomes an explicit `--approve` of a reviewed digest with a separately held write key; the TTY-only rule for risky steps no longer applies to such a CI job; rebind no longer archives by target name.
- Architecture sections 5, 7, 8 and 10 and the roadmap's milestone 3 text, updated in the same change: the digest contents, "done" (a verified read-back), the retry of a dependent's 400 or 404 (bounded, after a re-read), and the refusal on daily headroom (half the remainder).

Also:

- `plan/1` and `kalup.state/1` change before either is published as stable, and stay unstable until the identity spike (a server-assigned ID and a cross-target reference) passes.
- A read-then-write is not atomic with edits in the HubSpot UI. An edit that lands after the precondition read and before HubSpot applies the write is overwritten for that unit. Rebuilding the payload after every wait narrows the window; nothing closes it.
- New error codes, each with a docs page: `E_PLAN_INVALID`, `E_PLAN_DIGEST`, `E_PLAN_DESTINATION`, `E_PLAN_VERSION`, `E_PLAN_RISK`, `E_PLAN_STALE`, `E_POLICY_CHANGED`, `E_STATE_CHANGED`, `E_BINDING_CHANGED`, `E_APPROVAL_REQUIRED`, `E_APPROVE_MISMATCH`, `E_APPROVE_CREDENTIAL`, `E_LOCKED`, `E_STATE_WRITE`, `E_UNCERTAIN_WRITE`, `E_BUDGET`, `E_DUPLICATE_PORTAL`, `W_UNVERIFIED`.
- Live conformance before release adds: a create of an existing name, the 404 for an unknown or sensitive property on a single read, options left out of a PATCH, archiving a group that holds properties, read-after-write lag for single reads and lists, the scopes a write key needs for account-info and reads, and what HubSpot rewrites on create.
- Scenario tests with a stateful fake portal cover ordering and a second run, adoption, drift and conflicts with both exits, stale plans, destinations, policies and lineages, edited plan files, competing writers across checkouts, interruption after acceptance, failed read-back and state saves, timeouts, rate limits, scope failures, incomplete reads, deletes, releases, replays and no-op runs.
