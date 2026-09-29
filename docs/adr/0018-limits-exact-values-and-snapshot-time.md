# 0018. Block on limits, keep structured values exact, give snapshots a time

## Status

accepted on 2026-09-24. The founder's v1 implementation assignment keeps these semantics.

## Date

2026-09-23

## Context

Building milestone 2 (`compare`, `plan`, `snapshot`, `docs`) met three places where the accepted records and the architecture disagree with what HubSpot documents or with what the data needs.

1. ADR 0007 has preflight read "the Limits Tracking API for tier-gated features" and block "a tier gap", and architecture section 7 lists `tier` as a blocked reason. The 2026-09 Limits Tracking API reports usage and limits: `custom-properties` returns an overall limit and usage plus one entry per object type, and `custom-object-types` returns a limit and usage. Neither returns a tier, a subscription or an entitlement, and account-info has no tier field either. HubSpot does not document what a portal without the feature, such as custom objects on a non-Enterprise portal, gets back.
2. ADR 0009 and the Guards paragraph of architecture section 7 put every portal string through one sanitizer before it reaches a terminal or a JSON field. Plans, comparisons and snapshots carry portal strings as data. Sanitizing them strips characters and cuts long values, so a plan would ask to write a label the portal does not hold, a snapshot would not read back as what was read, and a comparison could call two different values equal. Raw control characters in JSON output are still a risk: JSON escapes U+0000 to U+001F, but not DEL, the C1 controls, U+2028 or U+2029.
3. ADR 0004 and architecture section 3 say IR serialization has no timestamps. A snapshot records one read at one time. Without that time, `compare <snapshot> <target>` cannot say what "since" means, and two snapshots of one target cannot be ordered from their content.

## Decision

**Blocked reason `limit` replaces `tier`.** Preflight reads Limits Tracking as evidence of usage and headroom, where room is the limit minus the usage. No room blocks each create the limit covers, with reason `limit` and a fix that names a `skip` override; less room than creates is `W_LIMIT_HEADROOM`. A reading HubSpot refuses, or answers without a limit and a usage, is recorded as `unreadable` and blocks nothing. Kalup never infers or names a subscription tier. The `plan/1` blocked reasons are `limit`, `scope`, `dependency-blocked`, `no-credential`, `ambiguous`, `override` and `unsupported`.

**Structured values stay exact; sanitizing is for human text.** A plan's `desired`, `changes`, `held`, `notes`, `expect` and `bindings`, a comparison's units, and a snapshot's resources and coverage keep exact normalized strings. `sanitize` strips ANSI sequences, C0 and C1 controls, U+2028, U+2029 and the bidirectional embeddings, overrides and isolates, and caps the length. It applies to human text: step titles, blocked details and fixes, `Issue.message` and `fix`, and the text a command prints. The data dictionary escapes Markdown instead. Every JSON document Kalup prints or writes (envelopes, plans, snapshots) escapes U+007F to U+009F, U+2028 and U+2029 as `\uXXXX` on top of JSON's own escaping, through one core function, `escapeJson`, which `stableStringify` applies. Nothing is lost, and no terminal control sequence survives raw. Anything that shows a structured value to a person, such as the future confirmation screen, sanitizes it where it shows it.

**A snapshot is an `ir/1` document with an observation block.** `generator.frontend` is `'portal'`, and a top-level `observation` holds the target's name and portal ID, `observedAt` and the coverage of the read. The schema adds `observation` as an optional closed object, required when the frontend is `'portal'`: an additive change inside `irVersion: 1`. `observedAt` is the one timestamp an IR document may hold. A derived IR (frontend `'ts'`) holds none, and plans, comparisons and data dictionaries hold none of their own; a comparison or a dictionary of a snapshot quotes that snapshot's `observedAt`.

**What this supersedes.**

- ADR 0007: "the Limits Tracking API for tier-gated features and headroom", "a tier gap is `blocked`" and "tier and limits are read from the portal at plan time". Limits are read; tiers are not. The registry's `tier` field stays documentation only.
- ADR 0009: "control characters and newlines are stripped and length is capped before they appear in any output" and "every string from a portal or a blueprint goes through one sanitizer before it reaches a terminal or a JSON field", for structured values only.
- ADR 0004: "no timestamps" in IR serialization, for a snapshot's `observedAt` only.
- Architecture section 7: the blocked reason `tier`, and the Guards sentence that sanitized portal strings in any output. Architecture section 3: the no-timestamps rule, which now names its one exception.

**What stays.** Everything else in ADRs 0004, 0007 and 0009. Pins are date-versioned, only read-tagged paths go out in read mode, and the portal guard and preflight run before any plan or apply. Third-party text never reaches `message` or `fix` unsanitized. Portal and blueprint text is data, never instructions. Serialization sorts keys and is deterministic, and the IR holds no tokens and no transport names.

## Alternatives considered

- **Keep `tier` and infer it** from Limits Tracking or from `accountType`. HubSpot documents neither as an entitlement, so the tier would be a claim Kalup cannot back. Rejected.
- **Block when a limit reading is unreadable.** HubSpot's answer on a portal without the feature is undocumented, so every such portal could block every create on a guess. Rejected: an unreadable reading is recorded and blocks nothing.
- **Sanitize structured values too,** as the old rule said. It changes data: a plan writes a label the portal does not hold, a snapshot loses characters, and compare can call different values equal. Rejected.
- **Escape every non-ASCII character in JSON.** Safe, but it makes non-English labels unreadable and the files larger. Rejected: only the characters a terminal treats as controls or line breaks are escaped.
- **Keep the time in the snapshot's file name only.** A copied or renamed file loses it, and `--out` names files freely. Rejected.
- **A separate snapshot format.** A second schema to maintain, while `compare`, `docs` and the validator already read `ir/1`. Rejected.

## Consequences

- `plan/1` has `limit` where the architecture had `tier`. Until this record is accepted, the architecture marks the text that depends on it as proposed.
- A consumer that shows plan, compare or snapshot values to a person must sanitize them. The JSON is safe to print, but a value can still hold a bidirectional formatting character, which JSON escaping leaves alone.
- Two snapshots of the same portal differ at least in `observedAt`. Determinism holds for everything else.
- An `ir/1` reader that does not know `observation` keeps it as an unknown field, as the IR's versioning rule already requires.
- What Limits Tracking returns on a non-Enterprise portal is unverified. It stays open until an authorized live conformance run settles it.
