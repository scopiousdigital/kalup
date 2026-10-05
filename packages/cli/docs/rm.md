# Remove

`kalup rm <address> [--release] [--json]` takes a custom object, property, property group, pipeline or stage out of config and writes its tombstone in `hubspot/removed.ts`. Absence never deletes: a resource dropped from an object file by hand stays in the portal and comes back on the next pull. `rm` is the only way to ask for a delete, and it works offline: it reads no key, sends no request and never touches state.

This page is the reference. For the walk-through with examples, see [kalup rm](https://kalup.dev/docs/commands/rm) on the website.

## What it writes

- The address must be `object:<name>`, `property:<object>/<name>`, `group:<object>/<name>`, `pipeline:<object>/<id>` or `stage:<object>/<pipelineId>/<stageId>` (`E_TOMBSTONE_ADDRESS`, exit 3).
- A custom object leaves config with everything on it: its export, and every pipeline export on the object, and each file left with no export goes. Its one tombstone covers its groups, properties, pipelines and stages. Its entry under `objects` in `kalup.config.ts` stays, so the plan reads the object.
- The property, or the group entry, leaves the export that defines it, in whichever file holds it. An export left with no properties keeps its groups; `defineObject` accepts it.
- A pipeline's export leaves `hubspot/pipelines/<object>.ts`, and the file goes when it held no other. Its one tombstone covers its stages. A stage leaves its pipeline's `stages`.
- `hubspot/removed.ts` gets `'<address>': { action: 'destroy' }`, or `'release'` with `--release`. An address already there gets its action changed; the same action writes nothing.
- An address config does not define (an orphan the plan lists) gets the tombstone alone.
- `hubspot/index.ts` is written again.

Before writing, rm validates the project as it would leave it; any issue is exit 3 and nothing is written. Each file is copied to `.kalup/history/<timestamp>/`, then all of them are written through one staged write: temporary files first, then a rename each, and on a failure every file is put back (`E_PROJECT_WRITE`).

## What it refuses

- `destroy` for a resource with `lifecycle: { preventDestroy: true }` (`E_PREVENT_DESTROY`, exit 3), or for a custom object while anything on it sets it, since the archive takes them along. Remove preventDestroy first, or use `--release`.
- A group that config properties use, or a property a custom object schema in config names as a display, required or searchable property (`E_RM_DEPENDENTS`, exit 3). This applies to `--release` too.
- A pipeline's last stage, or a ticket pipeline's last closed stage (`E_PIPELINE_STAGES`, exit 3): HubSpot refuses both. Remove the pipeline instead, or mark another stage closed first.

## Destroy and release

A `destroy` tombstone becomes a delete in the next plan only when all of these hold: the portal's state owns the resource (Kalup created or adopted it there), the target sets `allowDestroy: true`, and a person at a terminal types the target name and the number of destructive steps when applying (apply.md). HubSpot archives a deleted property; it can be restored in HubSpot for 90 days. HubSpot archives a deleted custom object with what is on it, and refuses while the object holds records; Kalup never purges it. A deleted pipeline or stage is gone for good: HubSpot keeps no archive, and refuses the delete while a record sits in the stage.

A `release` tombstone stops Kalup managing the resource. The portal keeps it, the next apply drops its state entry without a request, and pull never writes it back into config (pull.md).

## Next

```
kalup rm property:companies/legacy_score
kalup plan --target sandbox
kalup apply --target sandbox
```

The output names what was removed and the plan command. `--json` data: `address`, `action`, `files` written, `from` (the object file) and `previous` (the action before, when there was one).

## Exit codes

| Exit | When |
|---|---|
| 0 | Written, or already so |
| 1 | `E_USAGE`, `E_NO_CONFIG`, `E_PROJECT_WRITE` |
| 3 | Config invalid, before or after the removal; `E_TOMBSTONE_ADDRESS`, `E_PREVENT_DESTROY`, `E_RM_DEPENDENTS`, `E_PIPELINE_STAGES` |
