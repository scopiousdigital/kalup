---
"@kalup/core": minor
---

Introduce the Kalup runtime and configuration contracts with no runtime dependencies.

- Typed property builders, codecs, object definitions and inferred application types use the same TypeScript files as the CLI. The restricted config grammar is parsed without executing project code.
- Canonical formatting preserves explicit values, including empty strings, false and empty collections, so it preserves field ownership. Enum values and aliases are unique and reversible; codec lookups handle own keys such as `constructor` and `__proto__`. `enumValues` is a null-prototype record; use `Object.hasOwn` to inspect it.
- Publish IR, plan and state types, schemas, deterministic serialization and validators. Schema validation handles own-property boundaries, Unicode patterns and unique array entries, and rejects unsupported schema keywords. Ajv checks the validator in tests only.
- Snapshots carry observation time and explicit coverage, including unsupported, unreadable and unaddressable resources. Structured strings stay exact, and serialized JSON escapes terminal controls. Held plan units may omit a portal-resolution command when a name override prevents pull from resolving them.
- Add `defaultTarget` to the configuration grammar and the pure `selectTarget` rule. Validate declared defaults and reject duplicate portal identities, unknown override keys and mappings that assign multiple addresses to one portal resource.
- Add state-aware classification and base advancement, explicit tombstones in `kalup/removed.ts`, and per-target `allowDestroy`. State identifies the portal and records lineage, serial, verified bases, rewrites and apply outcome. Plan contracts include releases, base updates, missing resources, orphans, normalizer versions and ownership/policy checks.

Plan and state shapes are still pre-release contracts. They changed during development and must be finalized before a stable compatibility promise is published.
