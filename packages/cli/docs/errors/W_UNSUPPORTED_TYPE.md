# W_UNSUPPORTED_TYPE

A warning from any command that reads a portal: a property Kalup does not write. It reads as a `p.string` reference. Exit stays 0.

## When

Its HubSpot `type` has no builder (`phone_number`, `object_coordinates`, `json`, or a type Kalup does not know), it is a custom property whose `fieldType` its builder does not allow (a `string` with fieldType `html`, rich text), or it is a custom owner or `externalOptions` property, whose options HubSpot fills. Pull writes it as a `p.string` reference, with `.readonly()` when HubSpot marks its value read-only. A file entry that is already a reference keeps its builder; a managed one becomes a `p.string` reference. `plan` never creates, changes or archives it, and blocks a managed entry; `compare` compares the fields it has.

A HubSpot-defined or calculated owner or `externalOptions` property raises no warning: it is a `p.string` reference like any HubSpot-defined property.

## Fix

Nothing to fix in config. Read the value through the `p.string` reference, or through another builder the app chooses for a reference. To change the property, change it in HubSpot.

## Example

```
W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which Kalup does not write; read as a p.string reference (docs: errors/W_UNSUPPORTED_TYPE.md)
```
