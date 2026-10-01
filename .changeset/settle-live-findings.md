---
"kalup": minor
---

Live runs against HubSpot on 2026-10-01 settled the behaviours Kalup had treated as unverified. What changes:

- `kalup status` reads the scopes a service key holds through HubSpot's token introspection and checks the recommended scope and, when apply writes with the same key, each write scope by name. A missing write scope is `W_WRITE_SCOPE`. The list probes stay. The JSON gains `keyScopes` on each target. The key goes in that one request's body, as HubSpot requires, to the host the Authorization header already reaches; nothing logs or journals request bodies.
- `kalup apply` names each workflow, list, form or calculation property that keeps a property from being archived, from HubSpot's refusal. A sensitive property create refused for a missing scope names `crm.objects.<object>.sensitive.write` (or `highly_sensitive.write`), and one refused because the portal has sensitive data turned off names the setting.
- `kalup plan` blocks turning `showCurrencySymbol` off once the property ever had a `currencyPropertyName`, an empty one included: HubSpot never allows it again, and the property has to be recreated. `validate` refuses `currencyPropertyName: ''`, which HubSpot stores as a value. A project that states `''` today exits 3 until the field is removed.
- Group deletes no longer wait on archived properties. HubSpot archives a group whose properties are all archived, and an archived group never comes back, so plan and apply block a group delete only while an active property names it, and no longer read the archived lists for one.
- `a<appId>_` names are reserved like `hs_`: HubSpot refuses a create with either prefix, so `E_HS_PREFIX` covers both. `kalup pull` writes a property under either prefix as a reference instead of failing with `E_PULL_INVALID`. A project that pulled an `hs_` property Kalup does not define as a managed property sees pull rewrite it as a reference on the next run.
