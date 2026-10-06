# E_ASSOCIATION_FIELD

An entry of `associations.ts` breaks a rule HubSpot keeps for association labels. Exit 3.

## When

Both objects of an entry must be under `objects` in `kalup.config.ts`, so plan can read the pair. A label holds text: leave `label` out for the plain association of a pair. A pair has one plain association, and between two standard objects HubSpot defines it, so the files cannot. A label is unique per pair and direction (live runs, 2026-10-01 and 2026-10-05); two the same are `E_DUPLICATE_LABEL`.

## Fix

Change or remove the entry the message names.

## Example

```ts
crew: { from: 'companies', to: 'contacts', name: 'crew_plain' },
```

```
hubspot/associations.ts:6: E_ASSOCIATION_FIELD: association:companies/contacts/crew_plain has no label, and HubSpot defines the plain association between companies and contacts (fix: give it a label, or remove it: the plain association between two standard objects is always there) (docs: errors/E_ASSOCIATION_FIELD.md)
```
