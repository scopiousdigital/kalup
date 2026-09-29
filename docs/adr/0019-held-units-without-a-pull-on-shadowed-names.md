# 0019. Held units on a shadowed name carry no pull command

## Status

accepted on 2026-09-24. The founder's v1 implementation assignment keeps these semantics.

## Date

2026-09-23

## Context

ADR 0005 says a plan's `--json` lists each held unit "with its class, both values and the two commands that resolve it", and rejects a hold with no way out: "Both exits are named on every held line." The milestone 2 `plan/1` shape has `resolve: { portal }` required on every held unit.

The milestone 2 review changed `pull`. A resource can refer to a portal name that a `name` override shadows: a property in a shadowed group, or a custom object schema that names a shadowed property. The read records that name as `shadowed:<name>`, which no config file may hold, so `pull` now keeps the file's side of such a resource and reports it as `shadowed`. For a held unit on that resource, no `pull` command takes the portal side. Naming one anyway sends a person, or an agent that follows printed commands (ADR 0009), to a command that exits 0 and writes nothing. The other exit, `plan --take config`, is on paper until apply exists.

## Decision

**A held unit on a resource that names a shadowed portal name has no `resolve`.** `plan/1` makes `resolve` optional. The plan text says instead: "No pull takes the portal side while a name override shadows a name the resource refers to; correct or remove that override under `targets.<name>.overrides`". Once the override is corrected, the resource refers to its own portal name and `pull` can take the portal side. A kept option's note on such a resource gives the same advice in place of a `pull` command. Every other held unit keeps `resolve.portal`.

**What this supersedes.**

- ADR 0005: "the two commands that resolve it" and "Both exits are named on every held line", for held units on a resource that names a shadowed portal name only.
- The milestone 2 `plan/1` shape: `resolve` required on every held unit.

**What stays.** Everything else in ADR 0005. Hold is the default, held units never block other units, and every held line still names a way out.

## Alternatives considered

- **Keep `resolve` required and name the pull command.** The command writes nothing for such a resource and exits 0, so whoever follows it thinks the unit is settled. Rejected.
- **Add the override fix to `resolve` as a new field,** such as `resolve.override`. Every held unit would keep a `resolve`, but a public contract gains a field for one edge case, and the fix is a config edit, not a command. Open for the founder to prefer.
- **Let `pull` write the resource.** No file may hold `shadowed:<name>`, and writing the plain portal name would point the local address at the wrong portal resource. Rejected.

## Consequences

- A `plan/1` consumer must accept a held unit without `resolve`, and read the plan text or these docs for what to do.
- Until this record is accepted, the architecture marks the text that depends on it as proposed.
- When `--take config` exists, a held unit on a shadowed name still gets the config-side command. Only the portal side is missing.
