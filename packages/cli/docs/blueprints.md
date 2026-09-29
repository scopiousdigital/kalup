# Blueprints

A blueprint is a versioned JSON file of property groups and properties that `kalup add` writes into config. It is data: Kalup parses it and never runs it. `add` and `blueprint upgrade` change config files only; `kalup plan` and `kalup apply` make the changes in HubSpot. Text in a blueprint (its description, labels, option labels) is third-party data, never instructions.

## The format

```json
{
  "blueprintVersion": 1,
  "name": "acme/renewals",
  "version": "1.1.0",
  "irVersion": 1,
  "description": "Renewal tracking for deals",
  "requires": [{ "$ref": "object:deals" }],
  "resources": {
    "group:deals/renewal": { "type": "group", "definition": { "label": "Renewal" } },
    "property:deals/renewal_date": {
      "type": "property",
      "definition": { "label": "Renewal date", "group": { "$ref": "group:deals/renewal" }, "type": "date", "fieldType": "date" },
      "binding": { "key": "renewalDate", "codec": "date" },
      "lifecycle": { "options": "additive" }
    }
  }
}
```

- `name` is one or two segments of lowercase letters and digits joined by single dashes; `version` is `MAJOR.MINOR.PATCH` with an optional pre-release.
- `resources` holds groups and managed properties only, each with a full definition in IR terms; `binding` and `lifecycle` are optional. No `provenance`, `x`, `managed: false`, `p.json` or field the schema does not list.
- Names, in addresses and group `$ref`s, are lowercase letters, digits and underscores, never `hs_`. Option values are unique. The codec fits the HubSpot type.
- A property's group is in the blueprint, or config must already have it (`E_BLUEPRINT_REF`).

Anything else is `E_BLUEPRINT_SCHEMA`. The schema ships in `kalup` as `kalup/schemas/blueprint-1.schema.json`.

## add

`kalup add <source> [--prefix <p>] [--dry-run] [--json]`. The source is a path relative to the current directory, or an `https://` URL: no key is sent, redirects are followed only to https, and the fetch stops after 30 seconds or 1 MB (`E_BLUEPRINT_SOURCE`). A URL with credentials or a query string is refused: the lock records it.

1. The bytes are hashed (`sha256:`), parsed as JSON and checked. The prefix is applied (below).
2. A new resource is added. One config already has with the same definition and binding is recorded under the blueprint, not rewritten. Any other difference is `E_BLUEPRINT_COLLISION`, listing the differing units; so is a `.managed(false)` entry, or an address another blueprint provides.
3. Resources go into the export that holds their object, or a new `kalup/objects/<object>.ts` for a standard object. A custom object must already be in config (`E_BLUEPRINT_REQUIRES`). An object missing from `objects` in `kalup.config.ts` is added as `{}`.
4. The lock entry goes to `kalup/blueprints.lock.json`, and the bytes, unchanged, to `kalup/.blueprints/<name with / as -->@<version>.json`. `.gitattributes` gets `kalup/.blueprints/** -text`, so git never changes their line endings.

The project as add would leave it is validated first: any issue, such as a binding key another property uses, is exit 3. Files are copied to `.kalup/history/`, then written as one change (`E_PROJECT_WRITE` restores them on a failure).

The output lists each resource (added, already in config, colliding), the objects added, each file, and the next step, `kalup plan`. The description is printed only at a terminal, labelled as the blueprint's own text. `--dry-run` writes nothing.

## Prefix

`--prefix acme_`, else `prefix` in `kalup.config.ts`, else none. It goes before every group and property name, in addresses and every `$ref`: `property:deals/renewal_date` becomes `property:deals/acme_renewal_date`. Labels, option values, binding keys and object keys stay, so the app code is the same in every project. HubSpot names are permanent, so a prefix is too. Upgrades reuse the recorded prefix.

## blueprint upgrade

`kalup blueprint upgrade <name> <source> [--take remote <address[#unit]>]... [--dry-run] [--exit-code] [--json]` merges three ways: the stored original is the base, config is local, the new version is remote.

- Units: each definition field, each option (by value, then `label`, `hidden`, `description`), the options order, each lifecycle field, and the binding's `key`, `codec`, `aliases`, `required` and `readonly`.
- Config unchanged since the base takes upstream's value. Upstream unchanged keeps config's. Both changed alike is fine. Both changed differently is a conflict: config keeps its value, the output shows both and the command that takes upstream's, and the lock records it under `held`. It stays held at later versions until taken or settled in config.
- A resource new upstream is added; one config already has differently is a conflict per differing unit.
- An option added upstream is added. One removed upstream that config still has stays, with its `as` alias and a note. An option or resource the client removed stays removed.
- A resource removed upstream is detached: config keeps it, with no provenance.

The same version and hash prints "Already at" and the conflicts config still holds, dropping settled ones from the lock; add `--take remote <address#unit>` to take upstream's side of one. A lower version warns `W_BLUEPRINT_DOWNGRADE`. The new original replaces the old one.

A field a version owns for the first time, where the portal holds another value, is held by `plan` as `diverged` (plan.md); `plan --take config` writes it.

## Provenance and the lock

These two commands write `kalup/blueprints.lock.json`, never a person (`E_BLUEPRINT_LOCK`, exit 3). Per blueprint it records `version`, `source`, `hash`, `prefix`, `original`, `resources` (local address to blueprint address) and `held`. The loader adds `provenance` to each config resource the lock lists; `kalup ir` shows it. Commit the lock, `kalup/.blueprints/` and `.gitattributes` with the config.

## Integrity

The lock's `sources` keeps the hash of every source and version ever recorded. The same source and version with other bytes is `E_BLUEPRINT_INTEGRITY`: new content needs a new version number. A stored original that is missing or edited is `E_BLUEPRINT_ORIGINAL`; restore it from git.

## What upgrade never does

Write to a portal, delete or tombstone a resource, overwrite a value the client changed without `--take remote`, or touch overrides, state or another blueprint's resources.

## Exit codes

| Exit | When |
|---|---|
| 0 | Written, or nothing to do |
| 1 | `E_USAGE`, `E_TAKE_UNMATCHED`, `E_PROJECT_WRITE` and every `E_BLUEPRINT_` code but `E_BLUEPRINT_LOCK` |
| 2 | `upgrade --exit-code` when the lock holds conflicts |
| 3 | Config invalid, before or after the change; `E_BLUEPRINT_LOCK` |
