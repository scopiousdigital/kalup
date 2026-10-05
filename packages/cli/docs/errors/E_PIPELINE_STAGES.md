# E_PIPELINE_STAGES

A pipeline has no stage, or a ticket pipeline has no closed stage. Exit 3.

## When

HubSpot refuses a pipeline with no stage, and a ticket pipeline with no stage whose `ticketState` is `'CLOSED'` (live runs, 2026-10-05). `kalup rm` refuses to remove such a pipeline's last stage, or its last closed one, for the same reason.

## Fix

Add a stage, or mark one ticket stage `ticketState: 'CLOSED'`. To drop the whole pipeline, run `kalup rm` on the pipeline.

## Example

```
hubspot/pipelines/tickets.ts:3: E_PIPELINE_STAGES: pipeline:tickets/orchard_desk has no stage with ticketState 'CLOSED', and HubSpot needs one (fix: mark the stage tickets end in ticketState: 'CLOSED') (docs: errors/E_PIPELINE_STAGES.md)
```
