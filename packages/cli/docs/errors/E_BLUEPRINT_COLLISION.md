# E_BLUEPRINT_COLLISION

A blueprint resource has the address of a config resource with another definition. Exit 1. Nothing was written.

## When

`kalup add` compares each resource of the blueprint, after the prefix, with config. The same definition and binding is recorded under the blueprint; any differing unit (a label, an option, the key, the codec, a lifecycle field) is a collision, listed with both values. So is a `.managed(false)` entry: a blueprint resource is managed. An address another blueprint provides collides even when alike, for `add` and for a resource new in `kalup blueprint upgrade`.

## Fix

Make config match the blueprint, take the resource out of config, or add the blueprint with `--prefix` so its names do not collide. HubSpot names are permanent, so choose the prefix with care. When another blueprint provides the resource, use `--prefix`, or your own copy of the blueprint without it.

## Example

```
E_BLUEPRINT_COLLISION: property:deals/renewal_date is in config with another definition: label (config "Contract end", blueprint "Renewal date"). Nothing was written. (fix: make config match the blueprint, remove the resource from config, or add the blueprint with --prefix so its names do not collide) (docs: errors/E_BLUEPRINT_COLLISION.md)
```
