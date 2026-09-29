# Plan

`kalup plan [--target <name>] [--take config <address[#unit]>]` shows what apply would do to one target: a step per object, group and property config manages, `definition` overrides applied (config.md), then the releases and deletes tombstones ask for. It writes neither portal nor state.

## Order of work

1. Validate (`E_NO_CONFIG` exit 1, other issues exit 3), then pick the target (targets.md).
2. The read key, then the portal guard (`E_TARGET_PORTAL_MISMATCH`, exit 4).
3. State for that portal, `.kalup/state/portal-<portalId>.json`; an unusable file is `E_STATE_INVALID`.
4. Pull's read and scope, plus tombstoned properties. A 403 leaves that object unread (`E_SCOPE`).
5. Limits Tracking (403 without a `crm.objects.*` scope, developer test account 2026-09-29; `W_LIMIT_UNREADABLE` for property creates), then the three `archived=true` lists of each object with a property create, an owned property HubSpot no longer holds, or an owned group delete. A 403 there is exit 1.
6. The plan, checked against `plan-1.schema.json` (`E_PLAN_SCHEMA` is a bug).

## State and the base

A state entry owns an address when it was created or adopted and its `id` is the portal name the address resolves to (its `name` override, else its own). An entry naming another name owns nothing; the step notes it, and applying it replaces the entry.

| State | Portal | Step |
|---|---|---|
| none | absent | `create` |
| none | present | `adopt`: option adds written, differences held as `diverged` |
| owned | present | `update` against the base |
| owned | absent | no step; listed in `missing` |

Each unit (a field, an option, an option's `label`, `hidden` and `description`, `options.order`) is classified against the base: `config-change` is written; `drift` (only HubSpot moved), `conflict` (both moved) and `diverged` (no base) are held. An option in config and the base that HubSpot dropped is drift; one config dropped is kept with a note. `removedOptions` and `options: 'exact'` remove, risk `risky`.

Converged units with a missing or outdated base go in `baseUnits`: apply records them without a write. An update that only holds or notes units is never applied.

A held line names both exits: the portal side, `kalup pull --only <address>`, or `kalup pull --accept <address>#<unit>` for a conflict or an option HubSpot dropped; and config's side, `--take config <address>#<unit>`.

## Taking config's side

`--take config <selector>`, repeatable; several selectors may follow one `config`. A selector is an address, with the `*` of `--only`, and an optional unit; `#options` takes every option unit. It writes matching held units, labelled `reverts-ui-edit` at risk `risky`; an address alone also recreates a missing property HubSpot does not hold archived. No take recreates a group or an archived property, or writes a custom object (`unsupported`). A selector matching nothing is `E_TAKE_UNMATCHED`.

With `drift: 'overwrite'`, drift and conflicts are written labelled `reverts-ui-edit` at their change's risk; `diverged` units and missing resources are not.

## What blocks

The first rule that matches: a `skip` override (no step, `coverage.excluded`); a `lookup` override; an unread object (`scope`, action `unknown`); a blocked parent or missing group (`dependency-blocked`); a type no builder carries; for a create, a missing `name` override target, an archived name (a property create restores it), or no limit room; HubSpot-defined or calculated, a `type` or `hasUniqueValue` difference, or read-only definition or options. A custom object schema is compared and never written: a missing one is blocked, and its differences are held or noted.

## Tombstones, missing and orphans

`kalup/removed.ts` tombstones name properties and groups:

- `release`: a `release` step drops the entry, even one naming another portal name; nothing is sent.
- `destroy`, present: a `delete`, risk `destructive`, labelled `existed-before-kalup` for an adopted resource, expecting every base unit's live value. Blocked with `policy` without `allowDestroy: true`, `unsupported` when it is not archivable or a group still holds properties (active or archived) the plan does not delete, `not-owned` without an owning entry.
- `destroy`, absent by a complete read: a release expecting `exists: false`.

Releases follow the config steps, then deletes, properties before groups.

`missing` lists owned resources a complete read did not find, with `archived` (`null` for a group) and the exits; `orphans`, owned entries config no longer names, with both `kalup rm` commands; one naming another portal name, only `--release`.

## Header

`stateLineage` and `stateSerial` come from state, `null` without. `protected` defaults by account type (targets.md), `drift` to `hold`, `allowDestroy` to false. `budget.estimatedCalls` counts three calls per write plus apply's reads; `0` without effects.

`writesHash` digests the target, portal, policy, state lineage and serial, `normVersions`, bindings, and each unblocked step with an effect: `address`, `action`, `transport`, `api`, `labels`, `baseUnits`, `desired`, `ignoreChanges`, `changes` (`unit`, `op`, `after`), `expect`. Titles, held values and notes stay out. `planId` is `pl_` plus its first 12 hex digits.

A write's `expect` holds the live value of each field it sets, the full options when any option changes, and a property's `type` and `fieldType`.

## Output

```
s5 risky [reverts-ui-edit] Update property "Billing status" (billing_status) on companies, set label
  held options[paused]: config {"value":"paused","label":"Paused"}, portal null. Take the portal side: kalup pull --target sandbox --only property:companies/billing_status; take config: kalup plan --target sandbox --take config 'property:companies/billing_status#options[paused]'
```

## Exit codes

| Exit | When |
|---|---|
| 0 | Planned, blocked steps, `E_SCOPE` and warnings included |
| 1 | `E_USAGE`, `E_NO_CONFIG`, `E_TARGET_REQUIRED`, `E_CANCELLED`, `E_MISSING_KEY`, `E_STATE_INVALID`, `E_TAKE_UNMATCHED`, `E_OVERRIDE_AMBIGUOUS`, a failed request, `E_PLAN_SCHEMA` |
| 3 | Config invalid, `E_NO_TARGETS`, `E_UNKNOWN_OBJECT` |
| 4 | `E_TARGET_PORTAL_MISMATCH` |
