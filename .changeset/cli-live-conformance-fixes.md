---
"kalup": patch
---

Kalup follows what the first live conformance run saw on a HubSpot developer test account on 2026-09-29.

- `init` recommends one `crm.objects.<object>.read` scope next to the read scopes the key needs, in its text and as `recommended` in `--json` data, on the first of companies, contacts or deals in scope, else companies. `status` prints the same scope as `Also recommended`, not checked, and adds `recommended` to its data. HubSpot's Limits Tracking answered 403 to a key with `crm.schemas.*` scopes only, so `plan` could not check the property limit. Whether one such scope is enough is not yet confirmed live.
- `plan`, and `apply` without a plan file, warn with the new `W_LIMIT_UNREADABLE` (exit 0) when they create properties and the property limit reading answered 403 or had no figures. Nothing is blocked.
- A create of a property name HubSpot holds archived stays blocked, and now says why: creating it restores the archived property rather than making a new one. The fix is to restore it in HubSpot and pull, or to choose another name. The same applies to `--take config` on an archived missing property.
- A rejected write keeps HubSpot's `subCategory`, sanitized like its category, and the apply journal records it. HubSpot's error body nested as JSON text in `message`, as it sent for a group archive, is read too.
- Apply names three refusals in plain words: a property in use, with HubSpot's count ("remove those uses in HubSpot first"), a group that still holds properties, and a property name that already exists. Any other refusal keeps HubSpot's message. A rejected write now quotes that message up to 400 characters, so the in-use count survives a long property name.
- A group delete that `plan` blocks because properties still name the group now says HubSpot refused to archive a group that held an active property, instead of calling it unconfirmed.
