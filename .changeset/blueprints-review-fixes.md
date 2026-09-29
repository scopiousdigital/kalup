---
"kalup": patch
"@kalup/core": patch
---

Blueprint fixes from review.

- `@kalup/core`: a blueprint name segment is lowercase letters and digits joined by single dashes, in `blueprint-1.schema.json` and `blueprints-lock-1.schema.json`, so no two names share a stored original. A property's group `$ref` must name a plain group (`E_BLUEPRINT_SCHEMA`).
- `kalup add` writes `kalup/.blueprints/** -text` to `.gitattributes` (and `blueprint upgrade` puts it back when missing), so git line-ending conversion never breaks a stored original.
- A URL source with a user name, password or query string is refused (`E_BLUEPRINT_SOURCE`) and never printed whole: the lock records the source. A redirect to a URL with credentials is refused too.
- `kalup add` treats a `.managed(false)` config entry as a collision on `managed`, and names what resolves a collision with a resource another blueprint provides. `E_BLUEPRINT_REF` text is sanitized and capped.
- `blueprint upgrade` keeps the `as` alias of an option upstream removed, keeps a held conflict held at later versions until it is taken or settled in config, drops a conflict config has settled when the same version runs again, and keeps a lifecycle the file states (`preventDestroy: false`, `{}`) when it rewrites a property.
- `--dry-run` on `add` and `blueprint upgrade` lists exactly the files the real run writes.
