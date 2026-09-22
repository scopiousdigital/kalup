# 0011. Blueprints are JSON IR fragments

## Status

accepted

## Date

2026-09-22

## Context

Agencies want repeatable setup across many client portals: the same billing group, the same renewal pipeline, in thirty portals, with upgrades later. The research split on what a blueprint is. One dossier called it "a function that returns config". Another said `add` must never run third-party code. The IR (ADR 0004) resolves the two: if a blueprint is an IR fragment, `add` renders it through the same writer `pull` uses, the prefix becomes a data transform, and the code-execution problem disappears.

Two further facts shaped the decision. HubSpot internal names are permanent, so a blueprint's naming mistakes and its prefix are permanent in every portal that applied it. And the agencies the founder has worked with do not prefix.

## Decision

A blueprint is a versioned JSON IR fragment. Never TypeScript, never a function.

```json
{
  "blueprintVersion": 1,
  "name": "acme/renewals",
  "version": "1.1.0",
  "irVersion": 1,
  "requires": [{ "$ref": "object:deals" }],
  "resources": {
    "group:deals/renewal": { "type": "group", "definition": { "label": "Renewal" } },
    "property:deals/renewal_date": { "type": "property",
      "definition": { "label": "Renewal date", "group": { "$ref": "group:deals/renewal" }, "type": "date", "fieldType": "date" },
      "binding": { "key": "renewalDate" } }
  }
}
```

`kalup add <name@version | url | owner/repo/item#ref | path> [--prefix] [--dry-run] [--view]`:

1. Fetch the JSON and validate it against the blueprint and IR schemas. Unknown types or IR versions are rejected. No code runs.
2. Apply the prefix as a rename map over addresses and every `$ref` inside the fragment. Labels, option values and binding keys stay, so app code is the same in every client project.
3. An existing address with a different definition is an error and nothing is written. An identical one is skipped.
4. Render into the project's files through the canonical writer.
5. Record `source`, `version`, `hash` and `prefix` in `kalup/blueprints.lock.json`, and store the fragment as fetched under `kalup/.blueprints/`. The loader merges provenance into the IR.

Prefix: none by default. `prefix` is an option in `kalup.config.ts`, and `kalup add --prefix` overrides it for one add. Collisions show up as `adopt` lines with a diff, or as errors.

Integrity and trust: the same source and version with a different hash is `BLUEPRINT_INTEGRITY_MISMATCH`. `${VAR}` in registry headers expands only names starting with `KALUP_REGISTRY_`. A blueprint's `docs` text is written to a file and printed only as a path when there is no TTY. In `--json`, third-party strings are sanitized and never appear in `fix` or `message`. `add` rejects items that define `hs_` names or change HubSpot-defined properties.

`kalup blueprint upgrade` runs the same three-way merge as `pull`, with the stored original as base, config as local and the new fragment as remote, prefix applied to both. The corrected label lands where the client left it alone and is a conflict where they changed it. Unresolved conflicts are recorded as `held` in the lock. Removed upstream means detach, never delete. Upgrade never touches a portal.

## Alternatives considered

- **A blueprint as a function returning config.** Runs third-party code inside the project and in any hosted service. Rejected.
- **Copied-in TypeScript source (the shadcn model).** The tool would have to evaluate it (ADR 0003 forbids that), and the prefix becomes a source rewrite. Rejected. What survives from shadcn is copy-in with provenance and no installed dependency graph.
- **An agency prefix by default.** Some agencies will refuse another agency's prefix in a client portal for life, and a client who changes agency keeps it. Rejected by the founder. `prefix: ''` is a valid, visible choice.
- **Refetching the upgrade base from the registry.** Fails when the source is offline or gone. Rejected. The stored original is the base.
- **Signed blueprints.** Key management is work for a team. A hash, a pinned version and a readable data diff cover data-only items. Rejected.
- **A hosted default registry.** A service to run. A GitHub repo is enough. Rejected for now.

## Consequences

- Blueprints hold no code, no transport, no API version, so they survive API version changes and cannot carry a `p.json` validator.
- Thirty client projects mean thirty `upgrade` runs.
- Blueprint text reaches an agent's context, so AGENTS.md carries the rule that it is data, not instructions, and every string is sanitized (ADR 0009).
- A blueprint-origin resource that holds an outbound URL, custom code or an email recipient is `risky` on first apply, and the plan prints the endpoint. On paper until those types exist.
- Everything here is a later milestone. The formats are fixed now so the IR schema needs no breaking change when `add` ships.
