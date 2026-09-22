# Roadmap

Kalup: configuration as code for HubSpot. This page lists the milestones in build order: what each one ships, what it fixes on paper only, and how an agent can check that it is done. There are no dates. Kalup is built part-time by one founder with AI agents, so the order is the promise and the calendar is not.

Three labels are used throughout:

- **Ships**: code and tests exist at the end of the milestone.
- **On paper**: the format, schema or interface is in the repo and nothing exercises it yet.
- **Unverified**: a HubSpot behaviour nobody has tested live. Kalup never presents one as fact.

Every milestone keeps the project rules: absence never deletes, tests never touch the network, milestones 1 and 2 send only requests the endpoint registry tags `read`, and no token is ever printed or committed.

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
- `init`: `kalup.config.ts` with one target (`--portal` required), `kalup/`, the `.kalup/` gitignore line, a formatter ignore for `kalup/` (in `biome.json` or `biome.jsonc`, else `.prettierignore`), AGENTS.md with a docs index and the agent rules, CLAUDE.md with the line `@AGENTS.md` (created when missing, appended when present without it), then the first `pull`.
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

**Dependencies:** none.

## Milestone 2: compare, plan, snapshot, docs

**Goal:** show what differs between config and a portal, or between two portals, in the plan format milestone 4 will apply.

**Ships**

- `compare <a> <b>`: each side a target name, a snapshot file, or `config`. Output reuses the plan's `changes[]`. `diff` and `drift` are docs recipes over `compare`, not verbs.
- `plan --target X [--out plan.json]`: read-only, no state, so no base. The full `plan/1` step and header shape, including `held[]`, `expect`, `notCovered[]`, counts by risk and `writesHash`. With no base, a scalar that differs on an existing resource is `diverged` and held; a set member in config and not in the portal is an add. Portal strings are sanitized before output.
- Preflight before every plan: account-info, the Limits Tracking API for tier and headroom, token scopes. A tier gap is `blocked` with the exact `overrides` JSON to exclude the resource on that target. A 403 on `list` is a reported gap.
- Per-target `skip` and `name` overrides applied in `compare` and `plan`; `definition` and `lookup` stay on paper.
- `snapshot --target X [--out <file>]`: a full pull in IR form saved to `.kalup/snapshots/<target>/<ISO timestamp>.json` by default, the input for `compare` and `docs`.
- `docs`: a Markdown data dictionary from the IR or a snapshot.

**On paper:** `plan --take config`, the held classes that need a base (`drift`, `conflict`), the executor.

**Acceptance:** `plan --target sandbox --json` validates against the `plan/1` schema; golden plan files for a new property, a portal-only option, a config-only option, a label held as `diverged`, and a custom object `blocked` by tier; `compare sandbox production --json` and `compare config sandbox --json` return one `envelope/1`; the read-only guard still passes; `docs` output for `examples/basic` is committed and regenerates byte-identically.

**Dependencies:** milestone 1.

## Milestone 3: `@kalup/client`

**Goal:** a typed CRM client for reads, writes and search, typed by the same files the portal is configured from.

**Ships:** `createClient({ accessToken, objects, target? })` with per-object `get`, `getMany`, `create`, `update`, `archive`, the `*Many` forms, `search`, `searchAll` (an async iterator that restarts past the 10,000-result cap), and `listAssociated`, `associate`, `dissociate` with the default unlabeled association. `where` operators typed per codec kind and validated against HubSpot's filter limits before sending. Data goes through the codecs, so aliases, `stringArray`, `json` and `required` apply and `readonly` properties leave the write types. Separate limiters for search and general calls, adapting from the rate headers. Date-versioned paths, custom objects as `p{portalId}_{name}`, per-target `name` overrides when `target` is given. Depends on `@kalup/core` only, `fetch` injectable.

**On paper:** typed association labels (they wait for milestone 4), `upsert` by a unique property, OAuth refresh.

**Unverified:** the batch size for `*Many` calls (100, to confirm before building).

**Acceptance:** a fake `fetch` asserts the exact request body for every `where` operator; type-level tests for `select` narrowing, operator availability per kind, alias translation and readonly exclusion; limiter tests with fake timers for header adaptation and both 429 kinds; `searchAll` against a fake of more than 10,000 records; no network.

**Dependencies:** milestone 1 only. It sits third because `compare` and `docs` are the lead features. A second agent can build it alongside milestone 2.

## Milestone 4: apply

**Goal:** `kalup apply` writes a reviewed plan to a target, keeps state, and holds drift instead of reverting it.

**Live spikes first.** One day in a developer test account, before any write code, because contract choices hang on the answers: whether `pipelineId` is honoured on create and what PUT does to stage IDs; whether association label `name` comes back on read; what HubSpot rewrites on a property create; which rate headers a service key returns and which scopes it can hold; read-after-write lag on schema endpoints; whether an archived internal name can be reused within 90 days; whether the API refuses to archive an in-use property; which editor forms created by the legacy v3 API and by the 2027-03 beta open in. Each answer becomes a line in the coverage docs. Until then each stays unverified.

**Ships**

- `apply`, `rm <address>` (writes a `destroy` tombstone) and `rm <address> --release`, `bind`, `state rebuild`, `target rebind`, `plan --take config <address[#field]>`, which labels the step `reverts-ui-edit`, and `pull --accept <glob>`, which takes the portal side for the matching addresses and needs a base to know what it flips.
- `FileStateStore` at `.kalup/state/<target>.json` and `advanceBase`, so the full classification (`converged`, `config-change`, `drift`, `conflict`, `diverged`) runs with a base.
- Resource types `pipeline`, `stage` and `association` with create, update and remove, plus `notCovered[]` lines for what HubSpot has no API for (required properties per stage, stage automation).
- The executor: serial, destructive steps last, every step idempotent with a read-back, `expect` re-checked right before each write, one shared token bucket, a refusal when the estimate exceeds the daily headroom. No rollback, no resume: recovery is `plan` again, and a partial apply exits 5.
- Confirmation: risky and destructive steps need a person at a TTY who types the target name and the destructive count. Protected targets accept only saved plans. `--yes` refuses plans with more than 25 writes. A delete needs a tombstone, an owning state entry in that target, a target policy that allows destroys, and the confirmation.
- The CI recipe as documented GitHub Actions steps, with state on a `kalup-state` branch checked out as a worktree at `.kalup/state`. A rejected push means a concurrent apply.

```yaml
- run: git fetch origin kalup-state:kalup-state && git worktree add .kalup/state kalup-state
- run: npx kalup plan --target production --out plan.json
- run: npx kalup apply plan.json
- if: always()
  run: cd .kalup/state && git add -A && (git diff --cached --quiet || (git commit -m "apply $GITHUB_SHA" && git push origin kalup-state))
```

**On paper:** `{ keychain }` credentials, `RunbookExecutor` and `load-executors.ts`, `attest`, `baseHash` for opaque payloads, a shared `StateStore` backend.

**Acceptance:** offline tests for the classification table and set-member rules, executor order, an `expect` mismatch aborting before the write, tombstone gating, `--yes` refusing above 25 writes, no prompt without a TTY; `apply` of a saved plan against a fake HTTP layer produces the expected journal and state file; a no-op apply leaves the state file byte-identical. One live check per resource type, run by a person in a test account and kept out of the test suite: `normalize(read(create(x)))` equals `x`.

**Dependencies:** milestone 2 and the spikes.

## Later, in no fixed order

- Blueprints: `kalup add <name@version | url | owner/repo/item#ref | path> [--prefix] [--dry-run] [--view]` over JSON IR fragments, `kalup/blueprints.lock.json`, stored originals under `kalup/.blueprints/`, and `blueprint upgrade` as a three-way merge that never touches a portal. The format is fixed on paper now.
- `attest` and runbook resource types, written in the vocabulary of the HubSpot UI.
- Lists (HubSpot assigns the ID and listing is a POST), then forms (legacy v3 or the 2027-03 beta, decided by the spike), then workflows behind a per-resource flag: the API is beta, update is a full replace guarded by `revisionId`, delete cannot be undone, names are not unique. For each, the read side comes before writes.
- `generate <language>`: pure functions over the IR that emit native types and codec functions with no Node at runtime. Order not decided; research points at Python, then PHP.
- An MCP server and a Claude Code plugin: read-mostly, apply off by default and never for protected targets.
- A hosted service for teams that need shared state with locking and history, and scheduled snapshots.

## Not planned

- Record data migration: copying values between properties, bulk record edits, seed data. The migration recipe for a renamed internal name names the steps and stops there.
- Rebuilding HubSpot CLI features: projects, apps, CMS themes, serverless functions, test account creation.
- Assets with no public write API beyond runbooks: record page layouts, saved views, conditional property logic, stage required properties, pipeline automation, permission sets, and the rest of the coverage page's manual rows. `plan` emits the manual steps, `attest` records that a person did them, and Kalup claims nothing beyond that.
- `rollback`, `resume` and `promote` verbs. Recovery is `plan` again.
- A public promise about anything HubSpot has not documented. An unverified behaviour stays labelled until a live test settles it.

## How HubSpot's release cycle affects this

HubSpot's REST API paths carry a release date (`/crm/properties/2026-09/...`), a new version ships every March and September, and each is supported for 18 months. Kalup's endpoint registry pins one version per resource type, so a HubSpot release is a registry change plus a conformance run against a test account, not a rewrite. Legacy v4 paths go unsupported on 30 March 2027 and v1 to v3 in September 2027, so Kalup builds on date-versioned paths only; a legacy or beta row (forms, workflows) needs an `expires` date and a per-resource flag. Auth moves too: legacy private app creation is switched off on 28 September and 26 October 2026, and service keys replace it. Service keys are still in public beta and their rate-limit headers are undocumented, which is why the HTTP layer has a fixed-rate fallback and why the header question is on the spike list. Sequences and sales email templates need user-level OAuth, which a target does not hold yet, so they stay out of scope until it does. Milestone 4's spikes run against a service key, since legacy private app creation ends in autumn 2026.
