# E_PIPELINE_ID

A pipeline or stage ID cannot be used: it forms no address, is too long, or another one holds it. Exit 3.

## When

A pipeline or stage ID is its address and what HubSpot stores, so it must hold no whitespace or slash. HubSpot stores a pipeline ID of at most 36 characters and a stage ID of at most 100, and answers 500 to a longer one. A pipeline ID is unique across the portal, deals and tickets included, and a stage ID across the pipelines of one object (live runs, 2026-10-01 and 2026-10-05), so two in config may not share one.

## Fix

Give the pipeline or stage another ID. An ID is permanent once HubSpot creates it, so choose a short, readable one, such as the pipeline ID followed by the stage, `orchard_signed`.

## Example

```
hubspot/pipelines/tickets.ts:5: E_PIPELINE_ID: pipeline:tickets/orchard_sales has the ID of pipeline:deals/orchard_sales, and HubSpot keeps pipeline IDs unique across objects (fix: give one of the two another ID) (docs: errors/E_PIPELINE_ID.md)
```
