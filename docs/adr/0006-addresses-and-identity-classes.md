# 0006. Addresses and identity classes

## Status

accepted

## Date

2026-09-22

## Context

HubSpot resources split by how they are identified. Properties, groups, custom object schemas and stages take a caller-set key that never changes. Lists, forms, workflows and teams get a server-assigned ID and a name the user can edit. Owners and some teams are never created by a config tool; they are found per portal. Each class needs a different answer to "is this the same resource?" across a sandbox and a production portal.

Two design documents spelled logical IDs differently (`property:companies/billing_status` and `crm.pipeline:deals/renewal`). One syntax had to win. Pipelines added a wrinkle: the 2026-09 API reference documents `pipelineId` and `stageId` as settable on create, but a pipeline built in the HubSpot UI already has a generated numeric ID that differs per portal.

## Decision

Every resource has an address, `<type>:<path>`, used as the key in the IR, in state and in plan steps:

```
property:companies/billing_status
group:companies/billing
object:subscription
pipeline:deals/renewals
stage:deals/renewals/won
association:companies/contacts/primary_contact
list:renewals_due
workflow:renewal_reminder
team:sales_emea
owner:dana@example.com
```

Paths use HubSpot's caller-set internal names where they exist and a config-chosen slug otherwise. The display name is a definition field, so a UI rename is a field change, not a new resource.

The endpoint registry gives each resource type one identity class:

- `natural`: the caller sets an immutable portal key. Property, group, custom object, pipeline and stage IDs.
- `bound`: HubSpot assigns the ID and the name is editable. List, form, workflow, team, and association labels until a live test shows `name` on read.
- `lookup`: never written. Resolved per target by name or email. Owners, unmanaged teams.

One resolution chain serves every type: the state binding first, then the natural key if the type has one, then for bound types exactly one live resource with the same name (`matchKey`). A name match plans as `adopt` and needs confirmation. It runs before every create of a bound resource, which covers an interrupted create, lost CI state and two branches creating the same list. A create of a bound type with no binding and no match is `risky` and names the `kalup bind` fix.

If `pipelineId` is honoured on create (documented in the 2026-09 reference, not yet tested), a pipeline created by Kalup gets `pipelineId: "renewals"` in every target and needs no binding. A pipeline built in the UI carries its generated ID: `pull` gives it the logical key `renewals` plus a binding to the numeric ID in that target, and production is created with `renewals` as its real ID. So an adopted natural resource may carry an `id` that differs from its key, which makes `natural` "bound with a free default".

References are logical in config, base and normalized live: `{ "$ref": "team:sales_emea" }`. `apply` resolves them per target (`objectTypeId`, association `typeId`, pipeline and stage IDs, list IDs, form GUIDs, user, owner and team IDs, including inside opaque payloads). An unresolved reference blocks that resource only and prints the `kalup bind` fix. A per-target `lookup` override lets a team or owner differ per portal.

Three names, three rules: the TypeScript key is free to change, the label updates in place, the internal name is immutable.

## Alternatives considered

- **Portal IDs in config.** Differ per target, so config would be per portal. Rejected. IDs live in state.
- **Everything natural.** Wrong for lists, forms and workflows, where a rename would read as delete plus create. Rejected.
- **Everything bound through an ID map.** Properties and groups need no map. Rejected.
- **Name as the identity for bound types.** Names are editable and, for workflows, not unique. Rejected.
- **Type-first dotted spelling (`crm.pipeline:`).** No gain over the shorter form. Rejected.

## Consequences

- The identity class lives in the endpoint registry (ADR 0007), one row per type.
- Two behaviours need a live test before milestone 4: whether `pipelineId` is honoured on create and what PUT does to stage IDs, and whether association label `name` comes back on read. Until then, association labels are `bound`.
- Lost state recovers by class: natural resources return as `adopted`, bound resources bind on a unique name match, ambiguous ones list candidates for `kalup bind`.
- The catalogue of ID positions inside workflow JSON and list filters is unresearched. Unmapped IDs stay as unresolved markers and block promotion.
- Every plan step, drift line and state entry names the same address, so an agent can chain commands without translating IDs.
