---
'kalup': minor
'@kalup/core': minor
---

Pipelines and stages. Kalup now reads, plans and writes the pipelines and stages of deals, tickets and custom objects, kept in `hubspot/pipelines/<object>.ts` with `definePipeline` from `@kalup/core`. Each stage carries its ID and the metadata of its object: `probability` on deals, `ticketState` on tickets, `state` on custom objects. The pipelines of other objects, such as the contacts and companies lifecycle pipelines, are read and compared, never written.

- Pull refreshes the pipelines your files define. Set `pipelines: true` on an object to pull all of its pipelines; `kalup init` sets it for deals and tickets, and `pull --discover` lists the rest. An existing project pulls no new pipelines until you set it.
- Plan and apply work as for properties: a stage relabelled in HubSpot is held, not reverted. A new pipeline is created with its stages in one request. A stage order change moves stages one request at a time, because HubSpot renumbers a pipeline when a stage lands on a taken position. A change of probability or closed state is risky.
- `kalup rm` takes a pipeline or stage out of config. Its delete is permanent, since HubSpot keeps no archive, and needs `allowDestroy` and a person at a terminal like every delete.
- New issue codes: `E_PIPELINE_FIELD`, `E_PIPELINE_ID`, `E_PIPELINE_STAGES` and `E_DUPLICATE_LABEL`. `E_UNSUPPORTED_FILE` no longer covers `hubspot/pipelines/`; it now refuses a `definePipeline` export outside that folder.
- `snapshot` and `status` count pipelines and stages, and `pull --discover` returns `pipelines` in its JSON data.

Document formats gained fields in this release, additively: `plan/1` steps may carry `stages` (the stages a pipeline create carries), and the `ir/1` coverage block gained `objects.<object>.pipelines` and `notCaptured.pipeline` and `notCaptured.stage`, alongside the new `pipeline` and `stage` resource types. As after any minor release, plan again before applying a plan saved with an earlier one.
