# E_DUPLICATE_LABEL

Two stages of one pipeline, or two pipelines of one object, share a label. Exit 3.

## When

HubSpot refuses a stage whose label another stage of the same pipeline has, ignoring case and spaces around it, and a pipeline whose label another pipeline of the same object has, ignoring case (live runs, 2026-10-05). The same label on stages of two pipelines, or on pipelines of two objects, is fine.

## Fix

Give one of the two another label.

## Example

```ts
stages: {
  tasting: { id: 'orchard_tasting', label: 'Tasting', probability: 0.2 },
  retasting: { id: 'orchard_retasting', label: 'tasting', probability: 0.3 },
},
```

```
hubspot/pipelines/deals.ts:9: E_DUPLICATE_LABEL: stages 'orchard_tasting' and 'orchard_retasting' of pipeline:deals/orchard_sales share the label 'tasting', ignoring case (fix: give one of the two another label) (docs: errors/E_DUPLICATE_LABEL.md)
```
