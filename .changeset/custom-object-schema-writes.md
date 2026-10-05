---
'kalup': minor
'@kalup/core': minor
---

Custom object schema writes. Kalup now creates, updates and archives custom objects defined with `defineCustomObject`, which until now it only read and compared.

- `defineCustomObject` takes an optional `description`, and pull writes HubSpot's description there.
- `kalup pull` no longer stops with `E_UNKNOWN_OBJECT` for a custom object your files define and the portal lacks: it reports it `missing in portal`, keeps its file, and pulls the rest. `E_UNKNOWN_OBJECT` is now only for a key under `objects` that is neither a standard object, nor defined in your files, nor in the portal. Pull also leaves out a custom object `hubspot/removed.ts` names.
- A new custom object is one plan step. Apply creates it with its name, labels and description, then its groups and properties, then sets its display, required and searchable properties, since HubSpot refuses those fields until the properties they name exist. A new custom object gets HubSpot's default properties, the group `<name>_information` and associations with activities; Kalup does not create associations to other objects yet. When the object file lists `<name>_information`, as pull writes it once a property sits in it, apply gives HubSpot's group config's label instead of creating it.
- An update sends the whole schema in one request: HubSpot can set fields left out of a partial update back to older values.
- A field your files changed while Kalup could not write custom objects now shows in the next plan as an update.
- `kalup rm object:<name>` takes the object out of config with everything on it, its pipelines included, and writes one tombstone; it refuses a destroy while anything on the object sets `preventDestroy` (`E_PREVENT_DESTROY`). Its delete archives the object in HubSpot, needs `allowDestroy` and a person at a terminal like every delete, and is refused by HubSpot while the object holds records. The plan and the confirmation say how many of the object's properties, groups and pipelines go with it, and apply stops before any write when its own read finds more. Kalup never purges an archived object, and takeover never archives one.
- Validate refuses a custom object tombstone while config still holds anything on the object (`E_TOMBSTONE_CONFLICT`), and apply refuses that archive too (`E_PLAN_DELETE`).
- Plan blocks a create whose name HubSpot holds archived (the create would purge the archived object and its records) or holds in another case, and a display field naming a property HubSpot will not hold or whose create the plan itself blocks.
- New issue codes: `E_OBJECT_FIELD` for a name or label HubSpot refuses, or more than two secondary display properties, and the warning `W_OBJECT_PROPERTY` for a display, required or searchable field naming a property the object file does not list.

Document formats changed in place in this release: the `ir/1` definition of a custom object, and `coverage.objects.<object>.unsupportedSchema` in a snapshot, gained `description`. A `plan/1` custom object delete step carries `expect.values.takes` (`properties`, `groups`, `pipelines`), what the archive takes along. `kalup apply --json` may report a step the plan does not hold: `<id>.display`, the update apply derives from a custom object create to set its display fields once its properties exist. As after any minor release, plan again before applying a plan saved with an earlier one.
