# 0002. Absence never deletes

## Status

accepted

## Date

2026-09-22

## Context

The first draft gave config authority over every custom property in its pull scope: with `custom: true` (the default), a property that disappeared from the config file was archived on the next apply. That is the Terraform reading of a config file, and it is wrong for a CRM that people edit every day. On a shared portal, "not in the file" has to mean "unmanaged".

The three-way state design repeated the mistake in a softer form, inferring deletes from absence with a git-ancestor rule. The costs: the engine is tied to git ancestry, the admin persona has no git and no protection, a dropped import proposes a mass delete, and unapproved deletes sit in every plan. Four research dossiers reached "never infer a delete from absence" on their own.

## Decision

A delete is an explicit, tombstoned, owned, permitted and confirmed act. All four are required:

1. A tombstone in `kalup/removed.ts`, written by `kalup rm`.
2. An owning state entry for that address in that target (`origin` is `created` or `adopted`).
3. A target policy that allows destroys.
4. A human confirmation at apply time.

Tombstones carry one of two actions. `destroy` archives or deletes the resource in the portal. `release` stops managing it and leaves it in the portal. In the IR they appear as:

```json
"tombstones": { "property:companies/legacy_score": { "action": "destroy" } }
```

What happens without a tombstone:

- An owned resource missing from config is an `orphan` note that prints both `rm` commands. No portal call.
- A live resource with no config and no entry is `unmanaged`. `status` and `compare` count it, `pull --discover` lists it.
- A resource missing in the portal is reported, never removed from files.

A tombstone may destroy an `adopted` resource, labelled `existed-before-kalup` in the plan, since adoption is ownership. `lifecycle: { preventDestroy: true }` on a resource makes validation reject a tombstone for it. A tombstone with no owning entry in a target is `blocked: not owned in this target`.

The same rule applies inside a resource. Fields present in config are owned; omitted optional fields belong to the portal and are never stored, diffed or written. Enum options default to `additive`: a portal-only option is kept and noted, a dropped option is kept with the note "add to `removedOptions` to remove", and only `removedOptions` (or `options: 'exact'`) removes one, at risk `risky`.

The plan never prints a command whose result is destructive. The orphan note may print both `rm` commands because their result is a tombstone in a file; the portal change still needs all four conditions, and the fourth needs a person.

## Alternatives considered

- **Delete on absence inside the pull scope (the draft).** One dropped line archives a property with values on thousands of records. Rejected.
- **Infer deletes from git ancestry.** Behaves differently after state loss, needs git, and fills plans with pending deletes. Rejected.
- **A `--allow-destructive` flag at plan time as the only gate (the draft).** A flag is something an agent can pass. Replaced by the four conditions, of which the tombstone is a reviewed file change and the confirmation needs a person at a terminal (ADR 0010).
- **Destroy only `created` resources, never `adopted` ones.** Would make anything that existed before Kalup undeletable through Kalup forever. Rejected in favour of the `existed-before-kalup` label.

## Consequences

- Removing something is two steps: `kalup rm`, then `plan` and `apply`. Both show up in review.
- Orphan notes stay in every plan until someone writes a tombstone or the next `pull` writes the resource back into config. That is by design.
- `pull` no longer wipes config edits. A property removed from config without `kalup rm` is still in the pull scope, so it comes back on the next pull. `kalup rm <address> --release` excludes it from pull for good.
- Destructive plan text stays honest about what is not known. HubSpot restores archived properties for 90 days in the UI only. Whether the internal name can be reused inside that window, and whether values come back, is not confirmed. Whether the API refuses to archive an in-use property is untested. Plan lines say "not checked", never 0.
- A changed internal name is never a silent destroy and create. It is an error with a generated migration recipe: create new, copy values, repoint references, tombstone old.
