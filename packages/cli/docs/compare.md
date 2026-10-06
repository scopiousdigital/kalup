# Compare

`kalup compare <a> <b>` reports what would change in `b` to match `a`. It never writes, to the portal or to disk.

This page is the reference. For the walk-through with examples, see [kalup compare](https://kalup.dev/docs/commands/compare) on the website.

## Sides

Each side is, in this order:

1. `config`: the config files, as `kalup ir` derives them. Compared with a target, that target's `definition` overrides apply.
2. A target declared in `kalup.config.ts`, read now. Each target has its own key, client and portal guard, and every guard runs before the first read: a key for another portal is exit 4.
3. Otherwise a snapshot file, relative to the current directory. No such file is `E_SNAPSHOT`, exit 1.

The project must load and validate only when a side is `config` or a target (exit 3 otherwise). Two snapshot files compare anywhere and send no request. A target is read as `pull` reads it: the same scope, three properties lists per object, `skip` and `name` overrides applied.

## Direction

`a` is desired, `b` observed. In `changes[]`, `before` is `b`'s value and `after` is `a`'s.

- `compare config production`: what a plan for production would change, without planning.
- `compare <snapshot> production`: drift since the snapshot. `before` is the portal now, `after` the snapshot.
- `compare sandbox production`: two portals.

## What is compared

Every address present on either side, including properties Kalup does not write, and every config address. Each gets a status:

- Equal: every unit converged. Counted, not listed.
- `differs`: `changes[]` lists options to add or remove; `held[]` lists units that differ, `diverged` since there is no base; `notes[]` lists options only `b` holds, kept because options are additive. When `b` is a portal side, the note names the pull command that brings the option into config. `pull` does not write a resource that names a portal name a `name` override shadows (`shadowed:<name>`), so on such a resource the note says to correct or remove that override instead. Nor does it bring in a property the files lack that is outside its object's pull scope, so there the note says to add the name to `objects.<object>.include`; a property the files define is always in scope. A snapshot does not record whether HubSpot defines a property, so on a reference `include` does not name, a snapshot's note says it may be outside the scope and gives the same advice.
- `only-a` or `only-b`: on one side only.
- `unmanaged`: only a portal side holds it and the other side is config. Listed and counted, never a difference: absence never deletes.
- `unknown`: a side could not read its object, never read it, left out a property config names because its group's name holds whitespace (`W_UNADDRESSABLE_NAME`), is settling after an apply (plan.md, `W_SETTLING`; the fix says when to compare again), or a target side has a `lookup` override, since this version manages no lookup resources. `reason` says which side and why.
- `excluded`: a `skip` override, or outside a side's read scope. Listed, not a difference.

Config owns the fields it states, less `ignoreChanges`; a reference owns nothing, so only its presence compares. A portal side owns every field it captured; a field HubSpot left out takes its default, or `null` when it has none. With config as `b`, only the fields config states are compared. Options are compared when the config side states them, and always between two portal sides. Config managing what the portal holds as HubSpot-defined or calculated differs in the unit `managed`.

## Complete

A comparison is complete when no address is unknown and every object either side names was read on both sides (read, absent from the portal, or skipped). Otherwise the exit is 1 with `E_INCOMPLETE`, naming what was not compared and what to do: add scopes or an object key under `objects`, or rename in HubSpot a portal group whose name holds whitespace, with or without `--exit-code`. `data` is still printed, with `ok: false`. An incomplete comparison is never a clean result.

## Flags

- `--exit-code`: exit 2 when anything `differs` or is `only-a` or `only-b`. An option only `b` holds counts. Unmanaged and excluded addresses do not.
- `--json`: one `envelope/1`. `data` holds `a` and `b` (kind, name, portal ID, file, `observedAt`), `complete`, `counts` and `differences[]` with `address`, `status`, `changes`, `held`, `notes` and `reason`.

Structured values keep portal strings exact. The text output is sanitized.

## Output

The example project after config added an option and a property, and the portal renamed a label and added an option:

```
a: config
b: target sandbox, portal 1111111
12 equal, 1 differs, 1 only in a, 0 only in b, 1 unmanaged, 0 unknown, 0 skipped
unmanaged: group:companies/companyinformation
differs: property:companies/billing_status
  add options[trial]: null -> {"value":"trial","label":"Trial"}
  label differs: a "Billing status", b "Billing state"
  kept options[paused]: {"value":"paused","label":"Paused","hidden":false,"description":""}
only in a: property:companies/churn_reason
```

## Exit codes

| Exit | When |
|---|---|
| 0 | Complete, differences included without `--exit-code` |
| 1 | `E_INCOMPLETE`, `E_USAGE`, `E_NO_CONFIG`, `E_SNAPSHOT` (a missing file, not JSON), `E_MISSING_KEY`, `E_OVERRIDE_AMBIGUOUS`, a failed request |
| 2 | `--exit-code` and a difference, with `ok: true` |
| 3 | Config invalid, `E_UNKNOWN_OBJECT`, or a file that is not a valid snapshot |
| 4 | `E_TARGET_PORTAL_MISMATCH` |
