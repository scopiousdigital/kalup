---
"kalup": minor
---

Version checks for the documents Kalup reads, and the formats it supports in `kalup --version --json`.

- `kalup apply <plan-file>` refuses a saved plan that another release line of Kalup made (its `generator.version`), or of another plan format, with `E_PLAN_VERSION` before the schema check and before any request. The fix: plan again with this version. A release line is one major version from 1.0.0 and one minor version before it, since any 0.x minor release may change what a `plan/1` field means; a pre-release is a line of its own. From 1.0.0, a plan from another minor release of the same major still applies.
- A state file of another format is `E_STATE_INVALID` with a message that names the file, the format found and `kalup.state/1`, and says to use the version of Kalup that wrote it rather than rebuild over it.
- A snapshot whose `irVersion` is not 1 is `E_SNAPSHOT` (exit 3), and a blueprint whose `blueprintVersion` is not 1 is `E_BLUEPRINT_SCHEMA` naming its source, each naming the version this one reads and what to do. A stored original under `kalup/.blueprints/` of another blueprint version is `E_BLUEPRINT_ORIGINAL` naming both versions, with the fix to use the version of Kalup that wrote it instead of restoring the file from git.
- `kalup --version --json` adds `data.formats`: `ir/1`, `plan/1`, `kalup.state/1`, `envelope/1`, `blueprint/1` and `blueprints-lock/1`.
- The shipped pages for `E_PLAN_VERSION`, `E_STATE_INVALID`, `E_SNAPSHOT`, `E_BLUEPRINT_SCHEMA`, `E_BLUEPRINT_ORIGINAL`, `E_BLUEPRINT_LOCK` and `docs/apply.md` describe these checks, and `E_STATE_SCHEMA` no longer calls state an unstable format.
