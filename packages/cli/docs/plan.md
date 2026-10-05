# Plan

`kalup plan [--target <name>] [--take config <address[#unit]>] [--out [<file>]] [--exit-code]` shows what apply would do to one target: a step per object, group, property, pipeline and stage config manages, `definition` overrides applied (config.md), then the releases and deletes tombstones ask for. It writes neither portal nor state. `--out <file>` saves the plan/1 document; `--out` alone saves it as `.kalup/plans/<target>-<planId>.json` and prints the path. `kalup apply <file>` applies either.

This page is the reference. For the walk-through with examples, see [kalup plan](https://kalup.dev/docs/commands/plan) and [Drift](https://kalup.dev/docs/concepts/drift) on the website.

## Order of work

1. Validate (`E_NO_CONFIG` exit 1, other issues exit 3), then pick the target (targets.md).
2. The read key, then the portal guard (`E_TARGET_PORTAL_MISMATCH`, exit 4).
3. State for that portal, `.kalup/state/portal-<portalId>.json`; an unusable file is `E_STATE_INVALID`.
4. Pull's read and scope, plus tombstoned properties, and the pipelines of each object whose files define one, with `pipelines: true`, or with a tombstoned pipeline or stage. A 403 leaves that object unread (`E_SCOPE`); on the pipelines list, only its pipelines.
5. Limits Tracking (403 without a `crm.objects.*` scope; `W_LIMIT_UNREADABLE` for property and pipeline creates), then the three `archived=true` lists of each object with a property create or an owned property HubSpot no longer holds. A group delete reads no archived list: only active properties block it. A 403 there is exit 1.
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

Each unit (a field, an option, an option's `label`, `hidden` and `description`, `options.order`, a pipeline's `stages` order) is classified against the base: `config-change` is written; `drift` (only HubSpot moved), `conflict` (both moved) and `diverged` (no base) are held. An option in config and the base that HubSpot dropped is drift; one config dropped is kept with a note. `removedOptions` and `options: 'exact'` remove, risk `risky`. Under takeover, `options` defaults to `exact`: such a removal is `destructive`, labelled `takeover`, and blocked without `allowDestroy` (`policy`) or after an incomplete read (`scope`).

Converged units with a missing or outdated base go in `baseUnits`: apply records them without a write. An update that only holds or notes units is never applied.

A held line names both exits: the portal side, `kalup pull --only <address>`, or `kalup pull --accept <address>#<unit>` for a conflict or an option HubSpot dropped; and config's side, `--take config <address>#<unit>`.

## Taking config's side

`--take config <selector>`, repeatable; several selectors may follow one `config`. A selector is an address, with the `*` of `--only`, and an optional unit; `#options` takes every option unit. It writes matching held units at risk `risky`, labelled `reverts-ui-edit` for drift and conflicts and `overwrites-portal` for `diverged` units; `--take config 'property:companies/*'` takes every held unit of the object's properties; an address alone also recreates a missing group, or a missing property HubSpot does not hold archived. No take recreates an archived property or writes a custom object (`unsupported`). A selector matching nothing is `E_TAKE_UNMATCHED`.

With `drift: 'overwrite'`, drift and conflicts are written labelled `reverts-ui-edit` at their change's risk. With `adopt: 'overwrite'`, `diverged` units are written, `risky`, labelled `overwrites-portal`. No policy recreates a missing resource.

## What blocks

The first rule that matches: a `skip` override (no step, `coverage.excluded`); a `lookup` override; an unread object (`scope`, action `unknown`); a blocked parent or missing group (`dependency-blocked`); a property Kalup does not write (pull.md), whose fix makes it a `p.string` reference; for a create, a missing `name` override target, an archived property name (a create restores it; an archived group's name is created anew), or no limit room; HubSpot-defined or calculated, a `type` or `hasUniqueValue` difference, or read-only definition or options.

## Custom objects

- A new custom object is one `create` step. Apply creates it with its name, labels and description, then its groups and properties, then sets the display, required and searchable properties, since HubSpot refuses those fields until the properties they name exist. The step's notes say what HubSpot adds to a new object (its own properties, the group `<name>_information` and associations with activities) and which fields wait for the properties. When the object file lists `<name>_information`, as a pull writes it once a property sits in it, that group's create step notes that apply gives HubSpot's group config's label instead.
- HubSpot's schemas list can show a custom object's values from before a write for some seconds after apply verified it, so a plan made right after such an apply can show the write as held drift. Plan again a minute later, and do not pull in that window: the pull would take the old values into config.
- An update writes the whole schema in one request. A create and every update are `safe`: the display fields change forms and record views, not record values. A delete is `destructive`.
- Blocked `unsupported`: a create whose name HubSpot holds archived, since the create would purge the archived object with its records and association labels (restore it in HubSpot and pull, purge it in HubSpot, or choose another name); a create whose name differs only in case from a custom object HubSpot holds, since HubSpot keeps names unique ignoring case; and a create or update whose display, required or searchable field names a property the portal does not hold and the plan does not create. When the plan blocks that property's create (a limit, for example), the object's step is blocked `dependency-blocked`, naming the property.
- `kalup rm object:<name>` writes one tombstone that covers everything on the object: the plan has one delete step, which archives the object. Its title says how many of the object's properties, groups and pipelines go with it, and that HubSpot keeps no properties on an archived custom object; apply stops before any write when its own read finds more than the plan did. HubSpot refuses the archive while the object holds records. A tombstone on something under the object that asks otherwise than the object's is blocked with the reason. Takeover never archives a custom object.

## Pipelines and stages

- Kalup writes the pipelines of deals, tickets and custom objects. Those of contacts, companies, appointments, services, listings, courses, orders and leads are compared, never written: a create is blocked `unsupported`, and a unit a step would write becomes a note.
- A pipeline create carries every config stage of the pipeline in one request, since HubSpot refuses a pipeline with no stage. The step lists them under `stages`; they get no steps of their own.
- A stage create in an existing pipeline goes after the last stage. When config places it before a stage HubSpot holds, the pipeline's step also sets the `stages` order; apply moves the stages one request at a time after the stage steps, so the budget counts two calls per stage of that order.
- Risk: a create is `safe`, unless its pipeline or stage ID is all digits, an ID HubSpot assigned in another portal: `risky`, with a note naming the `name` override and the portal's pipeline with the same label. A label, `displayOrder` or order change is `safe`. A change of `probability`, `ticketState` or `state` is `risky`: it changes how existing records count in forecasts and in open and closed reports. A delete is `destructive`.
- Blocked `unsupported`: a create whose pipeline ID another object's pipeline holds, or whose stage ID another pipeline of the object holds, naming the holder; a stage delete that would leave its pipeline with no stage, or a ticket pipeline with no closed stage. Blocked `scope`: a pipeline or stage of an object whose pipelines were not read or answered 403.
- The first pipeline created on a custom object carries a note: HubSpot adds its own properties `hs_pipeline` and `hs_pipeline_stage` to the object, for good. A deal or ticket pipeline create notes when the plan did not read the other object's pipelines: HubSpot keeps pipeline IDs unique across the two.
- A pipeline create is blocked `override` when the target skips every one of its stages. A stage tombstone that asks otherwise than its pipeline's is blocked with the reason. A destroy on a pipeline or stage Kalup does not write is blocked, with the release fix.
- A stage order shows by label in the plan text (`stage order: "Tasting", "Signed" -> ...`). The plan document keeps the IDs, and `stageLabels` on the step maps each to its label; it is display only and not approved.
- Takeover never deletes a pipeline or stage.

## Tombstones, missing and orphans

`hubspot/removed.ts` tombstones name properties, groups, pipelines and stages:

- `release`: a `release` step drops the entry, even one naming another portal name; nothing is sent.
- `destroy`, present: a `delete`, risk `destructive`, labelled `existed-before-kalup` for an adopted resource, expecting every base unit's live value. Blocked with `policy` without `allowDestroy: true`, `unsupported` when it is not archivable or a group still holds active properties the plan does not delete (archived ones do not block: HubSpot archives a group once every property in it is archived), `not-owned` without an owning entry.
- `destroy`, absent by a complete read: a release expecting `exists: false`.
- A pipeline's tombstone covers its stages: they get no steps and no orphan notes. A pipeline or stage delete is permanent: HubSpot keeps no archive. HubSpot refuses it while a record sits in the stage, and apply names the stages and records.

Under takeover (config.md), a `delete` labelled `takeover` archives each custom property and group in the pull scope that config lacks, with a `mode` note naming the statement that asked for it; an option removal takeover asks for carries the note too. One `Takeover on <objects>` heading precedes the first such step and says whether each is confirmed at a terminal or all are blocked. Blocked with `policy` without `allowDestroy`, `scope` after an incomplete read, `unsupported` when not archivable or a group keeps an active property. The `policy` fix leads with `kalup pull --target <t> --only <address>`, which keeps it in config, then `exclude` or `lifecycle: { options: 'additive' }` to leave it unmanaged, then `allowDestroy`. A delete expects every captured field's live value. Apply checks the same rules against its own read (a skipped group, a schema's properties, an empty group).

Releases follow the config steps, then deletes, the tombstones' and then takeover's, properties before groups, then stages, then pipelines.

`missing` lists owned resources a complete read did not find, with `archived` (`null` for a group) and the exits; `orphans`, owned entries config no longer names, with both `kalup rm` commands; one naming another portal name, only `--release`.

## Header

`stateLineage` and `stateSerial` come from state, `null` without. `protected` defaults by account type (targets.md), `drift` and `adopt` to `hold`, `allowDestroy` to false, `yesLimit` to 25; `takeover` lists the objects in takeover mode. `budget.estimatedCalls` counts three calls per write plus apply's reads; `0` without effects.

`writesHash` digests the target, portal, policy, state lineage and serial, `normVersions`, bindings, and each unblocked step with an effect: `address`, `action`, `transport`, `api`, `labels`, `baseUnits`, `desired`, `ignoreChanges`, `changes` (`unit`, `op`, `after`), `expect`. Titles, held values and notes stay out. `planId` is `pl_` plus its first 12 hex digits.

A write's `expect` holds the live value of each field it sets, the full options when any option changes, a property's `type` and `fieldType`, and a pipeline's live stage order when the step sets it. A pipeline delete expects the full live stage list, so a stage added in HubSpot since the review stops it.

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
