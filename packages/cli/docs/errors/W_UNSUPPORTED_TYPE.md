# W_UNSUPPORTED_TYPE

A warning from any command that reads a portal: a property in the pull scope or the object files that Kalup does not write. It reads as a `p.string` reference. Exit stays 0.

## When

Its HubSpot `type` has no builder (`object_coordinates`, `json`, or a type Kalup does not know), it is a custom property whose `fieldType` its builder does not allow (a `calculation_rollup`), or it is a custom `externalOptions` property that is not an owner select or radio (a multi-owner checkbox, or options from elsewhere), whose options HubSpot fills. An owner select or radio is `p.owner`. Pull writes it as a `p.string` reference, with `.readonly()` when HubSpot marks its value read-only. A file entry that is already a reference keeps its builder; a managed one becomes a `p.string` reference. `plan` never creates, changes or archives it, and blocks a managed entry; `compare` compares the fields it has.

A HubSpot-defined or HubSpot-calculated `externalOptions` property raises no warning: it is a reference like any HubSpot-defined property. Nor does a property outside the pull scope that no object file names: the project does not use it.

## Fix

Nothing to fix in config. Read the value through the `p.string` reference, or through another builder the app chooses for a reference. To change the property, change it in HubSpot.

## Example

```
W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which Kalup does not write; read as a p.string reference (docs: errors/W_UNSUPPORTED_TYPE.md)
```
