---
"kalup": patch
"@kalup/core": patch
---

What the packages ship.

- Both packages ship `LICENSE` and `NOTICE`, copied from the repository root when packed, and no source maps: the bundles are not minified, and a map would point at `src/`, which the packages do not ship.
- Both require Node 22.13.1 or later (`engines.node` `>=22.13.1`), the oldest Node 22 tested. npm warns with `EBADENGINE` when installing on an older Node.
- `@kalup/core` has a top-level `types` for resolvers that do not read `exports`.
- The `kalup` package description names what this version does: pull, compare, plan and apply properties and property groups.
