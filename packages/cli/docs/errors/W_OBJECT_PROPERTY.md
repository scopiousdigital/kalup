# W_OBJECT_PROPERTY

A warning from validate: a custom object's `primaryDisplayProperty`, `secondaryDisplayProperties`, `requiredProperties` or `searchableProperties` names a property its object file does not list. Exit stays 0.

## When

HubSpot refuses a schema create or update that names a property it does not hold (live runs, 2026-10-05). A property HubSpot gives every custom object, such as `hs_object_id` or `hs_createdate`, needs no entry, and neither does any other `hs_` name, a prefix HubSpot reserves. Any other one the object file does not list may still be in the portal, outside the pull scope, so validate only warns. `plan` blocks a schema write that names a property neither the portal holds nor the plan creates, and raises this warning itself for an `hs_` name it takes as HubSpot's that is not one HubSpot is known to give every custom object.

## Fix

Add the property to the object's `properties`: with its definition when Kalup should create it, or as a reference, `p.string('<name>')`, when HubSpot holds it already.

## Example

```
hubspot/objects/orchard_visit.ts:3: W_OBJECT_PROPERTY: primaryDisplayProperty of object:orchard_visit names visit_title, which the object file does not list; HubSpot refuses a schema write naming a property it does not hold (fix: add visit_title to the object's properties, as a reference if HubSpot holds it already: p.string('visit_title')) (docs: errors/W_OBJECT_PROPERTY.md)
```
