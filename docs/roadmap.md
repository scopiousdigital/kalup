# Roadmap

Kalup: configuration as code for HubSpot. This page lists the milestones in build order: what each one ships, what it fixes on paper only, and how an agent can check that it is done. There are no dates. Kalup is built part-time by one founder with AI agents, so the order is the promise and the calendar is not.

Three labels are used throughout:

- **Ships**: code and tests exist at the end of the milestone.
- **On paper**: the format, schema or interface is in the repo and nothing exercises it yet.
- **Unverified**: a HubSpot behaviour nobody has tested live. Kalup never presents one as fact.

Every milestone keeps the project rules: absence never deletes, tests never touch the network, milestones 1 and 2 send only requests the endpoint registry tags `read`, and no token is ever printed or committed.

## Release sequence

The accepted product review changes the order: the local product ships before cloud, narrow apply precedes the full typed CRM client, and blueprint upgrades precede broad resource expansion. See ADR 0015.

| Release | Scope | Gate |
|---|---|---|
| Read-only agency preview | Hardened milestone 1 plus milestone 2 | Accurate observations, useful comparisons and documentation on existing portals |
| Local CLI MVP | Milestone 3 | Reviewed property/group writes, coordination and recovery demonstrated |
| Agency reuse | Milestone 4 | A blueprint upgrade preserves client exceptions across multiple configurations |
| Hosted agency pilot | Milestone 5 | Repeated team use of shared execution, observations and approvals |

Current status (2026-09-29): milestones 1 to 4 are implemented on oclif, with the packages still at version 0.0.0. The first [live run](conformance/runs/2026-09-29-89b45da9.md) passed the main pull/plan/apply/drift workflow on a developer test account; remaining conformance checks, a reproduced stale-lock race, real CI and release validation still block release. ADRs 0018 and 0019 were accepted on 2026-09-24; 0021 and 0022 remain proposed. Public copy labels availability for the released version.

On 2026-09-24 the founder assigned one piece of work from the preview to a v1 agency CLI: target selection (ADR 0020), the remaining preview fixes, milestone 3 (ADR 0021), milestone 4 (ADR 0022 and ADR 0011), release hardening, and the preparation of live conformance. That assignment replaces the stop-after-one-milestone rule for those phases only. Cloud (milestone 5), the typed client and broader resource writes stay outside it.

Target selection, from ADR 0020: a target is a name the user chooses for a pinned portal. There is no required sandbox, production target, portal count, naming convention or deployment order. A command that needs one target takes `--target`, else `defaultTarget` from `kalup.config.ts`, else the only target, else a choice at a terminal, else stops with `E_TARGET_REQUIRED`. Names never decide protection, drift policy or order, and a saved plan always applies to the portal it names.

## Milestone 1: read-only foundation

**Goal:** `kalup pull` reads a portal into `kalup/objects/*.ts`, and the app gets its types from those files with no generate step.

**Ships**

- Packages `kalup` (the CLI, bin `kalup`) and `@kalup/core`. `kalup` also exports `defineConfig` and the `KalupConfig` type for `kalup.config.ts` from its library entry, and ships `docs/` (`config.md`, `pull.md`, `targets.md`, `errors/<CODE>.md`), the pages `Issue.docs` points at.
- Commands `init`, `pull`, `validate`, `ir`, `fmt`, `status`.
- Resource types `property`, `group` and `object` (custom object schema), addressed as `property:companies/billing_status`, `group:companies/billing`, `object:subscription`.
- The grammar reader and canonical writer: `defineObject`, `defineCustomObject`, the `p.<kind>('<internal name>', {...})` builders with `.required()`, `.readonly()` and `.managed(false)`, `p.json` with its validator kept as source text, leading comments kept in place. Anything else is `E_NOT_DATA` with file, line and a fix hint. The tool parses config and never executes it.
- The codecs, `InferProperties`, `propertyNames`, and `toCreatePayload` as a function of an IR resource. Zero runtime dependencies, no HTTP.
- `pull` with the scope from config (`objects: { companies: { include: ['name', 'domain'] }, subscription: {} }`): `custom` (default true) and `include` decide what is written, including in-scope resources that are new in the portal, and `pull --discover` lists in-portal resources outside the scope. A resource in a file that the scope leaves out is kept as is, printed as out of scope, not refreshed. Portal-owned fields come from the portal, the app binding (key, codec, aliases, `required`, `managed`) from the file. Files are copied to `.kalup/history/<timestamp>/` before being overwritten.
- `ir` (the `irVersion: 1` document with its JSON Schema), `validate` (`Issue` records with `code`, `file`, `line`, `configPath` and `fix`, exit 3 when invalid), `fmt`, and `status`. `status` and `pull` refuse when the key's `portalId` differs from the pinned one. `status` prints the protected default for a `STANDARD` account's target when config does not set `protected`, since config cannot know the account type.
- `init`: `kalup.config.ts` with one target (`--portal` required), `kalup/`, gitignore protection for `.kalup/` and the recommended `.env` credential file, a formatter ignore for `kalup/` (in `biome.json` or `biome.jsonc`, else `.prettierignore`), AGENTS.md with a docs index and the agent rules, CLAUDE.md with the line `@AGENTS.md` (created when missing, appended when present without it), then the first `pull`.
- The endpoint registry with date-versioned paths (`/crm/properties/2026-09/...`), each path tagged `read` or `write`, and `expires` on beta and legacy rows. One HTTP choke point in read mode with retry on 429 and 5xx and a fixed 8 requests per second fallback when rate headers are missing. `credentials.read: { env }`.
- `--json` on every command as one `envelope/1`, and the exit codes: 0 done, 1 error, 2 differences pending only with `--exit-code`, 3 config or IR invalid, 4 a person is needed, 5 partial apply.

**On paper:** `kalup.state/1` and the `StateStore` interface, `plan/1`, the write half of `ResourceType`, `lifecycle` and `kalup/removed.ts` tombstones as validation only, per-target `overrides` parsed and validated (`skip`, `name`, `definition`, `lookup`; `pull` applies `name`, the rest waits), `{ keychain }` credentials.

**Acceptance**

```sh
pnpm build && pnpm check && pnpm test
kalup validate --json                     # ok: true in examples/basic
kalup ir --json                           # validates against the ir/1 schema
kalup fmt && git diff --exit-code kalup/  # the writer's output is already canonical
```

Plus these offline tests against fixtures with invented names: `write(parse(t)) === t` for canonical text and `parse(write(x))` deep-equals `x`; a second `pull` with no portal change is byte-identical; `toCreatePayload` on every managed property in a fixture equals the fixture's own fields; a guard that fails the suite if the HTTP layer is called with a path not tagged `read`.

The review adds semantic gates: formatting preserves owned field presence, successful pull produces a fully valid project, enum identities round-trip without alias collisions, and the schema validator rejects unexpected inherited property names. The existing passing tests are not evidence that these findings are fixed.

**Dependencies:** none.

## Milestone 2: compare, plan, snapshot, docs

**Goal:** show what differs between config and a portal, or between two portals, in the plan format milestone 3 will apply.

**Ships**

- `compare <a> <b>`: each side a target name, a snapshot file, or `config`. Output reuses the plan's `changes[]`. `diff` and `drift` are docs recipes over `compare`, not verbs.
- `plan --target X [--out plan.json]`: read-only, no state, so no base. The full `plan/1` step and header shape, including `held[]`, `expect`, `notCovered[]`, counts by risk and `writesHash`. With no base, a scalar that differs on an existing resource is `diverged` and held; a set member in config and not in the portal is an add. Portal strings are sanitized before output.
- Preflight before every plan: account-info, supported Limits Tracking usage/headroom, and verified access/capability checks. Limits Tracking is not a universal entitlement API. A known capability gap is `blocked` with the exact `overrides` JSON to exclude the resource on that target. A 403 on `list` is an incomplete observation, never evidence of absence.
- Per-target `skip` and `name` overrides applied in `compare` and `plan`; `definition` and `lookup` stay on paper until milestone 4 (ADR 0022).
- `snapshot --target X [--out <file>]`: a scoped observation in IR form with explicit coverage, saved under `.kalup/snapshots/<target>/` with a filename safe on supported operating systems, the input for `compare` and `docs`.
- `docs`: a Markdown data dictionary from the IR or a snapshot.

**On paper:** `plan --take config`, the held classes that need a base (`drift`, `conflict`), the executor.

**Acceptance:** `plan --target sandbox --json` validates against the `plan/1` schema; golden plan files for a new property, a portal-only option, a config-only option, a label held as `diverged`, and a custom object `blocked` by limit (ADR 0018, proposed); `compare sandbox production --json` and `compare config sandbox --json` return one `envelope/1`; the read-only guard still passes; `docs` output for `examples/basic` is committed and regenerates byte-identically.

Semantic differences return exit 2 with `--exit-code`; an incomplete comparison cannot produce a clean CI result. Observations and affected plans identify unreadable, unsupported and excluded coverage. Finalize the approval context from ADR 0016 before treating saved plans as a compatibility promise.

**Dependencies:** milestone 1.

## Milestone 3: narrow apply and the local MVP

**Goal:** `kalup apply` writes a reviewed property/group plan to a target, keeps state, and holds drift instead of reverting it. This is the first local MVP with writes; cloud is not required.

**Status:** implemented to ADR 0021 (proposed) under the v1 assignment, with offline scenario coverage and the first live property/group workflow recorded. Not released: the 2026-09-29 review reopened the portal-lock gate, and live conformance is incomplete. The CI recipe is published in the several-portals guide as a design that has not run in a real CI.

**Live conformance before release.** Not done yet. In an authorized developer test account, verify the property and group endpoints; the scopes a write key needs, account-info and reads included; what HubSpot rewrites on create; rate headers; read-after-write lag for single reads and lists; the 404 for an unknown or sensitive property on a single read; the answer to a create of an existing name; what a PATCH does to options it leaves out; archive and recreation behavior, including archiving a group that holds properties; and in-use deletion constraints. Each answer becomes adapter evidence and coverage documentation. Pipeline, association and form questions are investigated when those adapters are scoped. Prove one server-assigned identity and a cross-target reference before declaring the contracts sufficient for broader resources.

**Ships**

- `apply [plan-file]` (a saved plan, or for an unprotected target a plan made in the same run), `rm <address>` (writes a `destroy` tombstone) and `rm <address> --release`, `state rebuild [--write]`, `target rebind <target> --portal <id>`, `plan --take config <address[#unit]>`, which writes held units labelled `reverts-ui-edit` and recreates a missing property HubSpot does not hold archived, and `pull --accept <address[#unit]>`, which takes the portal side of the units pull keeps because of the base. `bind` follows the first bound resource.
- `kalup.state/1` per verified portal at `.kalup/state/portal-<id>.json`, with no target name inside, shared by the worktrees of one clone and movable with `KALUP_STATE_DIR`. `FileStateStore` saves atomically with compare-and-swap on the serial. `classify` with a base and `advanceBase` run the full classification (`converged`, `config-change`, `drift`, `conflict`, `diverged`) against a partial base, and `rewrites` records values HubSpot stores differently.
- Planning with state: creates, adoptions with `baseUnits`, updates against the base, held units with both exits, deletes and releases from `kalup/removed.ts` tombstones, `missing` and `orphans` in the plan, and `allowDestroy` in config. Custom object schemas are compared and never written.
- Property and group writes through a write client that allows only those writes, sends each once and times out every request. The write matrix follows HubSpot's documented update schemas; a `type` or `hasUniqueValue` difference is blocked with a migration recipe. Custom object schema writes, pipelines, stages and associations are separate later scope, not prerequisites for this release.
- The executor: a trusted run order with deletes last, a precondition read and `expect` check right before each write, the payload built from that read, no resend after an uncertain outcome, read-back until a deadline, the base advanced only where the read-back agrees, one journal line per request, and a refusal when the estimate exceeds half the daily remainder. No rollback, no resume: recovery is `plan` again, and a partial apply exits 5.
- Approval: a person at a terminal who types the target name and the destructive count; `--yes` for an unprotected target with nothing risky and at most 25 writes, adoptions and releases; `--approve <writesHash>` for a reviewed CI job with a separate write key from the environment, never for a delete. Protected targets accept only saved plans. A delete needs a `destroy` tombstone, an owning state entry in that portal, `allowDestroy: true` and the person at a terminal.
- Saved plans and approval digests bind destination, policy, state lineage and serial, normalizer versions, relevant bindings and every step with an effect. Apply reads the plan and `kalup.config.ts` and checks it against state and a fresh observation, deriving risk and labels again with trusted code. For deletes it also loads the current project as data to verify tombstones, absence from config and `preventDestroy`; it never executes config or replaces the saved intent.
- Coordination: a per-user lock per verified portal that `apply`, `state rebuild --write` and `target rebind` take, never waiting. The CI design (one authoritative writer per portal, a concurrency group, a state branch per portal, a rejected push treated as recovery, never as the lock) is in architecture section 5.

**On paper:** `{ keychain }` credentials, `RunbookExecutor` and `load-executors.ts`, `attest`, `bind`, `baseHash` for opaque payloads, a shared `StateStore` backend. The CI recipe is documented as a design; the CLI behaviours it depends on (the portal lock, refusal of stale plans, failed state saves) are tested offline.

**Acceptance.** Met offline: tests for the classification table and set-member rules with a base, the run order, an `expect` mismatch stopping before the write, each delete key, the `--yes` limits, no prompt without a terminal, the approval digest, the journal and the state file; and scenario tests with assertions on the simulator's request log and the state bytes for competing writers, retargeted, stale and edited plans, incomplete reads, and interruption after portal acceptance but before state persistence. Re-planning recovers without duplicate resources or ambiguous adoption, and a repeated successful apply performs no portal writes and leaves state byte-identical.

Live create/read round trips now exist for properties and groups on companies and a custom object. Still open: repair stale-lock takeover and cover three competing acquisitions; finish the live conformance cases and account coverage; run the CI recipe in a real repository, including concurrent runs, a rejected state push and recovery-artifact retrieval. These remain release gates.

**Dependencies:** milestone 2 and the spikes.

## Milestone 4: agency reuse

**Goal:** maintain a reusable configuration across client portals while preserving each client's deliberate changes.

Status: implemented and verified offline (local-file and https sources only); not verified against a live portal, not released, and no agency has used it yet.

Per-target `definition` overrides ship here too (ADR 0022, proposed and implemented): each field an override states replaces the shared field whole on that target, and pull writes a target's value for an overridden field into the override, never into the shared file.

**Ships:** versioned JSON blueprint fragments; `add` for pinned local or URL fragments; provenance and stored originals; `blueprint upgrade` using the three-way merge in ADR 0011. Upgrade edits config and never writes a portal. A registry marketplace and every possible source transport are not required.

**Acceptance:** upgrade the same blueprint in multiple client configurations; unchanged fields take the upgrade, client edits are preserved or held as conflicts, upstream removals do not delete portal resources, and the resulting plans can be reviewed and applied through milestone 3.

**Dependencies:** milestone 3. Read-side blueprint work may be scoped separately, but does not displace release gates.

## Milestone 5: hosted agency pilot

**Goal:** a small cohort uses Kalup repeatedly for shared execution, client-portal observations, review and history.

**Before implementation:** assess existing Scopious infrastructure for reuse and choose the cloud data model from concrete access patterns. Reuse suitable infrastructure; no broad migration or database abstraction is a prerequisite.

**Ships:** workspace and portal permissions, OAuth connections, shared state and coordination, durable execution of the same engine, scheduled observations with coverage, approvals bound to saved intent, history, and export/handover. Human decisions and optional agent memory remain separate from reconciliation state.

**Acceptance:** access and revocation are enforced on background jobs as well as UI requests; duplicate deliveries and competing writers do not duplicate changes; interrupted work recovers; teams can retrieve approved intent and execution history. Measure repeated agency use, time to a useful result and recovery burden.

**Dependencies:** milestone 4 and evidence that agencies repeatedly use the workflow. Full email/workflow coverage and a complete typed client are not prerequisites.

## Later, in no fixed order

- The full `@kalup/client`: typed record CRUD, batch operations, search, associations and rate limiting over the existing codecs. Scope it when developer demand justifies it; verify pagination, batch limits and OAuth lifecycle before implementation.
- Custom object schema writes, pipelines, stages and association labels, each with separate conformance evidence and recovery tests.
- Additional blueprint sources and a registry when the reuse workflow needs distribution.
- `attest` and runbook resource types, written in the vocabulary of the HubSpot UI.
- Lists (HubSpot assigns the ID and listing is a POST), then forms (legacy v3 or the 2027-03 beta, decided by the spike), then workflows behind a per-resource flag: the API is beta, update is a full replace guarded by `revisionId`, delete cannot be undone, names are not unique. For each, the read side comes before writes.
- `generate <language>`: pure functions over the IR that emit native types and codec functions with no Node at runtime. Order not decided; research points at Python, then PHP.
- An MCP server and a Claude Code plugin: read-mostly, apply off by default and never for protected targets.

## Not planned

- Record data migration: copying values between properties, bulk record edits, seed data. The migration recipe for a renamed internal name names the steps and stops there.
- Rebuilding HubSpot CLI features: projects, apps, CMS themes, serverless functions, test account creation.
- Assets with no public write API beyond runbooks: record page layouts, saved views, conditional property logic, stage required properties, pipeline automation, permission sets, and the rest of the coverage page's manual rows. `plan` emits the manual steps, `attest` records that a person did them, and Kalup claims nothing beyond that.
- `rollback`, `resume` and `promote` verbs. Recovery is `plan` again.
- A public promise about anything HubSpot has not documented. An unverified behaviour stays labelled until a live test settles it.

## How HubSpot's release cycle affects this

HubSpot's REST API paths carry a release date (`/crm/properties/2026-09/...`), a new version ships every March and September, and each is supported for 18 months. Kalup pins one version per resource type and runs conformance checks before updating an adapter. Legacy v4 paths go unsupported on 30 March 2027 and v1 to v3 in September 2027, so Kalup builds on date-versioned paths only; a legacy or beta row needs an expiry and a per-resource flag. Local conformance includes service keys, since legacy private app creation ends in autumn 2026. Hosted distribution verifies OAuth behavior and current installation limits separately. Sequences and sales email templates remain out of scope until their user-level authorization can be supported.
