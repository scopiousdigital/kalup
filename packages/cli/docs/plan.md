# Plan

`kalup plan [--target <name>] [--take config <address[#unit]>] [--out [<file>]] [--exit-code]` shows what apply would do to one target: a step per object, group and property config manages, `definition` overrides applied (config.md), then the releases and deletes tombstones ask for. It writes neither portal nor state. `--out <file>` saves the plan/1 document; `--out` alone saves it as `.kalup/plans/<target>-<planId>.json` and prints the path. `kalup apply <file>` applies either.

This page is the reference. For the walk-through with examples, see [kalup plan](https://kalup.dev/docs/commands/plan) and [Drift](https://kalup.dev/docs/concepts/drift) on the website.

## Order of work

1. Validate (`E_NO_CONFIG` exit 1, other issues exit 3), then pick the target (targets.md).
2. The read key, then the portal guard (`E_TARGET_PORTAL_MISMATCH`, exit 4).
3. State for that portal, `.kalup/state/portal-<portalId>.json`; an unusable file is `E_STATE_INVALID`.
4. Pull's read and scope, plus tombstoned properties. A 403 leaves that object unread (`E_SCOPE`).
5. Limits Tracking (403 without a `crm.objects.*` scope; `W_LIMIT_UNREADABLE` for property creates), then the three `archived=true` lists of each object with a property create or an owned property HubSpot no longer holds. A group delete reads no archived list: only active properties block it. A 403 there is exit 1.
6. The plan, checked against `plan-1.schema.json` (`E_PLAN_SCHEMA` is a bug).

## State and the base

A state entry owns an address when it was created or adopted and its `id` is the portal name the address resolves to (its `name` override, else its own). An entry naming another name owns nothing; the step notes it, and applying it replaces the entry.

| State | Portal | Step |
|---|---|---|
| none | absent | `create` |
| none | present | `adopt`: option adds written, differences held as `diverged` |
| owned | present | `update` against the base |
| `pulled` | present | `adopt` against the base pull recorded: a file edit since is a `config-change` |
| owned | absent | no step; listed in `missing` |

Each unit (a field, an option, an option's `label`, `hidden` and `description`, `options.order`) is classified against the base: `config-change` is written; `drift` (only HubSpot moved), `conflict` (both moved) and `diverged` (no base) are held. An option in config and the base that HubSpot dropped is drift; one config dropped is kept with a note. `removedOptions` and `options: 'exact'` remove, risk `risky`. Under takeover, `options` defaults to `exact`: such a removal is `destructive`, labelled `takeover`, and blocked without `allowDestroy` (`policy`) or after an incomplete read (`scope`).

Converged units with a missing or outdated base go in `baseUnits`: apply records them without a write. An update that only holds or notes units is never applied.

A held line names both exits: the portal side, `kalup pull --only <address>`, or `kalup pull --accept <address>#<unit>` for a conflict or an option HubSpot dropped; and config's side, `--take config <address>#<unit>`.

## Taking config's side

`--take config <selector>`, repeatable; several selectors may follow one `config`. A selector is an address, with the `*` of `--only`, and an optional unit; `#options` takes every option unit. It writes matching held units at risk `risky`, labelled `reverts-ui-edit` for drift and conflicts and `overwrites-portal` for `diverged` units; `--take config 'property:companies/*'` takes every held unit of the object's properties; an address alone also recreates a missing group, or a missing property HubSpot does not hold archived. No take recreates an archived property or writes a custom object (`unsupported`). A selector matching nothing is `E_TAKE_UNMATCHED`.

With `drift: 'overwrite'`, drift and conflicts are written labelled `reverts-ui-edit` at their change's risk. With `adopt: 'overwrite'`, `diverged` units are written, `risky`, labelled `overwrites-portal`. No policy recreates a missing resource.

## What blocks

The first rule that matches: a `skip` override (no step, `coverage.excluded`); a `lookup` override; an unread object (`scope`, action `unknown`); a blocked parent or missing group (`dependency-blocked`); a property Kalup does not write (pull.md), whose fix makes it a `p.string` reference; for a create, a missing `name` override target, an archived property name (a create restores it; an archived group's name is created anew), or no limit room; HubSpot-defined or calculated, a `type` or `hasUniqueValue` difference, or read-only definition or options. A custom object schema is compared and never written: a missing one is blocked, and its differences are held or noted.

## Tombstones, missing and orphans

`hubspot/removed.ts` tombstones name properties and groups:

- `release`: a `release` step drops the entry, even one naming another portal name; nothing is sent.
- `destroy`, present: a `delete`, risk `destructive`, labelled `existed-before-kalup` for an adopted resource, expecting every base unit's live value. Blocked with `policy` without `allowDestroy: true`, `unsupported` when it is not archivable or a group still holds active properties the plan does not delete (archived ones do not block: HubSpot archives a group once every property in it is archived), `not-owned` without an owning entry.
- `destroy`, absent by a complete read: a release expecting `exists: false`.

Under takeover (config.md), a `delete` labelled `takeover` archives each custom property and group in the pull scope that config lacks, with a `mode` note naming the statement that asked for it; an option removal takeover asks for carries the note too. One `Takeover on <objects>` heading precedes the first such step and says whether each is confirmed at a terminal or all are blocked. Blocked with `policy` without `allowDestroy`, `scope` after an incomplete read, `unsupported` when not archivable or a group keeps an active property. The `policy` fix leads with `kalup pull --target <t> --only <address>`, which keeps it in config, then `exclude` or `lifecycle: { options: 'additive' }` to leave it unmanaged, then `allowDestroy`. A delete expects every captured field's live value. Apply checks the same rules against its own read (a skipped group, a schema's properties, an empty group).

Releases follow the config steps, then deletes, the tombstones' and then takeover's, properties before groups.

`missing` lists owned resources a complete read did not find, with `archived` (`null` for a group) and the exits; `orphans`, owned entries config no longer names, with both `kalup rm` commands; one naming another portal name, only `--release`.

## Header

`stateLineage` and `stateSerial` come from state, `null` without. `protected` defaults by account type (targets.md), `drift` and `adopt` to `hold`, `allowDestroy` to false, `yesLimit` to 25; `takeover` lists the objects in takeover mode. `budget.estimatedCalls` counts three calls per write plus apply's reads; `0` without effects.

`writesHash` digests the target, portal, policy, state lineage and serial, `normVersions`, bindings, and each unblocked step with an effect: `address`, `action`, `transport`, `api`, `labels`, `baseUnits`, `desired`, `ignoreChanges`, `changes` (`unit`, `op`, `after`), `expect`. Titles, held values and notes stay out. `planId` is `pl_` plus its first 12 hex digits.

A write's `expect` holds the live value of each field it sets, the full options when any option changes, and a property's `type` and `fieldType`.

## Output

The header, then `Settings:` with what decides the steps on this target, from `plan.target`: the mode per object, `adopt`, `drift`, `allowDestroy`, `yesLimit`. Under each step, from plan/1 data only: a set unit as `unit: portal -> config`, `+ option` and `- option`, a create's label, group, fieldType and options, and each held unit with its class and config, portal and base (`held[].base`). With several targets, a step holding a `diverged` unit adds a `shared:` line: a pull writes the file every target shares, and a `definition` override keeps the portal's values on one target. Any `diverged` unit adds a line naming `adopt: 'overwrite'` and `--take config` with a glob. `Coverage` counts `skipped` resources (`skip` overrides, `coverage.excluded`), not what `exclude` leaves unread.

```
Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
s5 risky [reverts-ui-edit] Update property "Billing status" (billing_status) on companies, set label
  label: "Billing state" -> "Billing status"
  held options[paused] drift: config {"value":"paused","label":"Paused"}, portal null, base {"label":"Paused"}. Take the portal side: kalup pull --target sandbox --accept 'property:companies/billing_status#options[paused]'; take config: kalup plan --target sandbox --take config 'property:companies/billing_status#options[paused]'
```

## Exit codes

| Exit | When |
|---|---|
| 0 | Planned, blocked steps, `E_SCOPE` and warnings included |
| 2 | `--exit-code` and anything pending: a step to apply, a blocked or manual step (they count as pending, and the last line says so), a held unit, a resource missing in HubSpot, an incomplete read |
| 1 | `E_USAGE`, `E_NO_CONFIG`, `E_TARGET_REQUIRED`, `E_CANCELLED`, `E_MISSING_KEY`, `E_STATE_INVALID`, `E_TAKE_UNMATCHED`, `E_OVERRIDE_AMBIGUOUS`, a failed request, `E_PLAN_SCHEMA` |
| 3 | Config invalid, `E_NO_TARGETS`, `E_UNKNOWN_OBJECT` |
| 4 | `E_TARGET_PORTAL_MISMATCH` |
