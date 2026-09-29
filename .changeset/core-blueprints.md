---
"@kalup/core": minor
---

Blueprints (ADR 0011): versioned, data-only JSON fragments of groups and managed properties.

- `validateBlueprint(document)` checks `schemas/blueprint-1.schema.json` (closed at every level, shipped in the package) and the rules a schema cannot state: addresses that parse and match their type, plain names that never start with `hs_`, a property's group on its own object, unique option values, aliases that name an option, and a codec that fits the HubSpot type and fieldType. Every issue is `E_BLUEPRINT_SCHEMA`. `defaultCodec(type, fieldType)` is the codec a HubSpot type implies.
- `applyPrefix(fragment, prefix)` renames every group and property name, in addresses and in every `$ref` to a resource of the fragment. Labels, option values, descriptions, binding keys and object keys stay; an empty prefix is the identity.
- The lock `kalup/blueprints.lock.json` has its own closed schema, `schemas/blueprints-lock-1.schema.json`. `parseLock`, `validateLock`, `originalPath` and `LOCK_FILE` are exported, with the `Blueprint`, `BlueprintResource`, `BlueprintLock`, `LockEntry` and `LockHeld` types.
- `loadFiles` reads the lock when present, rejects an invalid one with `E_BLUEPRINT_LOCK`, and sets `provenance` (blueprint, version, source address, prefix, hash) on each config resource the lock lists. A listed address config no longer has is fine.
