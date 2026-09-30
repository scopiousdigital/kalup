# E_DEFINITION_FIELD

A property definition states a field HubSpot would refuse or misread for this property. Exit 3.

## When

`validate` and every command that validates first check the fields that depend on the builder or on each other, as HubSpot does:

- `numberDisplayHint`, `showCurrencySymbol` and `currencyPropertyName` belong to `p.number`, and `textDisplayHint` to `p.string`, `p.stringArray`, `p.json` and `p.phoneNumber`. HubSpot stores them on any property but shows them only on those.
- `calculationFormula` needs `fieldType: 'calculation_equation'`. Sent with another field type, HubSpot turns the property into a calculation.
- `currencyPropertyName` needs `showCurrencySymbol: true`. HubSpot refuses it otherwise (`ONLY_CURRENCY_PROPERTIES_CAN_SPECIFY_CURRENCY`).
- `displayOrder` is an integer from -1 up.
- `p.owner` takes no `options`: HubSpot fills them with the account's users and refuses a create that sends any.

A target's definition override that breaks one of these rules is `E_OVERRIDE_DEFINITION`.

## Fix

Change or remove the field the message names, or change the builder.

## Example

```ts
share: p.string('pick_share', { label: 'Pick share', group: 'orchard', fieldType: 'text', numberDisplayHint: 'percentage' }),
```

```
hubspot/objects/companies.ts:14: E_DEFINITION_FIELD: numberDisplayHint is for p.number, not p.string (fix: remove numberDisplayHint) (docs: errors/E_DEFINITION_FIELD.md)
```
