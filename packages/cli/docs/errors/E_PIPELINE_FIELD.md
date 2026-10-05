# E_PIPELINE_FIELD

A pipeline or stage states a field HubSpot would refuse, or drop without a word. Exit 3.

## When

A stage carries one metadata field, by its pipeline's object: `probability` on deals, from 0 to 1 and required, `ticketState` on tickets and `state` on custom objects, each `'OPEN'` or `'CLOSED'`. HubSpot drops any other metadata without an error, so a write would change nothing and every plan would show it again; HubSpot derives `isClosed` itself. A pipeline on another object, such as the contacts lifecycle pipeline, is read and compared, never written, so its stages carry no metadata. A pipeline's `displayOrder` is an integer from 0 up (live runs, 2026-10-01 and 2026-10-05).

A target's definition override that breaks one of these rules is `E_OVERRIDE_DEFINITION`.

## Fix

Change or remove the field the message names.

## Example

```ts
won: { id: 'orchard_signed', label: 'Signed', ticketState: 'CLOSED' },
```

```
hubspot/pipelines/deals.ts:10: E_PIPELINE_FIELD: ticketState is for ticket stages; a deal stage takes probability (fix: replace ticketState with probability, from 0 to 1) (docs: errors/E_PIPELINE_FIELD.md)
```
