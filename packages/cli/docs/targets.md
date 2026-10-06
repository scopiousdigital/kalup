# Targets

A target is a named HubSpot portal under `targets` in `kalup.config.ts`. Call it a target, never an environment.

This page is the reference. For the walk-through with examples, see [Targets and credentials](https://kalup.dev/docs/concepts/targets-and-credentials) on the website.

```ts
targets: {
  sandbox: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } },
  production: {
    portalId: 2222222,
    protected: true,
    credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } },
    overrides: { 'property:harvest/picked_on': { name: 'pickedon' } },
  },
},
```

A target may not be named `config` (`E_TARGET_NAME`). A name carries no meaning: protection and drift come from the fields below.

## Choosing a target

`pull`, `plan` and `snapshot` run against one target, picked after the config validates and before any request:

1. `--target <name>`. An undeclared name is `E_UNKNOWN_TARGET`, exit 3, with no fallback.
2. Else `defaultTarget`, a top-level string in `kalup.config.ts`. One that names no declared target is `E_DEFAULT_TARGET`, exit 3.
3. Else the only target.
4. Several targets and none selected: at a terminal (stdin and stderr are terminals, no `--json`, no `CI`), Kalup lists the names and portal IDs and asks; cancelling is `E_CANCELLED`, exit 1. Otherwise `E_TARGET_REQUIRED`, exit 1; an agent should ask the user which one.
5. No targets: `E_NO_TARGETS`, exit 3.

The first of several targets is never chosen, and no choice is remembered. Text output names the target and how it was picked: `Target sandbox, portal 1111111 (defaultTarget)`.

## Portal pin and guard

`portalId` is a positive integer (`E_PORTAL_ID`): the Hub ID from the HubSpot account menu. A target without it is pending, as `init` writes it without `--portal`: `validate` warns `W_PENDING_TARGET`, the IR leaves it out, offline commands work, and every command that would read or write its portal refuses it before any request (`E_PENDING_TARGET`, exit 3). `status` lists it as pending. Two targets may not pin one portal (`E_DUPLICATE_PORTAL`). Every command that reads a target first checks the account-info of its key against the pin. A mismatch is `E_TARGET_PORTAL_MISMATCH`, exit 4, and nothing more is sent with that key.

## Keys

`credentials.read.env` names the variable that holds the read key. Without `credentials` it is `HUBSPOT_SERVICE_KEY`, the variable the target `init` writes names. `init` itself needs no key. The key comes from the environment, else from the project's `.env`. A missing key is `E_MISSING_KEY`. No output carries a key.

The key goes out as `Authorization: Bearer`. `init` prints the read scopes the pull scope needs; `status` checks each. Both recommend one `crm.objects.<object>.read` scope too: Limits Tracking answers 403 to `crm.schemas.*` scopes alone and 200 once one `crm.objects.<object>.read` scope of any object is added; without it `plan` cannot check the property limit (`W_LIMIT_UNREADABLE`). `credentials.write` names the key apply, `state rebuild --write` and `target rebind` use (apply.md); without it they use the read key. That key needs the read scopes and `crm.schemas.<object>.write` per object (`crm.schemas.custom.write` for custom objects), which `init` and `status` list. `status` reads the scopes a key holds through HubSpot's token introspection and checks the recommended scope and, when the write key is the read key, each write scope by name; a separate write key is never resolved by a read command, so its scopes stay unchecked.

## Overrides

`overrides` is keyed by address: `property:<object>/<name>`, `group:<object>/<name>` or `object:<name>`. A key that is not an address in config is `E_UNKNOWN_OVERRIDE`. Any field other than these four is `E_NOT_DATA`:

- `name: '<portal name>'`: the resource's internal name in this portal, or for a pipeline or stage its ID there. Every read uses it; `plan` blocks it when the portal lacks it. `E_OVERRIDE_AMBIGUOUS` when the portal holds both names; `E_OVERRIDE_NAME` when two addresses would read one portal resource.
- `skip: true`: left out on this target by every read, a group with its config properties, a pipeline with its stages, an association alone.
- `definition: {...}`: the fields that differ on this target (config.md).
- `lookup`: no lookup resource is managed yet; `plan` blocks the resource, `compare` reports it unknown.

## Policy

`protected: true` marks a portal `--yes` never covers: a person at a terminal applies, a saved plan or one made in the same run, or a reviewed CI job with `--approve` (apply.md). `init` does not write it; with config silent, only test portals, sandboxes and app developer accounts are unprotected. `drift` (`'hold'` or `'overwrite'`, default hold) acts only where state holds a base; `adopt` (same values, default hold) decides a unit with no base, as on a first adoption (plan.md). `allowDestroy` (default false) lets a destroy tombstone or takeover delete in this portal. `yesLimit` (0 to 1000, default 25) caps what `--yes` covers; `0` turns it off. `mode` and `objects: { <object>: { mode } }` set takeover per target (config.md). All of them enter the plan's approval digest, and none is inherited from the project or an object but `mode`.

## Rebind

`kalup target rebind <target> --portal <id>` points a target at a recreated test portal or sandbox that no other target pins (`E_DUPLICATE_PORTAL`) and the target's write key belongs to; state.md has the steps. Plans saved for the old portal are refused (`E_PLAN_DESTINATION`).
