# 0004. Two JSON contracts: the IR and the plan

## Status

accepted

## Date

2026-09-22

## Context

Many things need to read what a project describes and what an apply would do: `plan`, `compare`, generated docs, code generators for other languages, policy checks, AI agents, and a hosted service that runs the engine. The first draft had one TypeScript file as the whole model, so every consumer would have had to run it. Node cannot sandbox untrusted code, and a hosted service must never execute customer TypeScript.

The command-surface design proposed a stable JSON schema per command (`diff/v1`, `status/v1`, and so on). The review cut that to one envelope, with two stable documents inside it. The engine-contracts review added the matching rule for adapters: only the plan is public, and the adapter interface stays unstable for a year.

## Decision

Two versioned JSON documents are the public contracts before 1.0: the IR (`irVersion`) and the plan (`plan/1`). Both ship a published JSON Schema. The engine is a library that reads IR and emits plans. The hosted service runs the same engine on the same two documents and never executes customer TypeScript.

The IR is derived by `kalup ir` from config and is not committed in a TypeScript project:

```json
{
  "irVersion": 1,
  "project": "acme-crm",
  "generator": { "name": "kalup", "version": "0.1.0", "frontend": "ts" },
  "resources": {
    "group:companies/billing": { "type": "group", "managed": true, "definition": { "label": "Billing" } },
    "property:companies/billing_status": {
      "type": "property",
      "managed": true,
      "definition": { "label": "Billing status", "group": { "$ref": "group:companies/billing" }, "type": "enumeration", "fieldType": "select",
        "options": [{ "value": "active", "label": "Active" }] },
      "binding": { "key": "billingStatus", "codec": "enum", "required": true },
      "lifecycle": { "options": "additive" }
    },
    "team:sales_emea": { "type": "team", "managed": false, "lookup": { "name": "Sales EMEA" } }
  },
  "targets": { "production": { "portalId": 2222222, "protected": true, "drift": "hold" } },
  "tombstones": {}
}
```

IR rules: integer `irVersion`; additive change inside a version; readers keep unknown fields; `x` namespaced fields pass through; deterministic serialization (sorted keys, no timestamps); references are `{ "$ref": "<address>" }` anywhere inside a definition; no portal-specific IDs, no tokens, no transport names; per-target overrides support `skip`, `name`, `definition`, `lookup`.

The plan is self-contained: `apply` needs the plan, credentials and state, never the IR. Every step carries `address`, `action`, `risk`, `transport`, a `title` in HubSpot UI wording, `desired` or `changes[]` with `before` and `after`, `held[]`, `expect`, and `notCovered[]` once per type. The header carries `portalId`, `accountType`, `uiDomain`, `stateLineage`, `irHash` and counts by risk. No tokens, no `expiresAt`.

```json
{ "id": "s1", "address": "property:companies/billing_status", "action": "update", "transport": "public-api", "risk": "safe",
  "title": "Add option \"Reseller\" to Billing status",
  "changes": [{ "unit": "options[reseller]", "class": "config-change", "before": null, "after": { "value": "reseller", "label": "Reseller" } }],
  "held": [{ "unit": "label", "class": "drift" }],
  "expect": { "exists": true, "values": { "options[reseller]": null } } }
```

Every command's `--json` output is one `envelope/1` (`format`, `ok`, `data`, `issues[]`). Inside it, only `plan/1` and `ir/1` are stable schemas before 1.0. `ResourceType`, `StateStore` and the state file format are internal and may change between minor versions.

## Alternatives considered

- **A stable schema per command.** Freezes surfaces nobody has used yet, and each one is a promise to keep. Rejected. `compare` reuses the plan's `changes[]`; other `data` is marked unstable.
- **The TypeScript objects as the contract.** Every consumer would run customer code. Rejected.
- **A committed `ir.json` as the source of truth.** Config is the source. A committed IR drifts from it and invites hand edits. Rejected for TypeScript projects.
- **A stable adapter SDK (`ResourceType`) from day one.** HubSpot ships a new API version every March and September, and the adapter shape will follow it. Fixing it now would freeze the wrong thing. Rejected until it has survived a year.

## Consequences

- Generators for other languages are pure functions over the IR. No Node at run time for their output.
- Blueprints are IR fragments (ADR 0011) and snapshots are IR in a file, so one format serves three features.
- Approval binds to a hash over the writing steps of the plan (`writesHash`), so drift lines, counts and times do not void it.
- A breaking IR change is a version bump with a migrate command. Inside a version, only additive changes.
- Plans from older CLIs will reach the hosted service. It accepts one deployed engine build per supported minor.
- Anything outside the two contracts is documented as unstable, and the docs say so on every page that shows it.
